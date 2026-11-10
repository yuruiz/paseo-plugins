import { homedir } from "node:os";
import { join } from "node:path";
import { addBucket, applySession, recordCall, type CodexForkState, type FileState, type ScanState } from "./state";
import { clipTitle, firstMessageText, forEachNewLine, localHourKey, num, MACHINE_LABEL } from "./util";

export const CODEX = "codex";

export function codexRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return [join(home, "sessions"), join(home, "archived_sessions")];
}

/**
 * Forked rollouts must not be counted from their cumulative totals:
 * - Newer files carry the parent's cumulative snapshot in their first post-fork
 *   token event; that snapshot is a baseline, but the event's own
 *   last_token_usage is still real usage and is counted (once).
 * - Older files (no ordinal fields) replay the parent's token history as a burst
 *   of events emitted within the first seconds after the fork; those events are
 *   synthetic and are skipped (only events after the burst window count).
 */
const BURST_WINDOW_MS = 2000;

export async function scanCodexFile(state: ScanState, path: string): Promise<void> {
  const previousState = state.files[path];
  let project = previousState?.project ?? "";
  let model = previousState?.model ?? "";
  let session = previousState?.session ?? "";
  let title = previousState?.sessionTitle ?? "";
  let totals: number[] | null = previousState?.totals ?? null;
  let fork: CodexForkState = previousState?.codexFork ?? { forked: false, point: null, baselineDone: false, firstTs: null };
  const result = await forEachNewLine(path, previousState?.offset ?? 0, (line) => {
    if (!title && (line.includes('"response_item"') || line.includes('"user_message"'))) {
      try {
        const entry = JSON.parse(line) as { payload?: { type?: unknown; role?: unknown; message?: unknown; content?: unknown } };
        const payload = entry?.payload;
        if (payload?.type === "user_message") {
          const text = clipTitle(payload.message);
          if (text) title = text;
        } else if (payload?.type === "message" && payload.role === "user") {
          // Newer rollouts carry the user's turn as a response_item message;
          // injected instructions/context blocks use other roles or prefixes.
          const text = firstMessageText(payload.content);
          if (text && !MACHINE_LABEL.test(text)) {
            const label = clipTitle(text);
            if (label) title = label;
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (line.includes('"session_meta"')) {
      try {
        const entry = JSON.parse(line) as {
          payload?: { cwd?: unknown; id?: unknown; session_id?: unknown; forked_from_id?: unknown; forked_from_ordinal_exclusive?: unknown };
        };
        const payload = entry?.payload ?? {};
        if (!project && typeof payload.cwd === "string") project = payload.cwd;
        const metaSession = payload.id ?? payload.session_id;
        if (!session && typeof metaSession === "string") session = metaSession;
        if (typeof payload.forked_from_id === "string" && payload.forked_from_id) {
          fork = {
            forked: true,
            point: typeof payload.forked_from_ordinal_exclusive === "number" ? payload.forked_from_ordinal_exclusive : null,
            baselineDone: false,
            firstTs: null,
          };
        }
      } catch {
        /* ignore */
      }
      return;
    }
    if (line.includes('"turn_context"')) {
      try {
        const entry = JSON.parse(line) as { payload?: { model?: unknown } };
        const value = entry?.payload?.model;
        if (typeof value === "string" && value) model = value;
      } catch {
        /* ignore */
      }
      return;
    }
    if (!line.includes('"token_count"')) return;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    const info = entry?.payload?.info;
    if (!info) return;
    const total = info.total_token_usage;
    if (!total || typeof total !== "object") return;
    const current = [
      num(total.input_tokens),
      num(total.cached_input_tokens),
      num(total.cache_write_input_tokens),
      num(total.output_tokens),
      num(total.reasoning_output_tokens),
      num(total.total_tokens),
    ];
    const ts = Date.parse(entry.timestamp);
    const ordinal = num(entry.ordinal);

    if (fork.forked && !fork.baselineDone) {
      if (fork.point !== null) {
        if (!(ordinal > 0 && ordinal > fork.point)) {
          // Replayed or pre-fork event: keep it only as the running baseline.
          totals = current;
          return;
        }
        // First event after the fork point: its cumulative totals carry the
        // parent's history (kept as the baseline), but last_token_usage is
        // this request's own usage and must still be counted. The request
        // happened for real after the fork (typically the session-start
        // request), and reverse proxies see it too.
        const last = info.last_token_usage as Record<string, unknown> | undefined;
        if (last && typeof last === "object" && Number.isFinite(ts)) {
          const lCached = num(last.cached_input_tokens);
          const lInput = num(last.input_tokens);
          const lOutput = num(last.output_tokens);
          if (lInput + lCached + lOutput > 0) {
            const input = Math.max(0, lInput - lCached);
            addBucket(state.buckets, localHourKey(ts), CODEX, model || "codex", project, {
              r: 1,
              i: input,
              o: lOutput,
              cr: lCached,
              cw: num(last.cache_write_input_tokens),
              rz: num(last.reasoning_output_tokens),
            });
            applySession(state.sessions, CODEX, session, {
              t: ts,
              r: 1,
              p: project,
              title: title || undefined,
              i: input,
              o: lOutput,
              cr: lCached,
              cw: num(last.cache_write_input_tokens),
              rz: num(last.reasoning_output_tokens),
            });
            recordCall(state, CODEX, {
              t: ts,
              m: model || "codex",
              p: project,
              s: session,
              i: input,
              o: lOutput,
              cr: lCached,
              cw: num(last.cache_write_input_tokens),
              rz: num(last.reasoning_output_tokens),
              cost: 0,
              credits: 0,
            });
          }
        }
        fork.baselineDone = true;
        totals = current;
        return;
      }
      // Old format without a fork point: skip the replay burst right after the fork.
      if (fork.firstTs === null && Number.isFinite(ts)) fork.firstTs = ts;
      if (!Number.isFinite(ts) || fork.firstTs === null || ts - fork.firstTs <= BURST_WINDOW_MS) {
        totals = current;
        return;
      }
      fork.baselineDone = true;
      // Fall through: this first event after the replay window counts as a real delta.
    }
    if (fork.forked && fork.baselineDone && fork.point !== null && ordinal > 0 && ordinal <= fork.point) {
      totals = current;
      return;
    }

    const before = totals;
    totals = current;
    const delta = before ? current.map((value, index) => Math.max(0, value - (before[index] ?? 0))) : current.slice();
    const dInput = delta[0] ?? 0;
    const dCached = delta[1] ?? 0;
    const dCacheWrite = delta[2] ?? 0;
    const dOutput = delta[3] ?? 0;
    const dReasoning = delta[4] ?? 0;
    const dTotal = delta[5] ?? 0;
    if (dTotal <= 0) return;
    if (!Number.isFinite(ts)) return;
    const input = Math.max(0, dInput - dCached);
    addBucket(state.buckets, localHourKey(ts), CODEX, model || "codex", project, {
      r: 1,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning,
    });
    applySession(state.sessions, CODEX, session, {
      t: ts,
      r: 1,
      p: project,
      title: title || undefined,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning,
    });
    recordCall(state, CODEX, {
      t: ts,
      m: model || "codex",
      p: project,
      s: session,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning,
      cost: 0,
      credits: 0,
    });
  });
  if (!result) return;
  const fileState: FileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs, project, model, session };
  if (title) fileState.sessionTitle = title;
  if (totals) fileState.totals = totals;
  if (fork.forked) fileState.codexFork = fork;
  state.files[path] = fileState;
}
