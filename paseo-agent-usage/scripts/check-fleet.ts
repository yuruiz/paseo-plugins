import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, type UsageBucket } from "../server/scan/state";
import { buildSnapshot, readSourceId } from "../server/snapshot";
import { usageSnapshotSchema, type UsageSnapshot } from "../shared/snapshot";
import { assembleFleet, footerTotals, sourceOrigin } from "../shared/fleet";
import { buildReport, buildAgentReport } from "../shared/report";
import { localHourKey } from "../shared/time";
import { createFleetRegistry, withDeadline } from "../client/fleet-registry";

const now = new Date();
const hour = now.getTime();
const enabled = new Set(["codex"]);
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const metric = (n: number): UsageBucket => ({ r: 1, i: n, o: 2 * n, cr: 3 * n, cw: 4 * n, rz: n, cost: n / 100, credits: 0 });

function fixture(sourceId: string, scale: number) {
  const state = emptyState();
  state.meta.lastScanAt = hour;
  for (const [days, weight] of [[0, 1], [2, 2], [10, 3], [40, 4]]) {
    const key = [localHourKey(hour - days * 86_400_000), "codex", "test-model", "acme-project"].join("\u0001");
    state.buckets[key] = metric(scale * weight);
  }
  state.buckets[`${localHourKey(hour)}\u0001claude\u0001test-model\u0001acme-project`] = metric(999);
  state.sessions["codex\u0001same-session"] = { ...metric(scale), s: hour - 1000, e: hour, p: "acme-project", title: "PRIVATE_PROMPT_PLACEHOLDER" };
  state.recent.codex = [{ ...metric(scale), t: hour, m: "test-model", p: "acme-project", s: "same-session" }];
  state.files["PRIVATE_FILE_PLACEHOLDER"] = { offset: 0, size: 0, mtimeMs: 0 };
  state.hosts.ssh = { target: "user@example.com", buckets: { [`${localHourKey(hour)}\u0001codex\u0001test-model\u0001acme-project`]: metric(999) }, sessions: {}, recent: {}, lastPullAt: hour, lastAttemptAt: hour, lastError: null, node: null, generatedAt: hour };
  return usageSnapshotSchema.parse(buildSnapshot(state, enabled, { sourceId, label: "Example host", scanning: false, scanDone: 2, scanTotal: 2 }));
}

async function main() {
  const one = fixture(ids[0], 1);
  const two = fixture(ids[1], 10);
  const text = JSON.stringify(one);
  assert(!text.includes("PRIVATE_"), "no prompt-derived title or scanner path leaves the daemon");
  assert(!text.includes("user@example.com"), "SSH projections and credentials are excluded");
  assert(!text.includes("claude"), "disabled agents are excluded");
  assert.equal(usageSnapshotSchema.safeParse({ ...one, buckets: { invalid: { ...metric(1), i: Infinity } } }).success, false);
  assert.equal(usageSnapshotSchema.safeParse({ ...one, version: 2 }).success, false);

  const fleet = assembleFleet([{ key: 1, snapshot: one, failed: false }, { key: 2, snapshot: two, failed: false }]);
  assert.deepEqual(footerTotals(fleet.state, now), { "24h": 110, "7d": 330, "30d": 660 });
  assert.equal(fleet.ready, 2);
  const zero = assembleFleet([{ key: 1, snapshot: { ...one, buckets: {}, sessions: {}, recent: {} }, failed: false }]);
  assert.equal(zero.hasData, true, "a completed scan with zero usage is available data");
  assert.equal(footerTotals(zero.state, now)["24h"], 0);
  for (const range of ["24h", "7d", "30d"] as const) {
    const report = buildReport(fleet.state, range, fleet.scan, fleet.hosts);
    assert.equal(report.totals.input + report.totals.output + report.totals.cacheRead + report.totals.cacheWrite, footerTotals(fleet.state, now)[range], "footer and dashboard agree");
    assert.equal(report.models[0].totalTokens, footerTotals(fleet.state, now)[range]);
    assert.equal(report.sessionStats.count, 2);
    assert.equal(new Set(report.sessionStats.top.map((session) => session.id)).size, 2, "session IDs are namespaced per source");
    assert.equal(report.sessionStats.medianTokens, 10, "combined nearest-rank median is recomputed from sessions");
    assert.equal(report.sessionStats.p90Tokens, 100);
  }
  const agent = buildAgentReport(fleet.state, "codex", "7d");
  assert.equal(agent.totals.input, 33);
  assert.equal(agent.requests.length, 2);
  assert.equal(new Set(agent.requests.map((call) => call.origin)).size, 2);
  const single = buildReport(fleet.state, "7d", fleet.scan, fleet.hosts, sourceOrigin(ids[0]));
  assert.equal(single.totals.input, 3, "individual host selection is isolated");

  const duplicate = assembleFleet([
    { key: 1, snapshot: one, failed: true }, { key: 2, snapshot: two, failed: false },
    { key: 3, snapshot: { ...one, generatedAt: one.generatedAt + 1 }, failed: false },
  ]);
  assert.equal(duplicate.total, 2);
  assert.equal(duplicate.partial, false, "a working connection supersedes a stale duplicate");
  assert.equal(footerTotals(duplicate.state, now)["7d"], 330, "alternate connections do not double count");
  const partial = assembleFleet([{ key: 1, snapshot: one, failed: true }, { key: 2, failed: true }]);
  assert.equal(partial.partial, true);
  assert.equal(partial.ready, 0);
  assert.equal(partial.total, 2);
  assert.equal(footerTotals(partial.state, now)["24h"], 10, "failed sources keep their last snapshot");
  assert.equal(assembleFleet([{ key: 1, failed: true }]).hasData, false, "missing data must not become a zero total");

  const boundary = emptyState();
  const oldestHour = hour - 23 * 3_600_000;
  for (const [time, weight] of [[oldestHour, 1], [oldestHour - 3_600_000, 10], [hour + 3_600_000, 100]]) {
    boundary.buckets[`${localHourKey(time)}\u0001codex\u0001test\u0001acme-project`] = metric(weight);
  }
  assert.equal(footerTotals(boundary, now)["24h"], 10, "24h includes exactly 24 hourly buckets and excludes future hours");
  for (const [days, range] of [[6, "7d"], [29, "30d"]] as const) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
    const state = emptyState();
    state.buckets[`${localHourKey(start.getTime())}\u0001codex\u0001test\u0001acme-project`] = metric(1);
    state.buckets[`${localHourKey(start.getTime() - 3_600_000)}\u0001codex\u0001test\u0001acme-project`] = metric(10);
    assert.equal(footerTotals(state, now)[range], 10, `${range} calendar boundary`);
  }

  const originalTZ = process.env.TZ;
  try {
    const utcHour = "2026-06-15T02:00:00.000Z";
    const snapshots: UsageSnapshot[] = [];
    for (const timezone of ["UTC", "Asia/Shanghai"]) {
      process.env.TZ = timezone;
      const state = emptyState();
      state.meta.lastScanAt = Date.parse(utcHour);
      state.buckets[`${localHourKey(Date.parse(utcHour))}\u0001codex\u0001test\u0001acme-project`] = metric(1);
      snapshots.push(buildSnapshot(state, enabled, { sourceId: ids[snapshots.length], label: "Example host", scanning: false, scanDone: 0, scanTotal: 0 }));
    }
    process.env.TZ = "America/New_York";
    const shifted = assembleFleet(snapshots.map((snapshot, key) => ({ key, snapshot, failed: false })));
    assert.equal(footerTotals(shifted.state, new Date("2026-06-15T03:00:00.000Z"))["24h"], 20, "hosts in different time zones share one timeline");
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }

  const registry = createFleetRegistry();
  let changes = 0;
  const unsubscribe = registry.subscribe(() => changes++);
  let reads = 0;
  const remove = registry.register(async () => { reads++; return one; }, async () => ({}));
  const entry = registry.getSnapshot()[0];
  await Promise.all([entry.read(), entry.read()]);
  assert.equal(reads, 1, "concurrent surfaces share one RPC");
  assert.equal(entry.cached, one);
  remove(); remove();
  assert.equal(registry.getSnapshot().length, 0);
  assert.equal(entry.cached, undefined);
  await assert.rejects(entry.read());
  const removeReplacement = registry.register(async () => two, async () => ({}));
  assert.notEqual(registry.getSnapshot()[0].key, entry.key, "reloads cannot reuse a stale query key");
  assert.equal(changes, 3);
  unsubscribe(); removeReplacement();
  await assert.rejects(withDeadline(() => new Promise<never>(() => {}), 5), /unavailable/);
  assert.equal(await withDeadline(async () => 42), 42);

  const dir = await mkdtemp(join(tmpdir(), "usage-source-test-"));
  try {
    const identities = await Promise.all([readSourceId(dir), readSourceId(dir)]);
    assert.equal(identities[0], identities[1], "concurrent installations share a stable source identity");
    assert.equal(await readSourceId(dir), identities[0]);
  } finally { await rm(dir, { recursive: true, force: true }); }
  console.log("fleet checks passed (ranges, aggregation, privacy, time zones, duplicates, stale data, lifecycle)");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
