import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { UsageSnapshot } from "../shared/snapshot";
import type { ScanState } from "./scan/state";

/** Stable across plugin reloads and alternate connections to the same daemon data. */
export async function readSourceId(dir: string): Promise<string> {
  const path = join(dir, "source-id");
  try {
    const value = (await readFile(path, "utf8")).trim();
    if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) return value;
    throw new Error("Invalid usage source identity");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const temporary = join(dir, `.source-id.${id}.tmp`);
  await writeFile(temporary, id, { flag: "wx", mode: 0o600 });
  try {
    // Publish complete contents atomically; a concurrent installation must never
    // observe an empty file between exclusive creation and the first write.
    await link(temporary, path);
    return id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return readSourceId(dir);
  } finally {
    await unlink(temporary);
  }
}

export function buildSnapshot(
  state: ScanState,
  enabled: ReadonlySet<string>,
  metadata: Pick<UsageSnapshot, "sourceId" | "label" | "scanning" | "scanDone" | "scanTotal">,
): UsageSnapshot {
  const buckets: UsageSnapshot["buckets"] = {};
  for (const [key, value] of Object.entries(state.buckets)) {
    const [hour, agent, ...rest] = key.split("\u0001");
    if (!enabled.has(agent)) continue;
    const time = new Date(`${hour}:00:00`).getTime();
    if (!Number.isFinite(time)) continue;
    buckets[[new Date(time).toISOString(), agent, ...rest].join("\u0001")] = { ...value };
  }
  const sessions: UsageSnapshot["sessions"] = {};
  for (const [key, value] of Object.entries(state.sessions)) {
    if (!enabled.has(key.split("\u0001")[0])) continue;
    // A session title may contain prompt text. Keep only numeric usage metadata.
    const { s, e, r, i, o, cr, cw, rz, cost, credits, p } = value;
    sessions[key] = { s, e, r, i, o, cr, cw, rz, cost, credits, p };
  }
  const recent: UsageSnapshot["recent"] = {};
  for (const [agent, records] of Object.entries(state.recent)) {
    if (!enabled.has(agent)) continue;
    recent[agent] = records.slice(-400).map(({ t, m, p, s, i, o, cr, cw, rz, cost, credits }) =>
      ({ t, m, p, s, i, o, cr, cw, rz, cost, credits }));
  }
  return {
    version: 1, ...metadata, generatedAt: Date.now(), lastScanAt: state.meta.lastScanAt,
    scanError: state.meta.scanError ? "Local usage scan failed" : null,
    buckets, sessions, recent,
  };
}
