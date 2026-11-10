import type { UsageSnapshot } from "./snapshot";
import type { ReportState, UsageBucket } from "./records";
import type { HostView, ScanInfo } from "./report";
import { localHourKey } from "./time";

export const FLEET_ORIGIN = "paseo:all";
export const isFleetOrigin = (origin?: string) => origin?.startsWith("paseo:") ?? false;
export const sourceOrigin = (id: string) => `paseo:${id}`;

export interface FleetSource {
  key: number;
  snapshot?: UsageSnapshot;
  failed: boolean;
}

export function assembleFleet(sources: readonly FleetSource[]) {
  const state: ReportState = { buckets: {}, sessions: {}, recent: {}, hosts: {}, meta: { scanError: null } };
  const scan: ScanInfo = { scanning: false, done: 0, total: 0 };
  const hosts: HostView[] = [];
  const labels = new Map<string, string>();
  // A daemon may appear through two connections or runtime IDs. Count it once.
  const unique = new Map<string, FleetSource>();
  for (const source of sources) {
    const id = source.snapshot?.sourceId ?? `pending:${source.key}`;
    const previous = unique.get(id);
    if (!previous || (previous.failed && !source.failed) ||
      (previous.failed === source.failed && (source.snapshot?.generatedAt ?? 0) > (previous.snapshot?.generatedAt ?? 0))) {
      unique.set(id, source);
    }
  }
  let ready = 0;
  let partial = false;
  for (const [id, source] of unique) {
    const snapshot = source.snapshot;
    const name = sourceOrigin(id);
    const unavailable = source.failed || !snapshot || !snapshot.lastScanAt || Boolean(snapshot.scanError);
    if (unavailable) partial = true;
    else ready++;
    labels.set(name, snapshot?.label || `Paseo host ${source.key}`);
    hosts.push({
      name, target: "", status: unavailable ? "error" : snapshot.scanning ? "pulling" : "ok",
      lastPullAt: snapshot?.lastScanAt ?? null,
      lastError: unavailable ? (snapshot?.lastScanAt ? "stale" : "unavailable") : null,
    });
    if (!snapshot) continue;
    scan.scanning ||= !source.failed && snapshot.scanning;
    scan.done += snapshot.scanDone;
    scan.total += snapshot.scanTotal;
    const buckets: Record<string, UsageBucket> = {};
    for (const [key, bucket] of Object.entries(snapshot.buckets)) {
      const [utc, ...dimensions] = key.split("\u0001");
      const time = Date.parse(utc);
      if (!Number.isFinite(time)) continue;
      const localKey = [localHourKey(time), ...dimensions].join("\u0001");
      const existing = buckets[localKey];
      if (existing) {
        for (const field of Object.keys(existing) as (keyof UsageBucket)[]) existing[field] += bucket[field];
      } else buckets[localKey] = { ...bucket };
    }
    // Session identifiers are only unique within one daemon.
    const sessions = Object.fromEntries(Object.entries(snapshot.sessions).map(([key, value]) => {
      const separator = key.indexOf("\u0001");
      return [`${key.slice(0, separator)}\u0001${id}:${key.slice(separator + 1)}`, { ...value }];
    }));
    const recent = Object.fromEntries(Object.entries(snapshot.recent).map(([agent, calls]) =>
      [agent, calls.map((call) => ({ ...call, s: `${id}:${call.s}` }))]));
    state.hosts[name] = { buckets, sessions, recent };
  }
  return { state, scan, hosts, labels, ready, total: unique.size, partial, hasData: sources.some((source) => source.snapshot?.lastScanAt != null) };
}

export function footerTotals(state: ReportState, now = new Date()): Record<"24h" | "7d" | "30d", number> {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = (days: number) => {
    const date = new Date(midnight);
    date.setDate(date.getDate() - days);
    return localHourKey(date.getTime());
  };
  // Match the dashboard: current hour + 23 preceding hourly buckets; calendar 7/30 days.
  const floors = { "24h": localHourKey(now.getTime() - 23 * 3_600_000), "7d": start(6), "30d": start(29) };
  const totals = { "24h": 0, "7d": 0, "30d": 0 };
  const ceiling = localHourKey(now.getTime());
  for (const source of [state, ...Object.values(state.hosts)]) {
    for (const [key, bucket] of Object.entries(source.buckets)) {
      const hour = key.split("\u0001")[0];
      if (hour > ceiling) continue;
      const tokens = bucket.i + bucket.o + bucket.cr + bucket.cw;
      for (const range of ["24h", "7d", "30d"] as const) if (hour >= floors[range]) totals[range] += tokens;
    }
  }
  return totals;
}
