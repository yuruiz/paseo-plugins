import { homedir } from "node:os";
import { join } from "node:path";
import { addBucket, applySession, recordCall, type FileState, type RecentContribution, type ScanState } from "./state";
import { clipTitle, firstMessageText, forEachNewLine, localHourKey, MACHINE_LABEL, num } from "./util";

export const CLAUDE = "claude";

export function claudeRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = homedir();
  const base = env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  return [...new Set([join(base, "projects"), join(home, ".config", "claude", "projects")])];
}

export async function scanClaudeFile(state: ScanState, path: string): Promise<void> {
  const previousState = state.files[path];
  const recent = new Map<string, RecentContribution>();
  let sessionTitle = previousState?.sessionTitle ?? "";
  if (previousState?.recent) {
    for (const contribution of previousState.recent) recent.set(contribution.id, contribution);
  }
  const result = await forEachNewLine(path, previousState?.offset ?? 0, (line) => {
    if (!line.includes('"sessionId"')) return;
    if (line.includes('"type":"user"')) {
      try {
        const entry = JSON.parse(line);
        if (entry?.type === "user") {
          const raw = firstMessageText(entry.message?.content);
          const text = raw && !MACHINE_LABEL.test(raw.trim()) ? clipTitle(raw) : "";
          if (text && !sessionTitle) sessionTitle = text;
          return;
        }
      } catch {
        /* fall through: this line is not a parseable user entry */
      }
    }
    if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (entry?.type !== "assistant") return;
    const message = entry.message;
    if (!message || typeof message !== "object") return;
    const usage = message.usage;
    if (!usage || typeof usage !== "object") return;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) return;
    const id = typeof message.id === "string" && message.id ? message.id : null;
    const sid = typeof entry.sessionId === "string" ? entry.sessionId : "";
    const contribution: RecentContribution = {
      id: id ?? "",
      d: localHourKey(ts),
      m: typeof message.model === "string" && message.model ? message.model : "unknown",
      p: typeof entry.cwd === "string" ? entry.cwd : "",
      i: num(usage.input_tokens),
      o: num(usage.output_tokens),
      cr: num(usage.cache_read_input_tokens),
      cw: num(usage.cache_creation_input_tokens),
      rz: num((usage.output_tokens_details as { thinking_tokens?: unknown } | undefined)?.thinking_tokens),
    };
    if (id && recent.has(id)) {
      const before = recent.get(id) as RecentContribution;
      addBucket(state.buckets, before.d, CLAUDE, before.m, before.p, {
        r: -1,
        i: -before.i,
        o: -before.o,
        cr: -before.cr,
        cw: -before.cw,
        rz: -before.rz,
      });
      applySession(state.sessions, CLAUDE, sid, {
        r: -1,
        i: -before.i,
        o: -before.o,
        cr: -before.cr,
        cw: -before.cw,
        rz: -before.rz,
      });
    }
    if (id) {
      recent.set(id, contribution);
      if (recent.size > 96) {
        const oldest = recent.keys().next().value;
        if (typeof oldest === "string" && oldest !== id) recent.delete(oldest);
      }
    }
    addBucket(state.buckets, contribution.d, CLAUDE, contribution.m, contribution.p, {
      r: 1,
      i: contribution.i,
      o: contribution.o,
      cr: contribution.cr,
      cw: contribution.cw,
      rz: contribution.rz,
    });
    applySession(state.sessions, CLAUDE, sid, {
      t: ts,
      r: 1,
      p: contribution.p,
      i: contribution.i,
      o: contribution.o,
      cr: contribution.cr,
      cw: contribution.cw,
      rz: contribution.rz,
      title: sessionTitle || undefined,
    });
    recordCall(
      state,
      CLAUDE,
      {
        t: ts,
        m: contribution.m,
        p: contribution.p,
        s: sid,
        i: contribution.i,
        o: contribution.o,
        cr: contribution.cr,
        cw: contribution.cw,
        rz: contribution.rz,
        cost: 0,
        credits: 0,
        id: id ?? undefined,
      },
      id ?? undefined,
    );
  });
  if (!result) return;
  const fileState: FileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs };
  if (sessionTitle) fileState.sessionTitle = sessionTitle;
  if (recent.size > 0) fileState.recent = [...recent.values()].slice(-96);
  state.files[path] = fileState;
}
