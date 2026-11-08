import type { UsageAgent, UsageAgentReport, UsageCalendarStats, UsageGranularity, UsageHistogramBucket, UsagePairMatrices, UsageRangeKey, UsageReport, UsageRequestStats, UsageSessionItem, UsageSessionStats, UsageTimeMatrix, UsageTotals } from "./usage";
import type { CallRecord, SessionEntry, UsageBucket, ReportState } from "./records";
import { localHourKey } from "./time";

const HARNESS_ORDER = ["claude", "codex", "opencode", "pi"];
const HARNESS_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
};
const MAX_MODELS = 60;
const MAX_PROJECTS = 60;
const MAX_AGENT_MODELS = 30;
const MAX_AGENT_PROJECTS = 30;
const MAX_AGENT_REQUESTS = 120;
const MAX_SESSIONS = 200;
const MAX_SCATTER = 240;
const MAX_REQUEST_SCATTER = 600;
const CALENDAR_DAYS = 365;
const DAY_MS = 86_400_000;
const TOP_AGENTS = 8;
const TOP_MODELS = 8;
const TOP_PROJECTS = 8;

const DURATION_EDGES = [0, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 2 * 3_600_000, 4 * 3_600_000, 8 * 3_600_000, 24 * 3_600_000];
const TOKEN_EDGES = [0, 1_000, 10_000, 100_000, 1_000_000, 10_000_000];
const REQUEST_EDGES = [0, 1_000, 5_000, 20_000, 100_000, 500_000];
const COST_EDGES = [0, 0.01, 0.1, 0.5, 1, 5, 20, 100];

export interface HostView {
  name: string;
  target: string;
  status: "ok" | "pulling" | "error" | "never";
  lastPullAt: number | null;
  lastError: string | null;
}

interface Aggregate {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
  credits: number;
}

export interface ScanInfo {
  scanning: boolean;
  done: number;
  total: number;
}

const zero = (): Aggregate => ({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, credits: 0 });
const tokenTotal = (aggregate: Aggregate): number => aggregate.input + aggregate.output + aggregate.cacheRead + aggregate.cacheWrite;

function addAggregate(target: Aggregate, bucket: UsageBucket): void {
  target.requests += bucket.r;
  target.input += bucket.i;
  target.output += bucket.o;
  target.cacheRead += bucket.cr;
  target.cacheWrite += bucket.cw;
  target.reasoning += bucket.rz;
  target.cost += bucket.cost;
  target.credits += bucket.credits;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round0 = (value: number): number => Math.round(value);

function totalsOf(aggregate: Aggregate): UsageTotals {
  return {
    requests: round0(aggregate.requests),
    input: round0(aggregate.input),
    output: round0(aggregate.output),
    cacheRead: round0(aggregate.cacheRead),
    cacheWrite: round0(aggregate.cacheWrite),
    reasoning: round0(aggregate.reasoning),
    reportedCostUsd: round2(aggregate.cost),
    credits: round2(aggregate.credits),
  };
}

function addMonthToDate(target: { costUsd: number; tokens: number; requests: number }, bucket: UsageBucket): void {
  target.costUsd += bucket.cost;
  target.tokens += bucket.i + bucket.o + bucket.cr + bucket.cw;
  target.requests += bucket.r;
}

function foldTimeMatrices(hourOfWeek: UsageTimeMatrix): { hourOfDay: UsageTimeMatrix; weekday: UsageTimeMatrix } {
  const hourOfDay = emptyTimeMatrix(24);
  const weekday = emptyTimeMatrix(7);
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const index = day * 24 + hour;
      hourOfDay.tokens[hour]! += hourOfWeek.tokens[index] ?? 0;
      hourOfDay.requests[hour]! += hourOfWeek.requests[index] ?? 0;
      weekday.tokens[day]! += hourOfWeek.tokens[index] ?? 0;
      weekday.requests[day]! += hourOfWeek.requests[index] ?? 0;
    }
  }
  return { hourOfDay, weekday };
}

interface Source {
  id: string;
  buckets: Record<string, UsageBucket>;
}

function collectSources(state: ReportState): Source[] {
  const sources: Source[] = [{ id: "local", buckets: state.buckets }];
  for (const [name, host] of Object.entries(state.hosts)) {
    sources.push({ id: name, buckets: host.buckets ?? {} });
  }
  return sources;
}

interface SessionSource {
  id: string;
  sessions: Record<string, SessionEntry>;
}

function collectSessionSources(state: ReportState): SessionSource[] {
  const sources: SessionSource[] = [{ id: "local", sessions: state.sessions }];
  for (const [name, host] of Object.entries(state.hosts)) {
    if (!host?.sessions) continue;
    sources.push({ id: name, sessions: host.sessions });
  }
  return sources;
}

interface RangePlan {
  periodKeys: string[];
  startKey: string;
  endKey: string;
  periodKeyOf(bucketKey: string): string;
  label(key: string): string;
  full(key: string): string;
}

interface RangeWindow {
  start: Date;
  end: Date;
}

function dateKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function hourKeyOf(date: Date): string {
  return `${dateKeyOf(date)}T${String(date.getHours()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function alignHour(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());
}

function startOfWeek(date: Date): Date {
  return addDays(startOfDay(date), -((date.getDay() + 6) % 7));
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function parseDateKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
}

function dateOfKey(key: string): Date | null {
  const parsed = parseDateKey(key.slice(0, 10));
  return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d) : null;
}

function shortDay(key: string): string {
  const parsed = parseDateKey(key);
  return parsed ? `${parsed.m}/${parsed.d}` : key;
}

function weekKeyOf(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const date = new Date(parsed.y, parsed.m - 1, parsed.d);
  const offset = (date.getDay() + 6) % 7;
  return dateKeyOf(addDays(date, -offset));
}

function dayIndex(start: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS);
}

const HOUR_KEY_LIMIT = 2400;
const DAY_KEY_LIMIT = 400;
const WEEK_KEY_LIMIT = 480;
const MONTH_KEY_LIMIT = 480;

function rangeWindow(range: UsageRangeKey, now: Date, custom?: { from?: string; to?: string } | null): RangeWindow {
  if (range === "custom") {
    const fromParsed = custom?.from ? parseDateKey(custom.from) : null;
    const toParsed = custom?.to ? parseDateKey(custom.to) : null;
    if (!fromParsed || !toParsed) return rangeWindow("30d", now, null);
    const a = new Date(fromParsed.y, fromParsed.m - 1, fromParsed.d);
    const b = new Date(toParsed.y, toParsed.m - 1, toParsed.d);
    const first = a <= b ? a : b;
    const last = a <= b ? b : a;
    return { start: first, end: new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999) };
  }
  if (range === "24h") return { start: alignHour(new Date(now.getTime() - 23 * 3_600_000)), end: now };
  if (range === "today") return { start: startOfDay(now), end: now };
  if (range === "7d") return { start: addDays(startOfDay(now), -6), end: now };
  if (range === "30d") return { start: addDays(startOfDay(now), -29), end: now };
  if (range === "12w") return { start: addDays(startOfWeek(now), -77), end: now };
  return { start: new Date(now.getFullYear(), now.getMonth() - 11, 1), end: now };
}

function previousWindow(range: UsageRangeKey, win: RangeWindow): RangeWindow {
  if (range === "today") {
    const end = new Date(win.start.getTime() - 1);
    return { start: startOfDay(addDays(win.start, -1)), end };
  }
  const span = Math.max(1, win.end.getTime() - win.start.getTime());
  return { start: new Date(win.start.getTime() - span - 1), end: new Date(win.start.getTime() - 1) };
}

function hourKeysIn(win: RangeWindow): string[] {
  const end = alignHour(win.end);
  let start = alignHour(win.start);
  const earliest = new Date(end.getTime() - (HOUR_KEY_LIMIT - 1) * 3_600_000);
  if (start < earliest) start = earliest;
  const keys: string[] = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 3_600_000)) {
    const key = hourKeyOf(cursor);
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return keys;
}

function dayKeysIn(win: RangeWindow): string[] {
  const keys: string[] = [];
  const last = startOfDay(win.end);
  for (let cursor = startOfDay(win.start), guard = 0; cursor <= last && guard < DAY_KEY_LIMIT; cursor = addDays(cursor, 1), guard += 1) {
    keys.push(dateKeyOf(cursor));
  }
  return keys;
}

function weekKeysIn(win: RangeWindow): string[] {
  const keys: string[] = [];
  const last = startOfWeek(win.end);
  for (let cursor = startOfWeek(win.start), guard = 0; cursor <= last && guard < WEEK_KEY_LIMIT; cursor = addDays(cursor, 7), guard += 1) {
    keys.push(dateKeyOf(cursor));
  }
  return keys;
}

function monthKeysIn(win: RangeWindow): string[] {
  const keys: string[] = [];
  const last = startOfMonth(win.end);
  for (let cursor = startOfMonth(win.start), guard = 0; cursor <= last && guard < MONTH_KEY_LIMIT; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1), guard += 1) {
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    keys.push(`${cursor.getFullYear()}-${month}`);
  }
  return keys;
}

function buildPlan(range: UsageRangeKey, granularity: UsageGranularity, now: Date, custom?: { from?: string; to?: string } | null): RangePlan {
  const win = rangeWindow(range, now, custom);
  const startKey = hourKeyOf(win.start);
  const endKey = hourKeyOf(win.end);
  if (granularity === "hour") {
    return {
      periodKeys: hourKeysIn(win),
      startKey,
      endKey,
      periodKeyOf: (key) => key.slice(0, 13),
      label: (key) => `${key.slice(11, 13)}:00`,
      full: (key) => `${key.slice(0, 10)} ${key.slice(11, 13)}:00`,
    };
  }
  if (granularity === "week") {
    return {
      periodKeys: weekKeysIn(win),
      startKey,
      endKey,
      periodKeyOf: (key) => weekKeyOf(key.slice(0, 10)),
      label: (key) => shortDay(key),
      full: (key) => {
        const monday = dateOfKey(key);
        return monday ? `${shortDay(key)}\u2013${shortDay(dateKeyOf(addDays(monday, 6)))}` : key;
      },
    };
  }
  if (granularity === "month") {
    return {
      periodKeys: monthKeysIn(win),
      startKey,
      endKey,
      periodKeyOf: (key) => key.slice(0, 7),
      label: (key) => {
        const [year, month] = key.split("-");
        return `${year}/${Number(month)}`;
      },
      full: (key) => key,
    };
  }
  return {
    periodKeys: dayKeysIn(win),
    startKey,
    endKey,
    periodKeyOf: (key) => key.slice(0, 10),
    label: (key) => shortDay(key.slice(0, 10)),
    full: (key) => key.slice(0, 10),
  };
}

function parseBucketKey(key: string): { bucketKey: string; harness: string; model: string; project: string } {
  const [bucketKey = "", harness = "", model = "", project = ""] = key.split("\u0001");
  return { bucketKey, harness, model, project };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))] ?? 0;
}

function histogram(values: readonly number[], edges: readonly number[]): UsageHistogramBucket[] {
  const buckets = edges.map((from, index) => ({ from, to: index + 1 < edges.length ? (edges[index + 1] as number) : null, count: 0 }));
  for (const value of values) {
    let index = edges.length - 1;
    for (let cursor = 0; cursor < edges.length; cursor += 1) {
      if (value >= (edges[cursor] as number) && (cursor === edges.length - 1 || value < (edges[cursor + 1] as number))) {
        index = cursor;
        break;
      }
    }
    const bucket = buckets[index];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function emptySessionStats(): UsageSessionStats {
  return {
    count: 0,
    withDuration: 0,
    totalDurationMs: 0,
    medianDurationMs: 0,
    p90DurationMs: 0,
    totalTokens: 0,
    medianTokens: 0,
    p90Tokens: 0,
    totalCostUsd: 0,
    medianCostUsd: 0,
    p90CostUsd: 0,
    durationHistogram: histogram([], DURATION_EDGES),
    tokenHistogram: histogram([], TOKEN_EDGES),
    costHistogram: histogram([], COST_EDGES),
    startHours: Array.from({ length: 24 }, () => 0),
    scatter: [],
    top: [],
  };
}

function emptyRequestStats(): UsageRequestStats {
  return {
    sampled: 0,
    medianTokens: 0,
    p90Tokens: 0,
    histogram: histogram([], REQUEST_EDGES),
    scatter: [],
  };
}

function emptyCalendar(now: Date): UsageCalendarStats {
  const end = startOfDay(now);
  const rawStart = addDays(end, -(CALENDAR_DAYS - 1));
  const startDate = addDays(rawStart, -((rawStart.getDay() + 6) % 7));
  const days = Math.round((end.getTime() - startDate.getTime()) / DAY_MS) + 1;
  return {
    start: dateKeyOf(startDate),
    tokens: Array.from({ length: days }, () => 0),
    requests: Array.from({ length: days }, () => 0),
    sessions: Array.from({ length: days }, () => 0),
  };
}

function emptyTimeMatrix(size: number): UsageTimeMatrix {
  return { tokens: Array.from({ length: size }, () => 0), requests: Array.from({ length: size }, () => 0) };
}

function emptyPairs(): UsagePairMatrices {
  return {
    agentModels: { rows: [], cols: [], tokens: [] },
    projectAgents: { rows: [], cols: [], tokens: [] },
    agentHours: { rows: [], cols: [], tokens: [] },
  };
}

function matrixFromMap(map: Map<string, Map<string, number>>, rowLimit: number, colLimit: number): { rows: string[]; cols: string[]; tokens: number[][] } {
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const [row, cols] of map) {
    for (const [col, value] of cols) {
      rowTotals.set(row, (rowTotals.get(row) ?? 0) + value);
      colTotals.set(col, (colTotals.get(col) ?? 0) + value);
    }
  }
  const rows = [...rowTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, rowLimit).map(([key]) => key);
  const cols = [...colTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, colLimit).map(([key]) => key);
  return {
    rows,
    cols,
    tokens: rows.map((row) => cols.map((col) => round0(map.get(row)?.get(col) ?? 0))),
  };
}

function buildAgentRows(map: Map<string, Aggregate>): UsageAgent[] {
  const ids = [...HARNESS_ORDER, ...[...map.keys()].filter((id) => !HARNESS_ORDER.includes(id))];
  return ids
    .map((id) => {
      const aggregate = map.get(id);
      if (!aggregate) return null;
      return {
        id,
        label: HARNESS_LABELS[id] ?? id,
        requests: round0(aggregate.requests),
        input: round0(aggregate.input),
        output: round0(aggregate.output),
        cacheRead: round0(aggregate.cacheRead),
        cacheWrite: round0(aggregate.cacheWrite),
        reasoning: round0(aggregate.reasoning),
        totalTokens: round0(tokenTotal(aggregate)),
        reportedCostUsd: round2(aggregate.cost),
        credits: round2(aggregate.credits),
      };
    })
    .filter((row): row is UsageAgent => row !== null);
}

interface CollectedSession {
  agent: string;
  item: UsageSessionItem;
}

function collectSessions(
  state: ReportState,
  options: {
    startMs: number;
    endMs: number;
    origin?: string | null;
    enabled?: ReadonlySet<string>;
    agent?: string | null;
  },
): CollectedSession[] {
  const matched: CollectedSession[] = [];
  for (const source of collectSessionSources(state)) {
    if (options.origin && source.id !== options.origin) continue;
    for (const [key, entry] of Object.entries(source.sessions)) {
      if (!entry || entry.s <= 0) continue;
      const separator = key.indexOf("\u0001");
      if (separator < 0) continue;
      const harness = key.slice(0, separator);
      const sid = key.slice(separator + 1);
      if (!sid) continue;
      if (options.enabled && !options.enabled.has(harness)) continue;
      if (options.agent && harness !== options.agent) continue;
      if (entry.s < options.startMs || entry.s > options.endMs) continue;
      const durationMs = Math.max(0, entry.e - entry.s);
      matched.push({
        agent: harness,
        item: {
          id: sid,
          title: typeof entry.title === "string" ? entry.title : "",
          agent: harness,
          project: entry.p,
          start: round0(entry.s),
          end: round0(entry.e),
          durationMs: round0(durationMs),
          requests: round0(entry.r),
          input: round0(entry.i),
          output: round0(entry.o),
          cacheRead: round0(entry.cr),
          cacheWrite: round0(entry.cw),
          totalTokens: round0(entry.i + entry.o + entry.cr + entry.cw),
          reportedCostUsd: round2(entry.cost),
          credits: round2(entry.credits),
        },
      });
    }
  }
  return matched;
}

function sessionStatsOf(sessions: readonly CollectedSession[]): UsageSessionStats {
  if (sessions.length === 0) return emptySessionStats();
  const durations = sessions.map((session) => session.item.durationMs).filter((value) => value > 0);
  const tokens = sessions.map((session) => session.item.totalTokens).filter((value) => value > 0);
  const costs = sessions.map((session) => session.item.reportedCostUsd).filter((value) => value > 0);
  const startHours = Array.from({ length: 24 }, () => 0);
  for (const session of sessions) startHours[new Date(session.item.start).getHours()]! += 1;
  const sortedByStart = [...sessions].sort((a, b) => a.item.start - b.item.start);
  const stride = Math.max(1, Math.ceil(sortedByStart.length / MAX_SCATTER));
  const scatter = sortedByStart
    .filter((_, index) => index % stride === 0)
    .slice(0, MAX_SCATTER)
    .map(({ agent, item }) => ({
      id: item.id,
      agent,
      project: item.project,
      start: item.start,
      durationMs: item.durationMs,
      tokens: item.totalTokens,
      requests: item.requests,
    }));
  const top = [...sessions]
    .sort((a, b) => b.item.totalTokens - a.item.totalTokens)
    .slice(0, 12)
    .map((session) => session.item);
  return {
    count: sessions.length,
    withDuration: durations.length,
    totalDurationMs: round0(durations.reduce((sum, value) => sum + value, 0)),
    medianDurationMs: round0(percentile(durations, 0.5)),
    p90DurationMs: round0(percentile(durations, 0.9)),
    totalTokens: round0(tokens.reduce((sum, value) => sum + value, 0)),
    medianTokens: round0(percentile(tokens, 0.5)),
    p90Tokens: round0(percentile(tokens, 0.9)),
    totalCostUsd: round2(costs.reduce((sum, value) => sum + value, 0)),
    medianCostUsd: round2(percentile(costs, 0.5)),
    p90CostUsd: round2(percentile(costs, 0.9)),
    durationHistogram: histogram(durations, DURATION_EDGES),
    tokenHistogram: histogram(tokens, TOKEN_EDGES),
    costHistogram: histogram(costs, COST_EDGES),
    startHours,
    scatter,
    top,
  };
}

function collectCallSamples(
  state: ReportState,
  options: {
    startMs: number;
    endMs: number;
    origin?: string | null;
    enabled?: ReadonlySet<string>;
    agent?: string | null;
  },
): Array<{ ts: number; tokens: number; agent: string }> {
  const samples: Array<{ ts: number; tokens: number; agent: string }> = [];
  const collect = (records: Record<string, CallRecord[]> | undefined, origin: string) => {
    if (options.origin && origin !== options.origin) return;
    for (const [harness, list] of Object.entries(records ?? {})) {
      if (options.enabled && !options.enabled.has(harness)) continue;
      if (options.agent && harness !== options.agent) continue;
      for (const record of list) {
        if (record.t < options.startMs || record.t > options.endMs) continue;
        const tokens = record.i + record.o + record.cr + record.cw;
        if (tokens <= 0) continue;
        samples.push({ ts: record.t, tokens: round0(tokens), agent: harness });
      }
    }
  };
  collect(state.recent, "local");
  for (const [name, host] of Object.entries(state.hosts)) collect(host.recent, name);
  return samples;
}

function requestStatsOf(samples: readonly { ts: number; tokens: number; agent: string }[]): UsageRequestStats {
  if (samples.length === 0) return emptyRequestStats();
  const values = samples.map((sample) => sample.tokens);
  const sorted = [...samples].sort((a, b) => b.ts - a.ts).slice(0, MAX_REQUEST_SCATTER).sort((a, b) => a.ts - b.ts);
  return {
    sampled: values.length,
    medianTokens: round0(percentile(values, 0.5)),
    p90Tokens: round0(percentile(values, 0.9)),
    histogram: histogram(values, REQUEST_EDGES),
    scatter: sorted.map((sample) => ({ ts: sample.ts, tokens: sample.tokens, agent: sample.agent })),
  };
}

function buildCalendar(
  state: ReportState,
  now: Date,
  options: { origin?: string | null; enabled?: ReadonlySet<string>; agent?: string | null },
): UsageCalendarStats {
  const calendar = emptyCalendar(now);
  const startDate = dateOfKey(calendar.start);
  if (!startDate) return calendar;
  for (const source of collectSources(state)) {
    if (options.origin && source.id !== options.origin) continue;
    for (const [key, bucket] of Object.entries(source.buckets)) {
      const { bucketKey, harness } = parseBucketKey(key);
      if (options.enabled && !options.enabled.has(harness)) continue;
      if (options.agent && harness !== options.agent) continue;
      const index = dayIndex(calendar.start, bucketKey.slice(0, 10));
      if (index < 0 || index >= calendar.tokens.length) continue;
      calendar.tokens[index]! += round0(bucket.i + bucket.o + bucket.cr + bucket.cw);
      calendar.requests[index]! += round0(bucket.r);
    }
  }
  const startMs = startDate.getTime();
  const sessions = collectSessions(state, { startMs, endMs: now.getTime(), origin: options.origin, enabled: options.enabled, agent: options.agent });
  for (const session of sessions) {
    const index = dayIndex(calendar.start, dateKeyOf(new Date(session.item.start)));
    if (index >= 0 && index < calendar.tokens.length) calendar.sessions[index]! += 1;
  }
  return calendar;
}

function pairsOf(
  state: ReportState,
  plan: RangePlan,
  options: { origin?: string | null; enabled?: ReadonlySet<string> },
): UsagePairMatrices {
  const agentModels = new Map<string, Map<string, number>>();
  const projectAgents = new Map<string, Map<string, number>>();
  const agentHours = new Map<string, Map<string, number>>();
  for (const source of collectSources(state)) {
    if (options.origin && source.id !== options.origin) continue;
    for (const [key, bucket] of Object.entries(source.buckets)) {
      const { bucketKey, harness, model, project } = parseBucketKey(key);
      if (bucketKey < plan.startKey || bucketKey > plan.endKey) continue;
      if (options.enabled && !options.enabled.has(harness)) continue;
      const tokens = bucket.i + bucket.o + bucket.cr + bucket.cw;
      if (tokens <= 0) continue;
      const modelKey = model || "unknown";
      let models = agentModels.get(harness);
      if (!models) {
        models = new Map();
        agentModels.set(harness, models);
      }
      models.set(modelKey, (models.get(modelKey) ?? 0) + tokens);
      const projectKey = project || "unknown";
      let agents = projectAgents.get(projectKey);
      if (!agents) {
        agents = new Map();
        projectAgents.set(projectKey, agents);
      }
      agents.set(harness, (agents.get(harness) ?? 0) + tokens);
      const hour = bucketKey.slice(11, 13);
      let hourMap = agentHours.get(harness);
      if (!hourMap) {
        hourMap = new Map();
        agentHours.set(harness, hourMap);
      }
      hourMap.set(hour, (hourMap.get(hour) ?? 0) + tokens);
    }
  }
  const hourRows = [...agentHours.entries()].sort((a, b) => [...b[1].values()].reduce((sum, value) => sum + value, 0) - [...a[1].values()].reduce((sum, value) => sum + value, 0)).slice(0, TOP_AGENTS).map(([agent]) => agent);
  const hourCols = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
  return {
    agentModels: matrixFromMap(agentModels, TOP_AGENTS, TOP_MODELS),
    projectAgents: matrixFromMap(projectAgents, TOP_PROJECTS, TOP_AGENTS),
    agentHours: {
      rows: hourRows,
      cols: hourCols,
      tokens: hourRows.map((agent) => hourCols.map((hour) => round0(agentHours.get(agent)?.get(hour) ?? 0))),
    },
  };
}

export function buildReport(
  state: ReportState,
  range: UsageRangeKey,
  scan: ScanInfo,
  hosts: HostView[],
  origin?: string,
  enabledHarnesses?: ReadonlySet<string>,
  custom?: { from?: string; to?: string } | null,
  granularity: UsageGranularity = "day",
): UsageReport {
  const now = new Date();
  const plan = buildPlan(range, granularity, now, custom);
  const previous = previousWindow(range, rangeWindow(range, now, custom));
  const previousStartKey = hourKeyOf(previous.start);
  const previousEndKey = hourKeyOf(previous.end);
  const allowed = new Set(plan.periodKeys);
  const originFilter = origin ?? null;
  const series = new Map<string, { tokens: number; requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; credits: number; cost: number; byAgent: Record<string, number>; byAgentRequests: Record<string, number>; byAgentCostUsd: Record<string, number> }>();
  const agents = new Map<string, Aggregate>();
  const models = new Map<string, Aggregate & { agent: string; model: string }>();
  const projects = new Map<string, Aggregate & { project: string }>();
  const origins = new Map<string, Aggregate>();
  const previousAgents = new Map<string, Aggregate>();
  const totals = zero();
  const previousTotals = zero();
  const monthToDate = { costUsd: 0, tokens: 0, requests: 0 };
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const calendar = buildCalendar(state, now, { origin: originFilter, enabled: enabledHarnesses });
  const hourOfWeek = emptyTimeMatrix(7 * 24);
  let firstDay: string | null = null;

  for (const source of collectSources(state)) {
    for (const [key, bucket] of Object.entries(source.buckets)) {
      const { bucketKey, harness, model, project } = parseBucketKey(key);
      if (enabledHarnesses && !enabledHarnesses.has(harness)) continue;
      const date = bucketKey.slice(0, 10);
      if (!firstDay || date < firstDay) firstDay = date;
      const inCurrent = bucketKey >= plan.startKey && bucketKey <= plan.endKey;
      const inPrevious = bucketKey >= previousStartKey && bucketKey <= previousEndKey;
      if (inCurrent) {
        let originAggregate = origins.get(source.id);
        if (!originAggregate) {
          originAggregate = zero();
          origins.set(source.id, originAggregate);
        }
        addAggregate(originAggregate, bucket);
      }
      if (originFilter !== null && source.id !== originFilter) continue;
      if (bucketKey.slice(0, 7) === monthKey) addMonthToDate(monthToDate, bucket);
      if (!inCurrent && !inPrevious) continue;
      if (inPrevious) {
        addAggregate(previousTotals, bucket);
        let previousAgent = previousAgents.get(harness);
        if (!previousAgent) {
          previousAgent = zero();
          previousAgents.set(harness, previousAgent);
        }
        addAggregate(previousAgent, bucket);
      }
      if (!inCurrent) continue;
      addAggregate(totals, bucket);
      let agent = agents.get(harness);
      if (!agent) {
        agent = zero();
        agents.set(harness, agent);
      }
      addAggregate(agent, bucket);
      const modelKey = `${harness}\u0001${model}`;
      let modelAggregate = models.get(modelKey);
      if (!modelAggregate) {
        modelAggregate = Object.assign(zero(), { agent: harness, model });
        models.set(modelKey, modelAggregate);
      }
      addAggregate(modelAggregate, bucket);
      let projectAggregate = projects.get(project);
      if (!projectAggregate) {
        projectAggregate = Object.assign(zero(), { project });
        projects.set(project, projectAggregate);
      }
      addAggregate(projectAggregate, bucket);
      const calendarDate = dateOfKey(bucketKey);
      if (calendarDate) {
        const weekday = (calendarDate.getDay() + 6) % 7;
        const hour = Number(bucketKey.slice(11, 13));
        if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
          const hourIndex = weekday * 24 + hour;
          hourOfWeek.tokens[hourIndex]! += round0(bucket.i + bucket.o + bucket.cr + bucket.cw);
          hourOfWeek.requests[hourIndex]! += round0(bucket.r);
        }
      }
      const periodKey = plan.periodKeyOf(bucketKey);
      if (allowed.has(periodKey)) {
        let point = series.get(periodKey);
        if (!point) {
          point = { tokens: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, credits: 0, cost: 0, byAgent: {}, byAgentRequests: {}, byAgentCostUsd: {} };
          series.set(periodKey, point);
        }
        const tokens = bucket.i + bucket.o + bucket.cr + bucket.cw;
        point.tokens += tokens;
        point.requests += bucket.r;
        point.input += bucket.i;
        point.output += bucket.o;
        point.cacheRead += bucket.cr;
        point.cacheWrite += bucket.cw;
        point.reasoning += bucket.rz;
        point.credits += bucket.credits;
        point.cost += bucket.cost;
        point.byAgent[harness] = (point.byAgent[harness] ?? 0) + tokens;
        point.byAgentRequests[harness] = (point.byAgentRequests[harness] ?? 0) + bucket.r;
        point.byAgentCostUsd[harness] = (point.byAgentCostUsd[harness] ?? 0) + bucket.cost;
      }
    }
  }

  const selectedSessions = collectSessions(state, {
    startMs: rangeWindow(range, now, custom).start.getTime(),
    endMs: rangeWindow(range, now, custom).end.getTime(),
    origin: originFilter,
    enabled: enabledHarnesses,
  });
  const sessionStats = sessionStatsOf(selectedSessions);
  const requestStats = requestStatsOf(
    collectCallSamples(state, {
      startMs: rangeWindow(range, now, custom).start.getTime(),
      endMs: rangeWindow(range, now, custom).end.getTime(),
      origin: originFilter,
      enabled: enabledHarnesses,
    }),
  );
  const { hourOfDay, weekday } = foldTimeMatrices(hourOfWeek);

  const originNumbers = (id: string): { requests: number; totalTokens: number; credits: number } => {
    const aggregate = origins.get(id);
    return {
      requests: round0(aggregate?.requests ?? 0),
      totalTokens: round0(aggregate ? tokenTotal(aggregate) : 0),
      credits: round2(aggregate?.credits ?? 0),
    };
  };

  return {
    generatedAt: Date.now(),
    scanning: scan.scanning,
    scanDone: round0(scan.done),
    scanTotal: round0(scan.total),
    scanError: state.meta.scanError,
    firstDay,
    totals: totalsOf(totals),
    previousTotals: totalsOf(previousTotals),
    previousAgents: buildAgentRows(previousAgents),
    agents: buildAgentRows(agents),
    series: plan.periodKeys.map((key) => {
      const point = series.get(key);
      const byAgent: Record<string, number> = {};
      for (const [agentId, value] of Object.entries(point?.byAgent ?? {})) byAgent[agentId] = round0(value);
      const byAgentRequests: Record<string, number> = {};
      for (const [agentId, value] of Object.entries(point?.byAgentRequests ?? {})) byAgentRequests[agentId] = round0(value);
      const byAgentCostUsd: Record<string, number> = {};
      for (const [agentId, value] of Object.entries(point?.byAgentCostUsd ?? {})) byAgentCostUsd[agentId] = round2(value);
      return {
        key,
        label: plan.label(key),
        full: plan.full(key),
        totalTokens: round0(point?.tokens ?? 0),
        requests: round0(point?.requests ?? 0),
        input: round0(point?.input ?? 0),
        output: round0(point?.output ?? 0),
        cacheRead: round0(point?.cacheRead ?? 0),
        cacheWrite: round0(point?.cacheWrite ?? 0),
        reasoning: round0(point?.reasoning ?? 0),
        credits: round2(point?.credits ?? 0),
        costUsd: round2(point?.cost ?? 0),
        byAgent,
        byAgentRequests,
        byAgentCostUsd,
      };
    }),
    models: [...models.values()]
      .sort((a, b) => tokenTotal(b) + b.credits - (tokenTotal(a) + a.credits))
      .slice(0, MAX_MODELS)
      .map((aggregate) => ({
        agent: aggregate.agent,
        model: aggregate.model || "unknown",
        requests: round0(aggregate.requests),
        totalTokens: round0(tokenTotal(aggregate)),
        input: round0(aggregate.input),
        output: round0(aggregate.output),
        cacheRead: round0(aggregate.cacheRead),
        cacheWrite: round0(aggregate.cacheWrite),
        reasoning: round0(aggregate.reasoning),
        credits: round2(aggregate.credits),
        reportedCostUsd: round2(aggregate.cost),
      })),
    projects: [...projects.values()]
      .sort((a, b) => tokenTotal(b) + b.credits - (tokenTotal(a) + a.credits))
      .slice(0, MAX_PROJECTS)
      .map((aggregate) => ({
        project: aggregate.project,
        requests: round0(aggregate.requests),
        totalTokens: round0(tokenTotal(aggregate)),
        credits: round2(aggregate.credits),
      })),
    origins: [
      { id: "local", label: "本机", status: "ok" as const, lastPullAt: null, lastError: null, ...originNumbers("local") },
      ...hosts.map((view) => ({
        id: view.name,
        label: view.name,
        status: view.status,
        lastPullAt: view.lastPullAt,
        lastError: view.lastError,
        ...originNumbers(view.name),
      })),
    ],
    sessionStats,
    requestStats,
    calendar,
    monthToDate: {
      costUsd: round2(monthToDate.costUsd),
      tokens: round0(monthToDate.tokens),
      requests: round0(monthToDate.requests),
    },
    hourOfWeek,
    hourOfDay,
    weekday,
    pairs: pairsOf(state, plan, { origin: originFilter, enabled: enabledHarnesses }),
  };
}

export function buildAgentReport(
  state: ReportState,
  agent: string,
  range: UsageRangeKey,
  origin?: string,
  enabledHarnesses?: ReadonlySet<string>,
  custom?: { from?: string; to?: string } | null,
  granularity: UsageGranularity = "day",
): UsageAgentReport {
  const now = new Date();
  const win = rangeWindow(range, now, custom);
  const plan = buildPlan(range, granularity, now, custom);
  const previous = previousWindow(range, win);
  const previousStartKey = hourKeyOf(previous.start);
  const previousEndKey = hourKeyOf(previous.end);
  const allowed = new Set(plan.periodKeys);
  const originFilter = origin ?? null;
  const totals = zero();
  const previousTotals = zero();
  const monthToDate = { costUsd: 0, tokens: 0, requests: 0 };
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let firstDay: string | null = null;
  const series = new Map<string, { tokens: number; requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; credits: number; cost: number }>();
  const models = new Map<string, Aggregate & { model: string }>();
  const projects = new Map<string, Aggregate & { project: string }>();
  const hourOfWeek = emptyTimeMatrix(7 * 24);
  const agentEnabled = !enabledHarnesses || enabledHarnesses.has(agent);

  for (const source of agentEnabled ? collectSources(state) : []) {
    if (originFilter !== null && source.id !== originFilter) continue;
    for (const [key, bucket] of Object.entries(source.buckets)) {
      const { bucketKey, harness, model, project } = parseBucketKey(key);
      if (harness !== agent) continue;
      const dateKey = bucketKey.slice(0, 10);
      if (!firstDay || dateKey < firstDay) firstDay = dateKey;
      if (bucketKey.slice(0, 7) === monthKey) addMonthToDate(monthToDate, bucket);
      const inCurrent = bucketKey >= plan.startKey && bucketKey <= plan.endKey;
      const inPrevious = bucketKey >= previousStartKey && bucketKey <= previousEndKey;
      if (!inCurrent && !inPrevious) continue;
      if (inPrevious) addAggregate(previousTotals, bucket);
      if (!inCurrent) continue;
      addAggregate(totals, bucket);
      let modelAggregate = models.get(model);
      if (!modelAggregate) {
        modelAggregate = Object.assign(zero(), { model });
        models.set(model, modelAggregate);
      }
      addAggregate(modelAggregate, bucket);
      let projectAggregate = projects.get(project);
      if (!projectAggregate) {
        projectAggregate = Object.assign(zero(), { project });
        projects.set(project, projectAggregate);
      }
      addAggregate(projectAggregate, bucket);
      const date = dateOfKey(bucketKey);
      if (date) {
        const weekday = (date.getDay() + 6) % 7;
        const hour = Number(bucketKey.slice(11, 13));
        if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
          const index = weekday * 24 + hour;
          hourOfWeek.tokens[index]! += round0(bucket.i + bucket.o + bucket.cr + bucket.cw);
          hourOfWeek.requests[index]! += round0(bucket.r);
        }
      }
      const periodKey = plan.periodKeyOf(bucketKey);
      if (allowed.has(periodKey)) {
        let point = series.get(periodKey);
        if (!point) {
          point = { tokens: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, credits: 0, cost: 0 };
          series.set(periodKey, point);
        }
        point.tokens += bucket.i + bucket.o + bucket.cr + bucket.cw;
        point.requests += bucket.r;
        point.input += bucket.i;
        point.output += bucket.o;
        point.cacheRead += bucket.cr;
        point.cacheWrite += bucket.cw;
        point.reasoning += bucket.rz;
        point.credits += bucket.credits;
        point.cost += bucket.cost;
      }
    }
  }

  const requests: UsageAgentReport["requests"] = [];
  const collectRecords = (records: Record<string, CallRecord[]> | undefined, originName: string) => {
    for (const record of records?.[agent] ?? []) {
      const hourKey = localHourKey(record.t);
      if (hourKey < plan.startKey || hourKey > plan.endKey) continue;
      requests.push({
        ts: record.t,
        model: record.m || "unknown",
        project: record.p,
        session: record.s,
        input: round0(record.i),
        output: round0(record.o),
        cacheRead: round0(record.cr),
        cacheWrite: round0(record.cw),
        reasoning: round0(record.rz),
        credits: round2(record.credits),
        costUsd: round2(record.cost),
        origin: originName,
      });
    }
  };
  if (agentEnabled && (originFilter === null || originFilter === "local")) collectRecords(state.recent, "local");
  for (const [name, host] of Object.entries(state.hosts)) {
    if (agentEnabled && (originFilter === null || originFilter === name)) collectRecords(host.recent, name);
  }
  requests.sort((a, b) => b.ts - a.ts);

  const matchedSessions = agentEnabled
    ? collectSessions(state, { startMs: win.start.getTime(), endMs: win.end.getTime(), origin: originFilter, enabled: enabledHarnesses, agent })
    : [];
  const sessionStats = sessionStatsOf(matchedSessions);
  const requestStats = requestStatsOf(
    agentEnabled
      ? collectCallSamples(state, { startMs: win.start.getTime(), endMs: win.end.getTime(), origin: originFilter, enabled: enabledHarnesses, agent })
      : [],
  );
  const calendar = buildCalendar(state, now, { origin: originFilter, enabled: enabledHarnesses, agent });
  const { hourOfDay, weekday } = foldTimeMatrices(hourOfWeek);

  return {
    agent,
    label: HARNESS_LABELS[agent] ?? agent,
    firstDay,
    totals: totalsOf(totals),
    previousTotals: totalsOf(previousTotals),
    series: plan.periodKeys.map((key) => {
      const point = series.get(key);
      const tokens = round0(point?.tokens ?? 0);
      const requestsInPeriod = round0(point?.requests ?? 0);
      const cost = round2(point?.cost ?? 0);
      return {
        key,
        label: plan.label(key),
        full: plan.full(key),
        totalTokens: tokens,
        requests: requestsInPeriod,
        input: round0(point?.input ?? 0),
        output: round0(point?.output ?? 0),
        cacheRead: round0(point?.cacheRead ?? 0),
        cacheWrite: round0(point?.cacheWrite ?? 0),
        reasoning: round0(point?.reasoning ?? 0),
        credits: round2(point?.credits ?? 0),
        costUsd: cost,
        byAgent: tokens > 0 ? { [agent]: tokens } : {},
        byAgentRequests: requestsInPeriod > 0 ? { [agent]: requestsInPeriod } : {},
        byAgentCostUsd: cost > 0 ? { [agent]: cost } : {},
      };
    }),
    models: [...models.values()]
      .sort((a, b) => tokenTotal(b) + b.credits - (tokenTotal(a) + a.credits))
      .slice(0, MAX_AGENT_MODELS)
      .map((aggregate) => ({
        agent,
        model: aggregate.model || "unknown",
        requests: round0(aggregate.requests),
        totalTokens: round0(tokenTotal(aggregate)),
        input: round0(aggregate.input),
        output: round0(aggregate.output),
        cacheRead: round0(aggregate.cacheRead),
        cacheWrite: round0(aggregate.cacheWrite),
        reasoning: round0(aggregate.reasoning),
        credits: round2(aggregate.credits),
        reportedCostUsd: round2(aggregate.cost),
      })),
    projects: [...projects.values()]
      .sort((a, b) => tokenTotal(b) + b.credits - (tokenTotal(a) + a.credits))
      .slice(0, MAX_AGENT_PROJECTS)
      .map((aggregate) => ({
        project: aggregate.project,
        requests: round0(aggregate.requests),
        totalTokens: round0(tokenTotal(aggregate)),
        credits: round2(aggregate.credits),
      })),
    requests: requests.slice(0, MAX_AGENT_REQUESTS),
    sessionCount: matchedSessions.length,
    sessions: [...matchedSessions].sort((a, b) => b.item.start - a.item.start).slice(0, MAX_SESSIONS).map((session) => session.item),
    sessionStats,
    requestStats,
    calendar,
    monthToDate: {
      costUsd: round2(monthToDate.costUsd),
      tokens: round0(monthToDate.tokens),
      requests: round0(monthToDate.requests),
    },
    hourOfWeek,
    hourOfDay,
    weekday,
  };
}