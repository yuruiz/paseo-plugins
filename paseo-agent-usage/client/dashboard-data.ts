import type { UsageAgent, UsageAgentReport, UsageCalendarStats, UsageCallRecord, UsageMonthToDate, UsageOrigin, UsagePairMatrices, UsageReport, UsageRequestStats, UsageSeriesPoint, UsageSessionItem, UsageSessionStats, UsageTimeMatrix, UsageTotals } from "../shared/usage";

export interface DashboardData {
  scope: "aggregate" | "agent";
  label?: string;
  generatedAt: number;
  scanning: boolean;
  scanDone: number;
  scanTotal: number;
  scanError: string | null;
  firstDay: string | null;
  totals: UsageTotals;
  previousTotals: UsageTotals;
  agents: UsageAgent[];
  previousAgents: UsageAgent[];
  series: UsageSeriesPoint[];
  models: UsageReport["models"];
  projects: UsageReport["projects"];
  origins: UsageOrigin[];
  sessionStats: UsageSessionStats;
  requestStats: UsageRequestStats;
  calendar: UsageCalendarStats;
  monthToDate: UsageMonthToDate;
  hourOfWeek: UsageTimeMatrix;
  hourOfDay: UsageTimeMatrix;
  weekday: UsageTimeMatrix;
  pairs?: UsagePairMatrices;
  sessions: UsageSessionItem[];
  requests: UsageCallRecord[];
  sessionCount: number;
}

function agentFromTotals(totals: UsageTotals, id: string, label: string): UsageAgent {
  return {
    id,
    label,
    requests: totals.requests,
    input: totals.input,
    output: totals.output,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    reasoning: totals.reasoning,
    totalTokens: totalTokens(totals),
    reportedCostUsd: totals.reportedCostUsd,
    credits: totals.credits,
  };
}

export function fromReport(report: UsageReport): DashboardData {
  return {
    scope: "aggregate",
    generatedAt: report.generatedAt,
    scanning: report.scanning,
    scanDone: report.scanDone,
    scanTotal: report.scanTotal,
    scanError: report.scanError,
    firstDay: report.firstDay,
    totals: report.totals,
    previousTotals: report.previousTotals,
    agents: report.agents,
    previousAgents: report.previousAgents,
    series: report.series,
    models: report.models,
    projects: report.projects,
    origins: report.origins,
    sessionStats: report.sessionStats,
    requestStats: report.requestStats,
    calendar: report.calendar,
    monthToDate: report.monthToDate,
    hourOfWeek: report.hourOfWeek,
    hourOfDay: report.hourOfDay,
    weekday: report.weekday,
    pairs: report.pairs,
    sessions: report.sessionStats.top,
    requests: [],
    sessionCount: report.sessionStats.count,
  };
}

export function fromAgentReport(report: UsageAgentReport): DashboardData {
  const agent = agentFromTotals(report.totals, report.agent, report.label);
  const previous = agentFromTotals(report.previousTotals, report.agent, report.label);
  return {
    scope: "agent",
    label: report.label,
    generatedAt: Date.now(),
    scanning: false,
    scanDone: 0,
    scanTotal: 0,
    scanError: null,
    firstDay: report.firstDay,
    totals: report.totals,
    previousTotals: report.previousTotals,
    agents: [agent],
    previousAgents: [previous],
    series: report.series,
    models: report.models,
    projects: report.projects,
    origins: [],
    sessionStats: report.sessionStats,
    requestStats: report.requestStats,
    calendar: report.calendar,
    monthToDate: report.monthToDate,
    hourOfWeek: report.hourOfWeek,
    hourOfDay: report.hourOfDay,
    weekday: report.weekday,
    sessions: report.sessions,
    requests: report.requests,
    sessionCount: report.sessionCount,
  };
}

export function totalTokens(totals: UsageTotals): number {
  return totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
}

export function cacheHitRate(totals: UsageTotals): number | null {
  const denominator = totals.input + totals.cacheRead + totals.cacheWrite;
  return denominator > 0 ? totals.cacheRead / denominator : null;
}

export function activeDays(calendar: UsageCalendarStats): number {
  let count = 0;
  for (let index = 0; index < calendar.tokens.length; index += 1) {
    if ((calendar.tokens[index] ?? 0) > 0 || (calendar.requests[index] ?? 0) > 0 || (calendar.sessions[index] ?? 0) > 0) count += 1;
  }
  return count;
}

export function streak(calendar: UsageCalendarStats): { current: number; longest: number } {
  const active = calendar.tokens.map((value, index) => value > 0 || (calendar.requests[index] ?? 0) > 0 || (calendar.sessions[index] ?? 0) > 0);
  let longest = 0;
  let run = 0;
  for (const value of active) {
    run = value ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  let current = 0;
  for (let index = active.length - 1; index >= 0; index -= 1) {
    if (!active[index]) break;
    current += 1;
  }
  return { current, longest };
}

export function calendarDates(calendar: UsageCalendarStats): string[] {
  const start = Date.parse(`${calendar.start}T00:00:00.000Z`);
  return calendar.tokens.map((_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}
