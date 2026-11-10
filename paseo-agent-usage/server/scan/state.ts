import type { UsageBucket, CallRecord, SessionEntry } from "../../shared/records";
export type { UsageBucket, CallRecord, SessionEntry } from "../../shared/records";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const STATE_VERSION = 13;

/** The last usage recorded for one Claude message id, so streaming snapshots replace instead of add. */
export interface RecentContribution {
  id: string;
  d: string;
  m: string;
  p: string;
  i: number;
  o: number;
  cr: number;
  cw: number;
  rz: number;
}

export interface CodexForkState {
  forked: boolean;
  point: number | null;
  baselineDone: boolean;
  firstTs: number | null;
}

/** Keeps the sessions index bounded (≈1MB): counted requests drop dead entries,
 *  and once the cap is hit the oldest sessions are evicted first. */
const SESSION_KEEP_LIMIT = 8000;

export function pruneSessions(sessions: Record<string, SessionEntry>): void {
  for (const key of Object.keys(sessions)) {
    const entry = sessions[key];
    if (!entry || entry.r <= 0) delete sessions[key];
  }
  const keys = Object.keys(sessions);
  if (keys.length <= SESSION_KEEP_LIMIT) return;
  keys.sort((a, b) => (sessions[b]?.e ?? 0) - (sessions[a]?.e ?? 0));
  for (const key of keys.slice(SESSION_KEEP_LIMIT)) delete sessions[key];
}

export interface SessionDelta {
  /** Counted call timestamp; establishes the session start/end. Revokes omit it. */
  t?: number;
  /** Request count delta: +1 per counted call, negative revokes mirror bucket deltas. */
  r: number;
  i?: number;
  o?: number;
  cr?: number;
  cw?: number;
  rz?: number;
  cost?: number;
  credits?: number;
  p?: string;
  /** Human label; only the first non-empty value wins so later calls keep it. */
  title?: string;
}

/** Applies one normalized call to a session's aggregate. Unknown sessions only
 *  materialize for positive deltas, so revoke passes cannot resurrect entries. */
export function applySession(sessions: Record<string, SessionEntry>, harness: string, sid: string, delta: SessionDelta): void {
  if (!sid) return;
  const key = `${harness}\u0001${sid}`;
  let entry = sessions[key];
  if (!entry) {
    if (delta.r <= 0) return;
    entry = { s: delta.t ?? 0, e: delta.t ?? 0, r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0, p: delta.p ?? "" };
    sessions[key] = entry;
  }
  entry.r += delta.r;
  entry.i += delta.i ?? 0;
  entry.o += delta.o ?? 0;
  entry.cr += delta.cr ?? 0;
  entry.cw += delta.cw ?? 0;
  entry.rz += delta.rz ?? 0;
  entry.cost += delta.cost ?? 0;
  entry.credits += delta.credits ?? 0;
  if (delta.p) entry.p = delta.p;
  if (delta.title && !entry.title) entry.title = delta.title;
  if (typeof delta.t === "number" && Number.isFinite(delta.t)) {
    if (delta.t < entry.s) entry.s = delta.t;
    if (delta.t > entry.e) entry.e = delta.t;
  }
}

export interface FileState {
  offset: number;
  size: number;
  mtimeMs: number;
  project?: string;
  model?: string;
  session?: string;
  /** First user message captured for the session label (claude/codex/pi). */
  sessionTitle?: string;
  /** Codex fork bookkeeping: a forked rollout's baseline/replay part is not usage. */
  codexFork?: CodexForkState;
  /** Last seen Codex cumulative totals: [input, cached, cacheWrite, output, reasoning, total]. */
  totals?: number[];
  recent?: RecentContribution[];
}

export interface RemoteHostState {
  target: string;
  buckets: Record<string, UsageBucket>;
  recent: Record<string, CallRecord[]>;
  sessions: Record<string, SessionEntry>;
  lastPullAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  node: string | null;
  generatedAt: number | null;
}

export interface ScanState {
  version: typeof STATE_VERSION;
  buckets: Record<string, UsageBucket>;
  /** Per-session aggregates for locally scanned logs, keyed `harness \u0001 sessionId`. */
  sessions: Record<string, SessionEntry>;
  files: Record<string, FileState>;
  recent: Record<string, CallRecord[]>;
  opencode: { watermark: number; lastId: string };
  /**
   * Pi cross-file dedup ledger: "entryId@timestamp" keys of every counted
   * message. Pi fork / sub-run files copy messages from their parent, so the
   * same key can appear in several files; only the first occurrence counts.
   */
  pi: { seen: string[] };
  /** Projections pulled from remote machines over SSH, keyed by host name. */
  hosts: Record<string, RemoteHostState>;
  meta: { lastScanAt: number | null; scanError: string | null };
}

const MAX_RECENT_PER_AGENT = 400;

export function emptyState(): ScanState {
  return {
    version: STATE_VERSION,
    buckets: {},
    sessions: {},
    files: {},
    recent: {},
    opencode: { watermark: 0, lastId: "" },
    pi: { seen: [] },
    hosts: {},
    meta: { lastScanAt: null, scanError: null },
  };
}

export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const raw = env.PASEO_HOME?.trim();
  const fallback = join(home, ".paseo");
  if (!raw) return fallback;
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return resolve(home, raw.slice(2));
  if (isAbsolute(raw)) return resolve(raw);
  return fallback;
}

export function pluginDataDir(): string {
  return join(resolvePaseoHome(), "plugin-data", "agent-usage-plugin");
}

/** Bucket keys are `hourKey \u0001 harness \u0001 model \u0001 project`, where hourKey is `YYYY-MM-DDTHH`. */
export function bucketKey(hourKey: string, harness: string, model: string, project: string): string {
  return [hourKey, harness, model, project].join("\u0001");
}

export function addBucket(
  buckets: Record<string, UsageBucket>,
  hourKey: string,
  harness: string,
  model: string,
  project: string,
  delta: Partial<UsageBucket> & { r: number },
): void {
  const key = bucketKey(hourKey, harness, model, project);
  let bucket = buckets[key];
  if (!bucket) {
    bucket = { r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0 };
    buckets[key] = bucket;
  }
  bucket.r += delta.r;
  bucket.i += delta.i ?? 0;
  bucket.o += delta.o ?? 0;
  bucket.cr += delta.cr ?? 0;
  bucket.cw += delta.cw ?? 0;
  bucket.rz += delta.rz ?? 0;
  bucket.cost += delta.cost ?? 0;
  bucket.credits += delta.credits ?? 0;
  if (
    bucket.r <= 0 &&
    bucket.i <= 0 &&
    bucket.o <= 0 &&
    bucket.cr <= 0 &&
    bucket.cw <= 0 &&
    bucket.rz <= 0 &&
    bucket.cost <= 0 &&
    bucket.credits <= 0
  ) {
    delete buckets[key];
  }
}

/**
 * Appends a call to the per-agent ring buffer. When `replaceId` matches a recent
 * record (Claude streaming snapshots), the existing entry is replaced in place.
 */
export function recordCall(state: ScanState, harness: string, record: CallRecord, replaceId?: string): void {
  let list = state.recent[harness];
  if (!list) {
    list = [];
    state.recent[harness] = list;
  }
  if (replaceId) {
    const floor = Math.max(0, list.length - 32);
    for (let index = list.length - 1; index >= floor; index -= 1) {
      if (list[index]?.id === replaceId) {
        list[index] = record;
        return;
      }
    }
  }
  list.push(record);
  if (list.length > MAX_RECENT_PER_AGENT) list.splice(0, list.length - MAX_RECENT_PER_AGENT);
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sanitizeBuckets(raw: unknown): Record<string, UsageBucket> {
  const buckets: Record<string, UsageBucket> = {};
  if (!raw || typeof raw !== "object") return buckets;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    buckets[key] = {
      r: finite(record.r),
      i: finite(record.i),
      o: finite(record.o),
      cr: finite(record.cr),
      cw: finite(record.cw),
      rz: finite(record.rz),
      cost: finite(record.cost),
      credits: finite(record.credits),
    };
  }
  return buckets;
}

function sanitizeSessions(raw: unknown): Record<string, SessionEntry> {
  const sessions: Record<string, SessionEntry> = {};
  if (!raw || typeof raw !== "object") return sessions;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    sessions[key] = {
      s: finite(record.s),
      e: finite(record.e),
      r: finite(record.r),
      i: finite(record.i),
      o: finite(record.o),
      cr: finite(record.cr),
      cw: finite(record.cw),
      rz: finite(record.rz),
      cost: finite(record.cost),
      credits: finite(record.credits),
      p: typeof record.p === "string" ? record.p : "",
      title: typeof record.title === "string" ? record.title : undefined,
    };
  }
  return sessions;
}

export async function loadState(dir: string): Promise<ScanState> {
  try {
    const text = await readFile(join(dir, "state.json"), "utf8");
    const parsed = JSON.parse(text) as Partial<ScanState>;
    if (!parsed || typeof parsed !== "object" || parsed.version !== STATE_VERSION) return emptyState();
    const state = emptyState();
    state.buckets = sanitizeBuckets(parsed.buckets);
    state.sessions = sanitizeSessions(parsed.sessions);
    state.files = (parsed.files as ScanState["files"]) ?? {};
    state.recent = (parsed.recent as ScanState["recent"]) ?? {};
    state.opencode = {
      watermark: finite(parsed.opencode?.watermark),
      lastId: typeof parsed.opencode?.lastId === "string" ? parsed.opencode.lastId : "",
    };
    state.pi = { seen: Array.isArray(parsed.pi?.seen) ? (parsed.pi.seen as string[]).filter((k) => typeof k === "string") : [] };
    state.hosts = (parsed.hosts as ScanState["hosts"]) ?? {};
    state.meta = {
      lastScanAt: typeof parsed.meta?.lastScanAt === "number" ? parsed.meta.lastScanAt : null,
      scanError: typeof parsed.meta?.scanError === "string" ? parsed.meta.scanError : null,
    };
    return state;
  } catch {
    return emptyState();
  }
}

export async function saveState(dir: string, state: ScanState): Promise<void> {
  pruneSessions(state.sessions);
  for (const host of Object.values(state.hosts ?? {})) if (host?.sessions) pruneSessions(host.sessions);
  await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {});
  const file = join(dir, "state.json");
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, file);
  await chmod(dir, 0o700).catch(() => {});
}
