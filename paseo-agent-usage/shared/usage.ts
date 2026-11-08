import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const usageRangeSchema = z.enum(["24h", "today", "7d", "30d", "12w", "12m", "custom"]);
export type UsageRangeKey = z.infer<typeof usageRangeSchema>;

export const usageGranularitySchema = z.enum(["hour", "day", "week", "month"]);
export type UsageGranularity = z.infer<typeof usageGranularitySchema>;

export const totalsSchema = z.object({
  requests: z.number(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  reportedCostUsd: z.number(),
  credits: z.number(),
});

export const seriesPointSchema = z.object({
  key: z.string(),
  label: z.string(),
  full: z.string(),
  totalTokens: z.number(),
  requests: z.number(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  credits: z.number(),
  costUsd: z.number(),
  byAgent: z.record(z.string(), z.number()),
  byAgentRequests: z.record(z.string(), z.number()),
  byAgentCostUsd: z.record(z.string(), z.number()),
});

export const modelItemSchema = z.object({
  agent: z.string(),
  model: z.string(),
  requests: z.number(),
  totalTokens: z.number(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  credits: z.number(),
  reportedCostUsd: z.number(),
});

export const projectItemSchema = z.object({
  project: z.string(),
  requests: z.number(),
  totalTokens: z.number(),
  credits: z.number(),
});

export const callRecordSchema = z.object({
  ts: z.number(),
  model: z.string(),
  project: z.string(),
  session: z.string(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  credits: z.number(),
  costUsd: z.number(),
  origin: z.string(),
});

export const originSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["ok", "pulling", "error", "never"]),
  lastPullAt: z.number().nullable(),
  lastError: z.string().nullable(),
  requests: z.number(),
  totalTokens: z.number(),
  credits: z.number(),
});

export const agentItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  requests: z.number(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  totalTokens: z.number(),
  reportedCostUsd: z.number(),
  credits: z.number(),
});

export const sessionItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  agent: z.string(),
  project: z.string(),
  start: z.number(),
  end: z.number(),
  durationMs: z.number(),
  requests: z.number(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
  reportedCostUsd: z.number(),
  credits: z.number(),
});

export const histogramBucketSchema = z.object({
  from: z.number(),
  to: z.number().nullable(),
  count: z.number(),
});

export const sessionScatterPointSchema = z.object({
  id: z.string(),
  agent: z.string(),
  project: z.string(),
  start: z.number(),
  durationMs: z.number(),
  tokens: z.number(),
  requests: z.number(),
});

export const sessionStatsSchema = z.object({
  count: z.number(),
  withDuration: z.number(),
  totalDurationMs: z.number(),
  medianDurationMs: z.number(),
  p90DurationMs: z.number(),
  totalTokens: z.number(),
  medianTokens: z.number(),
  p90Tokens: z.number(),
  totalCostUsd: z.number(),
  medianCostUsd: z.number(),
  p90CostUsd: z.number(),
  durationHistogram: z.array(histogramBucketSchema),
  tokenHistogram: z.array(histogramBucketSchema),
  costHistogram: z.array(histogramBucketSchema),
  startHours: z.array(z.number()).length(24),
  scatter: z.array(sessionScatterPointSchema),
  top: z.array(sessionItemSchema),
});

export const requestStatsSchema = z.object({
  sampled: z.number(),
  medianTokens: z.number(),
  p90Tokens: z.number(),
  histogram: z.array(histogramBucketSchema),
  scatter: z.array(
    z.object({
      ts: z.number(),
      tokens: z.number(),
      agent: z.string(),
    }),
  ),
});

export const calendarStatsSchema = z.object({
  start: z.string(),
  tokens: z.array(z.number()),
  requests: z.array(z.number()),
  sessions: z.array(z.number()),
});

export const timeMatrixSchema = z.object({
  tokens: z.array(z.number()),
  requests: z.array(z.number()),
});

export const monthToDateSchema = z.object({
  costUsd: z.number(),
  tokens: z.number(),
  requests: z.number(),
});

export const pairMatrixSchema = z.object({
  rows: z.array(z.string()),
  cols: z.array(z.string()),
  tokens: z.array(z.array(z.number())),
});

export const pairMatricesSchema = z.object({
  agentModels: pairMatrixSchema,
  projectAgents: pairMatrixSchema,
  agentHours: pairMatrixSchema,
});

export const DASHBOARD_MAX_PAGES = 24;
export const DASHBOARD_MAX_CARDS = 60;

export const dashboardSpanSchema = z.enum(["full", "half"]);
export type DashboardSpan = z.infer<typeof dashboardSpanSchema>;

export const dashboardCardSchema = z.object({
  iid: z.string().min(1).max(64),
  card: z.string().min(1).max(64),
  span: dashboardSpanSchema.default("half"),
  hidden: z.boolean().optional(),
});

export const dashboardPageSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(40).optional(),
  builtin: z.boolean(),
  hidden: z.boolean().optional(),
  customized: z.boolean().optional(),
  cards: z.array(dashboardCardSchema).max(DASHBOARD_MAX_CARDS),
});

export const dashboardConfigSchema = z.object({
  version: z.literal(1),
  pages: z.array(dashboardPageSchema).max(DASHBOARD_MAX_PAGES),
});

export type DashboardCard = z.infer<typeof dashboardCardSchema>;
export type DashboardPage = z.infer<typeof dashboardPageSchema>;
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;

export const usageReportOutput = z.object({
  generatedAt: z.number(),
  scanning: z.boolean(),
  scanDone: z.number(),
  scanTotal: z.number(),
  scanError: z.string().nullable(),
  firstDay: z.string().nullable(),
  totals: totalsSchema,
  previousTotals: totalsSchema,
  previousAgents: z.array(agentItemSchema),
  agents: z.array(agentItemSchema),
  series: z.array(seriesPointSchema),
  models: z.array(modelItemSchema),
  projects: z.array(projectItemSchema),
  origins: z.array(originSchema),
  sessionStats: sessionStatsSchema,
  requestStats: requestStatsSchema,
  calendar: calendarStatsSchema,
  monthToDate: monthToDateSchema,
  hourOfWeek: timeMatrixSchema,
  hourOfDay: timeMatrixSchema,
  weekday: timeMatrixSchema,
  pairs: pairMatricesSchema,
});

export const usageReportRpc = defineRpc({
  name: "usage.report",
  input: z.object({
    range: usageRangeSchema,
    granularity: usageGranularitySchema.optional(),
    origin: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  output: usageReportOutput,
});

export const usageRefreshRpc = defineRpc({
  name: "usage.refresh",
  input: z.object({}),
  output: z.object({ started: z.boolean() }),
});

export const agentReportOutput = z.object({
  agent: z.string(),
  label: z.string(),
  firstDay: z.string().nullable(),
  totals: totalsSchema,
  previousTotals: totalsSchema,
  series: z.array(seriesPointSchema),
  models: z.array(modelItemSchema),
  projects: z.array(projectItemSchema),
  requests: z.array(callRecordSchema),
  sessionCount: z.number(),
  sessions: z.array(sessionItemSchema),
  sessionStats: sessionStatsSchema,
  requestStats: requestStatsSchema,
  calendar: calendarStatsSchema,
  monthToDate: monthToDateSchema,
  hourOfWeek: timeMatrixSchema,
  hourOfDay: timeMatrixSchema,
  weekday: timeMatrixSchema,
});

export const usageAgentRpc = defineRpc({
  name: "usage.agent",
  input: z.object({
    agent: z.string(),
    range: usageRangeSchema,
    granularity: usageGranularitySchema.optional(),
    origin: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  output: agentReportOutput,
});

export const hostFormSchema = z.object({
  name: z.string(),
  originalName: z.string().nullable().optional(),
  target: z.string(),
  enabled: z.boolean(),
  port: z.number().nullable(),
  identityFile: z.string(),
  passwordCommand: z.string(),
  nodePath: z.string(),
  cacheDir: z.string(),
  timeoutMs: z.number().nullable(),
  password: z.string().optional(),
});

const hostListItemSchema = hostFormSchema.omit({ password: true }).extend({ hasPassword: z.boolean() });

export const usageHostsListRpc = defineRpc({
  name: "usage.hosts.list",
  input: z.object({}),
  output: z.object({ hosts: z.array(hostListItemSchema) }),
});

export const usageHostsSetRpc = defineRpc({
  name: "usage.hosts.set",
  input: z.object({ hosts: z.array(hostFormSchema) }),
  output: z.object({ saved: z.boolean(), error: z.string().nullable() }),
});

export const usageHostsTestRpc = defineRpc({
  name: "usage.hosts.test",
  input: z.object({ host: hostFormSchema }),
  output: z.object({ ok: z.boolean(), detail: z.string() }),
});

export type UsageHostForm = z.infer<typeof hostFormSchema>;
export type UsageHostListItem = z.infer<typeof hostListItemSchema>;

export const agentToggleSchema = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean(),
});

export const usageAgentsGetRpc = defineRpc({
  name: "usage.agents.get",
  input: z.object({}),
  output: z.object({ agents: z.array(agentToggleSchema) }),
});

export const agentSetItemSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
});

export const usageAgentsSetRpc = defineRpc({
  name: "usage.agents.set",
  input: z.object({ agents: z.array(agentSetItemSchema) }),
  output: z.object({ saved: z.boolean(), error: z.string().nullable() }),
});

export const usageLanguageSchema = z.enum(["auto", "zh", "en"]);

export const usagePrefsSchema = z.object({
  language: usageLanguageSchema,
  refreshMinutes: z.number().int().min(0).max(1440),
  /** Whether the user permanently dismissed the dashboard's co-creation banner. */
  coCreateDismissed: z.boolean().default(false),
  localAlias: z.string().trim().max(40).optional(),
  defaultRange: usageRangeSchema.optional(),
  defaultGranularity: usageGranularitySchema.optional(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000_000).optional(),
  dashboard: dashboardConfigSchema.optional(),
});

export const usagePrefsGetRpc = defineRpc({
  name: "usage.prefs.get",
  input: z.object({ locale: z.enum(["zh", "en"]).optional() }),
  output: usagePrefsSchema,
});

export const usagePrefsSetRpc = defineRpc({
  name: "usage.prefs.set",
  input: usagePrefsSchema,
  output: z.object({ saved: z.boolean(), error: z.string().nullable() }),
});

export const usageUpdateCheckRpc = defineRpc({
  name: "usage.update.check",
  input: z.object({}),
  output: z.object({
    currentVersion: z.string(),
    latestVersion: z.string(),
    latestCommit: z.string(),
    updateAvailable: z.boolean(),
    checkedAt: z.string(),
  }),
});

export type UsagePrefs = z.infer<typeof usagePrefsSchema>;
export type UsageLanguage = z.infer<typeof usageLanguageSchema>;

export type UsageAgentToggle = z.infer<typeof agentToggleSchema>;
export type UsageAgentSetItem = z.infer<typeof agentSetItemSchema>;

export type UsageReport = z.infer<typeof usageReportOutput>;
export type UsageAgent = z.infer<typeof agentItemSchema>;
export type UsageSeriesPoint = z.infer<typeof seriesPointSchema>;
export type UsageAgentReport = z.infer<typeof agentReportOutput>;
export type UsageCallRecord = z.infer<typeof callRecordSchema>;
export type UsageSessionItem = z.infer<typeof sessionItemSchema>;
export type UsageSessionStats = z.infer<typeof sessionStatsSchema>;
export type UsageRequestStats = z.infer<typeof requestStatsSchema>;
export type UsageCalendarStats = z.infer<typeof calendarStatsSchema>;
export type UsageTimeMatrix = z.infer<typeof timeMatrixSchema>;
export type UsageMonthToDate = z.infer<typeof monthToDateSchema>;
export type UsagePairMatrices = z.infer<typeof pairMatricesSchema>;
export type UsageHistogramBucket = z.infer<typeof histogramBucketSchema>;
export type UsageSessionScatterPoint = z.infer<typeof sessionScatterPointSchema>;
export type UsageOrigin = z.infer<typeof originSchema>;
export type UsageModelItem = z.infer<typeof modelItemSchema>;
export type UsageProjectItem = z.infer<typeof projectItemSchema>;
export type UsageTotals = z.infer<typeof totalsSchema>;
