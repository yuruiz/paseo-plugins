import { useMemo, useSyncExternalStore } from "react";
import { useQueries } from "@tanstack/react-query";
import { assembleFleet, FLEET_ORIGIN, type FleetSource } from "../shared/fleet";
import { buildReport, buildAgentReport } from "../shared/report";
import type { UsageGranularity, UsageRangeKey } from "../shared/usage";
import { fleetRegistry, withDeadline } from "./fleet-registry";

export function useFleet(enabled = true) {
  const entries = useSyncExternalStore(fleetRegistry.subscribe, fleetRegistry.getSnapshot, fleetRegistry.getSnapshot);
  const queries = useQueries({ queries: entries.map((entry) => ({
    queryKey: ["agent-usage-fleet", entry.key],
    queryFn: () => entry.read(),
    enabled,
    staleTime: 10_000,
    retry: false as const,
    refetchInterval: (query: { state: { data?: { scanning: boolean; lastScanAt: number | null } } }) =>
      query.state.data?.scanning || query.state.data?.lastScanAt === null ? 2_500 : 30_000,
  })) });
  const sources: FleetSource[] = queries.map((query, index) => ({
    key: entries[index].key, snapshot: query.data ?? entries[index].cached, failed: query.isError,
  }));
  // TanStack returns a new result array on every render, but data and status are stable.
  const revision = queries.map((query, i) => `${entries[i].key}:${query.dataUpdatedAt}:${query.errorUpdatedAt}`).join("|");
  const fleet = useMemo(() => assembleFleet(sources), [revision]);
  return {
    fleet,
    dataUpdatedAt: Math.max(0, ...queries.map((query) => query.dataUpdatedAt)),
    isFetching: queries.some((query) => query.isFetching),
    refetch: () => Promise.all(queries.map((query) => query.refetch())),
  };
}

export function useFleetReport(range: UsageRangeKey, origin: string | undefined, custom: { from: string; to: string } | undefined, granularity: UsageGranularity, enabled: boolean) {
  const query = useFleet(enabled);
  const data = useMemo(() => {
    if (!enabled || !query.fleet.hasData) return undefined;
    const { state, scan, hosts, labels } = query.fleet;
    const report = buildReport(state, range, scan, hosts, origin === FLEET_ORIGIN ? undefined : origin, undefined, custom, granularity);
    report.origins = report.origins.filter((item) => item.id !== "local").map((item) => ({ ...item, label: labels.get(item.id) ?? item.label }));
    return report;
  }, [enabled, query.fleet, range, origin, custom?.from, custom?.to, granularity]);
  return { ...query, data };
}

export function useFleetAgentReport(agent: string, range: UsageRangeKey, origin: string | undefined, custom: { from: string; to: string } | undefined, granularity: UsageGranularity, enabled: boolean) {
  const query = useFleet(enabled);
  const data = useMemo(() => enabled && query.fleet.hasData
    ? buildAgentReport(query.fleet.state, agent, range, origin === FLEET_ORIGIN ? undefined : origin, undefined, custom, granularity)
    : undefined, [enabled, query.fleet, agent, range, origin, custom?.from, custom?.to, granularity]);
  return { ...query, data };
}

export async function refreshFleet() {
  const results = await Promise.allSettled(fleetRegistry.getSnapshot().map((entry) => withDeadline(() => entry.refresh())));
  return { started: results.some((result) => result.status === "fulfilled") };
}
