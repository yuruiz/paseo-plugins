/**
 * Dev-only helper: run a full local scan and print per-agent totals.
 * Usage: npx tsx server/dev/scan.ts [--fresh]
 */
import { buildReport } from "../report";
import { scanAll } from "../scan/scanner";
import { emptyState, loadState, pluginDataDir, saveState, type UsageBucket } from "../scan/state";

async function main(): Promise<void> {
  const dirArgIndex = process.argv.indexOf("--dir");
  const dir = dirArgIndex >= 0 && process.argv[dirArgIndex + 1] ? process.argv[dirArgIndex + 1] : pluginDataDir();
  const state = process.argv.includes("--fresh") ? emptyState() : await loadState(dir);
  const startedAt = Date.now();
  let lastLog = 0;
  await scanAll(state, {
    shouldStop: () => false,
    onProgress: (done, total) => {
      if (Date.now() - lastLog > 3_000 || done === total) {
        lastLog = Date.now();
        console.log(`progress ${done}/${total}`);
      }
    },
    onCheckpoint: () => {},
  });
  state.meta.lastScanAt = Date.now();
  await saveState(dir, state);
  const hostViews = Object.entries(state.hosts).map(([name, host]) => ({
    name,
    target: host.target,
    status: (host.lastError ? "error" : "ok") as "ok" | "error",
    lastPullAt: host.lastPullAt,
    lastError: host.lastError,
  }));
  const report = buildReport(state, "30d", { scanning: false, done: 0, total: 0 }, hostViews);
  console.log("agents:", JSON.stringify(report.agents, null, 2));
  console.log("totals:", JSON.stringify(report.totals));
  console.log("firstDay:", report.firstDay, "| buckets:", Object.keys(state.buckets).length, "| elapsed:", ((Date.now() - startedAt) / 1000).toFixed(1) + "s");
  console.log("recent records:", JSON.stringify(Object.fromEntries(Object.entries(state.recent).map(([key, list]) => [key, list.length]))));
  const allTime: Record<string, { requests: number; tokens: number }> = {};
  for (const [key, bucket] of Object.entries(state.buckets) as Array<[string, UsageBucket]>) {
    const harness = key.split("\u0001")[1] ?? "?";
    const entry = allTime[harness] ?? { requests: 0, tokens: 0 };
    entry.requests += bucket.r;
    entry.tokens += bucket.i + bucket.o + bucket.cr + bucket.cw;
    allTime[harness] = entry;
  }
  console.log("allTime:", JSON.stringify(allTime));
  console.log("origins:", JSON.stringify(report.origins));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
