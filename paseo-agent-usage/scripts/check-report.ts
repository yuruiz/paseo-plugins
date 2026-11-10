import assert from "node:assert/strict";
import { buildAgentReport, buildReport } from "../server/report";
import type { ScanState, UsageBucket } from "../server/scan/state";
import { STATE_VERSION } from "../server/scan/state";

const now = new Date();
const dateKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const hourKey = (date: Date): string => `${dateKey(date)}T${String(date.getHours()).padStart(2, "0")}`;
const bucket = (calls: number, input: number, output: number, cacheRead: number, cacheWrite: number, cost: number): UsageBucket => ({
  r: calls,
  i: input,
  o: output,
  cr: cacheRead,
  cw: cacheWrite,
  rz: 0,
  cost,
  credits: 0,
});
const add = (records: Record<string, UsageBucket>, key: string, value: UsageBucket): void => {
  records[key] = { ...value };
};
const b = (hour: Date, harness: string, model: string, project: string): string => [hourKey(hour), harness, model, project].join("\u0001");

const current = new Date(now.getTime() - 60 * 60 * 1000);
const previous = new Date(now.getTime() - 8 * 86_400_000);
const buckets: Record<string, UsageBucket> = {};
add(buckets, b(current, "codex", "gpt-test", "project-a"), bucket(2, 100, 50, 400, 10, 0.2));
add(buckets, b(previous, "claude", "claude-test", "project-b"), bucket(1, 80, 20, 200, 0, 0.1));

const sessionStart = current.getTime();
const previousStart = previous.getTime();
const state: ScanState = {
  version: STATE_VERSION,
  buckets,
  sessions: {
    "codex\u0001s-current": { s: sessionStart, e: sessionStart + 30 * 60_000, r: 2, i: 100, o: 50, cr: 400, cw: 10, rz: 0, cost: 0.2, credits: 0, p: "project-a", title: "Current session" },
    "claude\u0001s-previous": { s: previousStart, e: previousStart + 20 * 60_000, r: 1, i: 80, o: 20, cr: 200, cw: 0, rz: 0, cost: 0.1, credits: 0, p: "project-b", title: "Previous session" },
  },
  files: {},
  recent: {
    codex: [
      { t: sessionStart, m: "gpt-test", p: "project-a", s: "s-current", i: 100, o: 50, cr: 400, cw: 10, rz: 0, cost: 0.2, credits: 0 },
    ],
  },
  opencode: { watermark: 0, lastId: "" },
  pi: { seen: [] },
  hosts: {},
  meta: { lastScanAt: now.getTime(), scanError: null },
};

const enabled = new Set(["claude", "codex", "opencode", "pi"]);
const report = buildReport(state, "7d", { scanning: false, done: 0, total: 0 }, [], undefined, enabled, null, "day");
assert.equal(report.totals.requests, 2);
assert.equal(report.previousTotals.requests, 1);
assert.equal(report.series.length, 7);
assert.equal(new Date(`${report.calendar.start}T00:00:00.000Z`).getUTCDay(), 1, "calendar starts on Monday");
assert.equal(report.hourOfWeek.tokens.length, 168);
assert.equal(report.hourOfDay.tokens.length, 24);
assert.equal(report.weekday.tokens.length, 7);
assert.equal(report.sessionStats.count, 1);
assert.equal(report.sessionStats.scatter.length, 1);
assert.equal(report.sessionStats.top[0]?.title, "Current session");
assert.equal(report.requestStats.sampled, 1);
assert.equal(report.pairs.agentModels.rows[0], "codex");
assert.equal(report.pairs.agentHours.cols.length, 24);
assert.equal(report.monthToDate.requests >= 2, true);
assert.equal(report.origins[0]?.id, "local");

const agent = buildAgentReport(state, "codex", "7d", undefined, enabled, null, "day");
assert.equal(agent.totals.requests, 2);
assert.equal(agent.sessionCount, 1);
assert.equal(agent.sessionStats.count, 1);
assert.equal(agent.series.length, 7);

console.log("report checks passed");
