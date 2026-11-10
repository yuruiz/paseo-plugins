import { stat } from "node:fs/promises";
import { claudeRoots, scanClaudeFile } from "./claude";
import { codexRoots, scanCodexFile } from "./codex";
import { scanOpencode } from "./opencode";
import { piRoots, scanPiFile } from "./pi";
import type { ScanState } from "./state";
import { listJsonlFiles } from "./util";

export interface ScanCallbacks {
  shouldStop(): boolean;
  onProgress(done: number, total: number): void;
  onCheckpoint(): void;
}

export async function scanAll(state: ScanState, callbacks: ScanCallbacks, enabledHarnesses?: ReadonlySet<string>): Promise<void> {
  if (await filesShrank(state)) {
    console.warn("[agent-usage] log file shrank; resetting counters and rescanning from zero");
    resetCounters(state);
  }
  const on = (id: string) => !enabledHarnesses || enabledHarnesses.has(id);
  const [claudeFiles, piFiles, codexFiles] = await Promise.all([
    collectRoots(claudeRoots()),
    collectRoots(piRoots()),
    collectRoots(codexRoots()),
  ]);
  const total =
    (on("claude") ? claudeFiles.length : 0) +
    (on("pi") ? piFiles.length : 0) +
    (on("codex") ? codexFiles.length : 0) +
    (on("opencode") ? 1 : 0);
  let done = 0;
  let checkpointAt = Date.now();
  callbacks.onProgress(done, total);
  const tick = () => {
    done += 1;
    callbacks.onProgress(done, total);
    const now = Date.now();
    if (now - checkpointAt > 5000) {
      checkpointAt = now;
      callbacks.onCheckpoint();
    }
  };
  const run = async (files: string[], scanOne: (state: ScanState, path: string) => Promise<void>): Promise<boolean> => {
    for (const file of files) {
      if (callbacks.shouldStop()) return false;
      try {
        await scanOne(state, file);
      } catch (error) {
        console.error("[agent-usage] scan failed for", file, error);
      }
      tick();
    }
    return true;
  };
  if (on("claude") && !(await run(claudeFiles, scanClaudeFile))) return;
  if (on("pi") && !(await run(piFiles, scanPiFile))) return;
  if (on("opencode")) {
    if (callbacks.shouldStop()) return;
    try {
      await scanOpencode(state);
    } catch (error) {
      console.error("[agent-usage] opencode scan failed", error);
    }
    tick();
  }
  if (on("codex") && !(await run(codexFiles, scanCodexFile))) return;
  callbacks.onCheckpoint();
}

async function collectRoots(roots: string[]): Promise<string[]> {
  const seen = new Set<string>();
  for (const root of roots) {
    for (const file of await listJsonlFiles(root)) seen.add(file);
  }
  return [...seen].sort();
}

/** True when a tracked file became smaller than the offset we already consumed. */
async function filesShrank(state: ScanState): Promise<boolean> {
  for (const [path, file] of Object.entries(state.files)) {
    if (!file || !(file.offset > 0)) continue;
    try {
      const info = await stat(path);
      if (info.isFile() && info.size < file.offset) return true;
    } catch {
      // Deleted files keep their already-counted history.
    }
  }
  return false;
}

function resetCounters(state: ScanState): void {
  state.buckets = {};
  state.sessions = {};
  state.files = {};
  state.recent = {};
  state.opencode = { watermark: 0, lastId: "" };
  state.pi = { seen: [] };
}
