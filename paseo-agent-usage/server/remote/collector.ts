/**
 * Remote collector entry. Runs on an SSH target that has Node, scans that
 * machine's agent logs with the same adapters as the local plugin, and prints
 * a JSON projection (day buckets + recent call records) on stdout. Its small
 * incremental checkpoint lives under ~/.cache/agent-usage-plugin/state.json
 * on the remote machine.
 *
 * Invocation over SSH (the script arrives on stdin):
 *   ssh host "node - --cache-dir ~/.cache/agent-usage-plugin"`
 *
 * The local side only stores the printed projection; nothing else is written
 * remotely beyond the checkpoint file.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { scanAll } from "../scan/scanner";
import { emptyState, loadState, saveState, type ScanState } from "../scan/state";

function argValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cacheDir = argValue(args, "--cache-dir") || join(homedir(), ".cache", "agent-usage-plugin");
  const fresh = args.includes("--fresh");
  process.stderr.write(`agent-usage collector: node ${process.version}, cache ${cacheDir}${fresh ? ", fresh" : ""}\n`);
  const state: ScanState = fresh ? emptyState() : await loadState(cacheDir);
  let lastLog = 0;
  await scanAll(state, {
    shouldStop: () => false,
    onProgress: (done, total) => {
      const now = Date.now();
      if (now - lastLog > 3000 || done === total) {
        lastLog = now;
        process.stderr.write(`progress ${done}/${total}\n`);
      }
    },
    onCheckpoint: () => {
      void saveState(cacheDir, state).catch(() => {});
    },
  });
  state.meta.lastScanAt = Date.now();
  state.meta.scanError = null;
  await saveState(cacheDir, state);
  const projection = {
    v: 2,
    generatedAt: Date.now(),
    node: process.version,
    buckets: state.buckets,
    sessions: state.sessions,
    recent: state.recent,
  };
  process.stdout.write(JSON.stringify(projection));
  process.stderr.write(`agent-usage collector: done, ${Object.keys(state.buckets).length} buckets\n`);
}

main().catch((error) => {
  process.stderr.write(`agent-usage collector failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
