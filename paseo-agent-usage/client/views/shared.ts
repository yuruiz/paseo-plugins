import type { UsageAgent, UsageOrigin, UsageSeriesPoint, UsageSessionItem, UsageTotals } from "../../shared/usage";
import type { DashboardData } from "../dashboard-data";
import { cacheHitRate } from "../dashboard-data";
import type { Locale } from "../dashboard-model";
import type { Theme } from "../visuals";
import { formatCount, formatDurationMs, formatTokens, formatUsd } from "../format";

export interface CardProps {
  data: DashboardData;
  theme: Theme;
  compact: boolean;
  locale: Locale;
  budgetUsd?: number;
  localAlias?: string;
}

export function pick(locale: Locale, zh: string, en: string): string {
  return locale === "zh" ? zh : en;
}

/** The daemon labels the local origin in its own locale; localize it at render time, preferring the user's alias. */
export function originLabel(origin: Pick<UsageOrigin, "id" | "label">, locale: Locale, localAlias?: string): string {
  if (origin.id !== "local") return origin.label;
  return localAlias?.trim() || pick(locale, "本机", "Local");
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

export function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function percentText(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function downsampleSeries(series: readonly UsageSeriesPoint[], limit: number): UsageSeriesPoint[] {
  if (series.length <= limit || limit <= 0) return [...series];
  const size = Math.ceil(series.length / limit);
  const output: UsageSeriesPoint[] = [];
  for (let index = 0; index < series.length; index += size) {
    const group = series.slice(index, index + size);
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;
    const byAgent: Record<string, number> = {};
    const byAgentRequests: Record<string, number> = {};
    const byAgentCostUsd: Record<string, number> = {};
    for (const point of group) {
      for (const [agent, value] of Object.entries(point.byAgent)) byAgent[agent] = (byAgent[agent] ?? 0) + value;
      for (const [agent, value] of Object.entries(point.byAgentRequests)) byAgentRequests[agent] = (byAgentRequests[agent] ?? 0) + value;
      for (const [agent, value] of Object.entries(point.byAgentCostUsd)) byAgentCostUsd[agent] = (byAgentCostUsd[agent] ?? 0) + value;
    }
    output.push({
      key: first.key,
      label: first.label,
      full: group.length > 1 ? `${first.full} – ${last.full}` : first.full,
      totalTokens: sum(group.map((point) => point.totalTokens)),
      requests: sum(group.map((point) => point.requests)),
      input: sum(group.map((point) => point.input)),
      output: sum(group.map((point) => point.output)),
      cacheRead: sum(group.map((point) => point.cacheRead)),
      cacheWrite: sum(group.map((point) => point.cacheWrite)),
      reasoning: sum(group.map((point) => point.reasoning)),
      credits: sum(group.map((point) => point.credits)),
      costUsd: sum(group.map((point) => point.costUsd)),
      byAgent,
      byAgentRequests,
      byAgentCostUsd,
    });
  }
  return output;
}

export function forecastSeries(series: readonly UsageSeriesPoint[], days = 7): UsageSeriesPoint[] {
  if (series.length < 7) return [];
  const daily = series.filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.key)).slice(-28);
  if (daily.length < 7) return [];
  const firstDay = daily[0];
  const lastDay = daily[daily.length - 1];
  if (!firstDay || !lastDay) return [];
  const averageGap = (Date.parse(`${lastDay.key}T00:00:00.000Z`) - Date.parse(`${firstDay.key}T00:00:00.000Z`)) / Math.max(1, daily.length - 1);
  if (averageGap > 1.5 * 86_400_000) return [];
  const buckets = new Map<number, UsageSeriesPoint[]>();
  for (const point of daily) {
    const weekday = new Date(`${point.key}T00:00:00.000Z`).getUTCDay();
    const list = buckets.get(weekday) ?? [];
    list.push(point);
    buckets.set(weekday, list);
  }
  const last = daily[daily.length - 1];
  if (!last) return [];
  const output: UsageSeriesPoint[] = [];
  for (let offset = 1; offset <= days; offset += 1) {
    const date = new Date(Date.parse(`${last.key}T00:00:00.000Z`) + offset * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    const list = buckets.get(date.getUTCDay()) ?? [];
    const average = (pick: (point: UsageSeriesPoint) => number) => (list.length > 0 ? sum(list.map(pick)) / list.length : 0);
    output.push({
      key,
      label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
      full: key,
      totalTokens: average((point) => point.totalTokens),
      requests: average((point) => point.requests),
      input: average((point) => point.input),
      output: average((point) => point.output),
      cacheRead: average((point) => point.cacheRead),
      cacheWrite: average((point) => point.cacheWrite),
      reasoning: average((point) => point.reasoning),
      credits: average((point) => point.credits),
      costUsd: average((point) => point.costUsd),
      byAgent: {},
      byAgentRequests: {},
      byAgentCostUsd: {},
    });
  }
  return output;
}

export function pointCacheHit(point: UsageSeriesPoint): number | null {
  const denominator = point.input + point.cacheRead + point.cacheWrite;
  return denominator > 0 ? point.cacheRead / denominator : null;
}

export function pointAverageRequest(point: UsageSeriesPoint): number {
  return point.requests > 0 ? point.totalTokens / point.requests : 0;
}

export function pointOutputRatio(point: UsageSeriesPoint): number {
  return point.input > 0 ? point.output / point.input : 0;
}

export function pointReasoningShare(point: UsageSeriesPoint): number {
  const total = point.input + point.output + point.cacheRead + point.cacheWrite;
  return total > 0 ? point.reasoning / total : 0;
}

export function sortAgents(agents: readonly UsageAgent[], metric: "tokens" | "requests" | "cost"): UsageAgent[] {
  const value = (agent: UsageAgent) => (metric === "tokens" ? agent.totalTokens : metric === "requests" ? agent.requests : agent.reportedCostUsd);
  return [...agents].filter((agent) => value(agent) > 0).sort((a, b) => value(b) - value(a));
}

export function originStatus(locale: Locale, status: UsageOrigin["status"]): string {
  if (status === "ok") return pick(locale, "正常", "OK");
  if (status === "pulling") return pick(locale, "拉取中", "Pulling");
  if (status === "error") return pick(locale, "失败", "Error");
  return pick(locale, "未拉取", "Never");
}

export function originSync(locale: Locale, origin: UsageOrigin): string {
  if (origin.lastError) return origin.lastError;
  if (!origin.lastPullAt) return pick(locale, "本机数据", "Local data");
  return new Date(origin.lastPullAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatBucket(kind: "duration" | "tokens" | "requests" | "usd", from: number, to: number | null): string {
  const head = kind === "duration" ? formatDurationMs(from) : kind === "tokens" ? formatTokens(from) : kind === "usd" ? formatUsd(from) : formatCount(from);
  if (to === null) return `${head}+`;
  const tail = kind === "duration" ? formatDurationMs(to) : kind === "tokens" ? formatTokens(to) : kind === "usd" ? formatUsd(to) : formatCount(to);
  return `${head}–${tail}`;
}

export function topSessionLabel(session: UsageSessionItem): string {
  return session.title || session.id.slice(0, 8);
}

export function hitOf(totals: UsageTotals): number | null {
  return cacheHitRate(totals);
}

export function seriesWindowLabel(locale: Locale, series: readonly UsageSeriesPoint[]): string {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return pick(locale, "暂无数据", "No data");
  return `${first.full} – ${last.full}`;
}