import { homedir } from "node:os";
import { join } from "node:path";
import { addBucket, applySession, recordCall, type ScanState } from "./state";
import { clipTitle, firstMessageText, forEachNewLine, localHourKey, MACHINE_LABEL, num } from "./util";

export const PI = "pi";

/**
 * Cross-file dedup ledger cap. Every counted message leaves an
 * "entryId@timestamp" key behind so that copies in other files are skipped.
 * 400k entries is decades of headroom; if the cap is ever reached the oldest
 * keys are dropped first (a much-older message newly copied into a fork could
 * then be counted again, which is acceptable at that scale).
 */
const PI_SEEN_LIMIT = 400_000;

/** Reuse the dedup lookup across files in one scan; rebuilt if the ledger array is replaced. */
const seenCache = new WeakMap<ScanState, { keys: string[]; set: Set<string> }>();

export function piRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = homedir();
  const roots: string[] = [];
  const sessionDir = env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (sessionDir) roots.push(sessionDir);
  const agentDir = env.PI_CODING_AGENT_DIR?.trim() || join(home, ".pi", "agent");
  roots.push(join(agentDir, "sessions"));
  return [...new Set(roots)];
}

export async function scanPiFile(state: ScanState, path: string): Promise<void> {
  const previousState = state.files[path];
  let project = previousState?.project ?? "";
  let title = previousState?.sessionTitle ?? "";
  const base = path.split("/").pop() ?? "";
  const underscore = base.lastIndexOf("_");
  const session = (underscore >= 0 ? base.slice(underscore + 1) : base).replace(/\.jsonl$/, "");
  const cached = seenCache.get(state);
  const ledger = !cached || cached.keys !== state.pi.seen ? { keys: state.pi.seen, set: new Set(state.pi.seen) } : cached;
  seenCache.set(state, ledger);
  const seen = ledger.set;
  const result = await forEachNewLine(path, previousState?.offset ?? 0, (line) => {
    if (line.includes('"role":"user"')) {
      try {
        const entry = JSON.parse(line);
        const raw = entry?.type === "message" && entry.message?.role === "user" ? firstMessageText(entry.message.content) : "";
        const text = raw && !MACHINE_LABEL.test(raw.trim()) ? clipTitle(raw) : "";
        if (text && !title) title = text;
      } catch {
        /* fall through: not a parseable user message */
      }
    }
    if (!project && line.includes('"type":"session"')) {
      try {
        const entry = JSON.parse(line) as { cwd?: unknown };
        if (typeof entry?.cwd === "string") project = entry.cwd;
      } catch {
        /* ignore */
      }
      return;
    }
    if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (entry?.type !== "message") return;
    const message = entry.message;
    if (!message || typeof message !== "object" || message.role !== "assistant") return;
    const usage = message.usage;
    if (!usage || typeof usage !== "object") return;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) return;
    // Pi fork / sub-run files replay messages copied from their parent with the
    // same entry id and timestamp. Count each message once across all files: a
    // rewritten or regenerated message gets a new id and is still counted.
    const entryId = typeof entry.id === "string" ? entry.id : "";
    const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
    if (entryId && timestamp) {
      const key = `${entryId}@${timestamp}`;
      if (seen.has(key)) return;
      seen.add(key);
      state.pi.seen.push(key);
    }
    const cost = typeof usage.cost?.total === "number" && usage.cost.total > 0 ? usage.cost.total : 0;
    const model = typeof message.model === "string" && message.model ? message.model : "unknown";
    const input = num(usage.input);
    const output = num(usage.output);
    const cacheRead = num(usage.cacheRead);
    const cacheWrite = num(usage.cacheWrite);
    const reasoning = num(usage.reasoning);
    addBucket(state.buckets, localHourKey(ts), PI, model, project, {
      r: 1,
      i: input,
      o: output,
      cr: cacheRead,
      cw: cacheWrite,
      rz: reasoning,
      cost,
    });
    applySession(state.sessions, PI, session, {
      t: ts,
      r: 1,
      p: project,
      title: title || undefined,
      i: input,
      o: output,
      cr: cacheRead,
      cw: cacheWrite,
      rz: reasoning,
      cost,
    });
    recordCall(state, PI, {
      t: ts,
      m: model,
      p: project,
      s: session,
      i: input,
      o: output,
      cr: cacheRead,
      cw: cacheWrite,
      rz: reasoning,
      cost,
      credits: 0,
    });
  });
  if (!result) return;
  if (state.pi.seen.length > PI_SEEN_LIMIT) {
    const removed = state.pi.seen.splice(0, state.pi.seen.length - PI_SEEN_LIMIT);
    for (const key of removed) seen.delete(key);
  }
  state.files[path] = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs, project, sessionTitle: title || undefined };
}
