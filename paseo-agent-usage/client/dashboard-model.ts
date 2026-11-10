import { DASHBOARD_MAX_CARDS, DASHBOARD_MAX_PAGES } from "../shared/usage";
import type { DashboardCard, DashboardConfig, DashboardPage, DashboardSpan } from "../shared/usage";

export type Locale = "zh" | "en";
export type PageId = "overview" | "composition" | "efficiency" | "rhythm" | "sessions" | "compare";
export type DashboardScope = "aggregate" | "agent";

export type CardId =
  | "pulse"
  | "trend"
  | "periodCompare"
  | "anomaly"
  | "agentShare"
  | "hostCompare"
  | "tokenComposition"
  | "modelRank"
  | "projectRank"
  | "agentModel"
  | "projectAgent"
  | "treemap"
  | "cacheHit"
  | "cacheFlow"
  | "avgRequest"
  | "ioStructure"
  | "efficiencyQuadrant"
  | "cost"
  | "cumulative"
  | "calendar"
  | "punchcard"
  | "hourly"
  | "weekday"
  | "activity"
  | "timeAgent"
  | "sessionScatter"
  | "sessionDistribution"
  | "topSessions"
  | "swimlane"
  | "requestSize"
  | "recentPace"
  | "sessionTable"
  | "requestLog"
  | "agentRadar"
  | "budget"
  | "coverage";

type Copy = { zh: string; en: string };

const text = (copy: Copy, locale: Locale): string => copy[locale];

export const PAGE_ORDER: PageId[] = ["overview", "composition", "efficiency", "rhythm", "sessions", "compare"];

const PAGE_COPY: Record<PageId, { title: Copy; hint: Copy }> = {
  overview: { title: { zh: "总览", en: "Overview" }, hint: { zh: "先看总量与变化，再看去向。", en: "Totals and change first, then where they go." } },
  composition: { title: { zh: "构成", en: "Composition" }, hint: { zh: "Token 花在哪些 Agent、模型和项目上。", en: "Tokens by agent, model and project." } },
  efficiency: { title: { zh: "效率", en: "Efficiency" }, hint: { zh: "缓存、请求均量与成本效率。", en: "Cache, per-request size and cost efficiency." } },
  rhythm: { title: { zh: "节奏", en: "Rhythm" }, hint: { zh: "你在什么时候使用 Agent。", en: "When you use agents." } },
  sessions: { title: { zh: "会话", en: "Sessions" }, hint: { zh: "会话的时长、体量与分布。", en: "Session length, size and distribution." } },
  compare: { title: { zh: "对比", en: "Compare" }, hint: { zh: "Agent 横评、预算与数据覆盖。", en: "Agent comparison, budget and coverage." } },
};

interface CardMeta {
  title: Copy;
  description: Copy;
  category: PageId;
  span: DashboardSpan;
  aggregateOnly?: boolean;
}

export const CARD_CATALOG: Record<CardId, CardMeta> = {
  pulse: {
    title: { zh: "用量脉搏", en: "Usage pulse" },
    description: { zh: "总量、请求、成本、缓存命中与活跃天数，带上期变化。", en: "Totals, requests, cost, cache hit and active days, with period change." },
    category: "overview",
    span: "full",
  },
  trend: {
    title: { zh: "趋势", en: "Trend" },
    description: { zh: "堆叠 Token、请求、成本与预测切换。", en: "Stacked tokens, requests, cost and forecast." },
    category: "overview",
    span: "full",
  },
  periodCompare: {
    title: { zh: "周期对比", en: "Period compare" },
    description: { zh: "当前周期与上一周期的关键指标差异。", en: "Key metrics versus the previous period." },
    category: "overview",
    span: "half",
  },
  anomaly: {
    title: { zh: "异常日", en: "Outlier days" },
    description: { zh: "偏离滚动均值的日子，标出偏高和偏低。", en: "Days away from the rolling average, high and low." },
    category: "overview",
    span: "half",
  },
  agentShare: {
    title: { zh: "Agent 份额", en: "Agent share" },
    description: { zh: "按 Token、请求或成本看各 Agent 的占比。", en: "Share by tokens, requests or cost." },
    category: "overview",
    span: "half",
    aggregateOnly: true,
  },
  hostCompare: {
    title: { zh: "主机对比", en: "Hosts" },
    description: { zh: "本机与远端主机的用量和同步状态。", en: "Local and remote hosts, usage and sync state." },
    category: "overview",
    span: "half",
    aggregateOnly: true,
  },
  tokenComposition: {
    title: { zh: "Token 构成", en: "Token mix" },
    description: { zh: "缓存读、缓存写、新输入与输出的环形构成。", en: "Cache read, cache write, fresh input and output." },
    category: "composition",
    span: "half",
  },
  modelRank: {
    title: { zh: "模型", en: "Models" },
    description: { zh: "模型排行、占比与集中度。", en: "Model ranking, share and concentration." },
    category: "composition",
    span: "half",
  },
  projectRank: {
    title: { zh: "项目", en: "Projects" },
    description: { zh: "项目排行、占比与集中度。", en: "Project ranking, share and concentration." },
    category: "composition",
    span: "half",
  },
  agentModel: {
    title: { zh: "Agent × 模型", en: "Agent × model" },
    description: { zh: "哪个 Agent 在用哪些模型。", en: "Which models each agent uses." },
    category: "composition",
    span: "full",
    aggregateOnly: true,
  },
  projectAgent: {
    title: { zh: "项目 × Agent", en: "Project × agent" },
    description: { zh: "项目和 Agent 的交叉用量。", en: "Token usage across projects and agents." },
    category: "composition",
    span: "full",
    aggregateOnly: true,
  },
  treemap: {
    title: { zh: "矩形占比", en: "Share map" },
    description: { zh: "项目或模型的面积占比，内部按 Agent 切分。", en: "Area share by project or model, split by agent." },
    category: "composition",
    span: "full",
    aggregateOnly: true,
  },
  cacheHit: {
    title: { zh: "缓存命中", en: "Cache hit" },
    description: { zh: "缓存读取占输入侧 Token 的比例。", en: "Cache reads as a share of input-side tokens." },
    category: "efficiency",
    span: "half",
  },
  cacheFlow: {
    title: { zh: "缓存读写", en: "Cache flow" },
    description: { zh: "缓存读与缓存写的规模差异。", en: "Cache reads versus cache writes." },
    category: "efficiency",
    span: "half",
  },
  avgRequest: {
    title: { zh: "请求均量", en: "Tokens per request" },
    description: { zh: "每次请求平均消耗的输入、输出与缓存。", en: "Average input, output and cache per request." },
    category: "efficiency",
    span: "half",
  },
  ioStructure: {
    title: { zh: "输入输出结构", en: "Input & output" },
    description: { zh: "输出/输入比与 reasoning 占比。", en: "Output/input ratio and reasoning share." },
    category: "efficiency",
    span: "half",
  },
  efficiencyQuadrant: {
    title: { zh: "效率象限", en: "Efficiency map" },
    description: { zh: "模型按请求均量和缓存命中率分布，气泡是请求量。", en: "Models by request size and cache hit, bubble is requests." },
    category: "efficiency",
    span: "full",
  },
  cost: {
    title: { zh: "成本", en: "Cost" },
    description: { zh: "有成本上报的 Agent 的成本趋势与效率。", en: "Cost trend and efficiency for agents that report cost." },
    category: "efficiency",
    span: "half",
  },
  cumulative: {
    title: { zh: "累计", en: "Cumulative" },
    description: { zh: "Token 与成本的累计曲线，按 Agent 分层。", en: "Cumulative tokens and cost, split by agent." },
    category: "efficiency",
    span: "full",
  },
  calendar: {
    title: { zh: "年历", en: "Year calendar" },
    description: { zh: "过去一年的每日用量点阵。", en: "Daily usage over the past year." },
    category: "rhythm",
    span: "full",
  },
  punchcard: {
    title: { zh: "打卡", en: "Punchcard" },
    description: { zh: "星期 × 小时的用量分布。", en: "Usage by weekday and hour." },
    category: "rhythm",
    span: "full",
  },
  hourly: {
    title: { zh: "24 小时", en: "Hour of day" },
    description: { zh: "一天 24 小时的用量与上期对比。", en: "Usage by hour of day versus the previous period." },
    category: "rhythm",
    span: "half",
  },
  weekday: {
    title: { zh: "星期", en: "Weekday" },
    description: { zh: "一周七天的用量分布。", en: "Usage across the seven weekdays." },
    category: "rhythm",
    span: "half",
  },
  activity: {
    title: { zh: "活跃度", en: "Activity" },
    description: { zh: "活跃天数、连续使用与使用频率。", en: "Active days, streaks and frequency." },
    category: "rhythm",
    span: "full",
  },
  timeAgent: {
    title: { zh: "时段 × Agent", en: "Hour × agent" },
    description: { zh: "不同时段主要在用哪个 Agent。", en: "Which agent dominates each hour." },
    category: "rhythm",
    span: "full",
    aggregateOnly: true,
  },
  sessionScatter: {
    title: { zh: "会话散点", en: "Session scatter" },
    description: { zh: "会话时长与 Token 体量的分布。", en: "Session duration versus token size." },
    category: "sessions",
    span: "full",
  },
  sessionDistribution: {
    title: { zh: "会话分布", en: "Session distribution" },
    description: { zh: "会话时长与 Token 的分桶和中位数。", en: "Session duration and token buckets with medians." },
    category: "sessions",
    span: "half",
  },
  topSessions: {
    title: { zh: "Top 会话", en: "Top sessions" },
    description: { zh: "按 Token 排序的最大会话。", en: "Largest sessions by tokens." },
    category: "sessions",
    span: "half",
  },
  swimlane: {
    title: { zh: "会话泳道", en: "Session swimlane" },
    description: { zh: "会话在时间轴上的起止与重叠。", en: "Session start, end and overlap on a timeline." },
    category: "sessions",
    span: "full",
  },
  requestSize: {
    title: { zh: "请求大小", en: "Request size" },
    description: { zh: "最近调用日志的单次请求 Token 分布。", en: "Per-call token distribution from recent logs." },
    category: "sessions",
    span: "half",
  },
  recentPace: {
    title: { zh: "近期速率", en: "Recent pace" },
    description: { zh: "最近调用的 Token 速率，基于扫描时间戳。", en: "Token pace from recent calls, based on scan timestamps." },
    category: "sessions",
    span: "half",
  },
  sessionTable: {
    title: { zh: "会话明细", en: "Session list" },
    description: { zh: "按会话列出时间、项目、请求、Token 与时长，分页查看。", en: "Sessions with time, project, requests, tokens and duration, with paging." },
    category: "sessions",
    span: "full",
  },
  requestLog: {
    title: { zh: "请求日志", en: "Request log" },
    description: { zh: "最近的单次请求记录，保留约 400 条/Agent。", en: "Recent per-call records, keeping about 400 per agent." },
    category: "sessions",
    span: "full",
  },
  agentRadar: {
    title: { zh: "Agent 雷达", en: "Agent radar" },
    description: { zh: "六个维度横向比较 Agent。", en: "Six-axis comparison across agents." },
    category: "compare",
    span: "full",
    aggregateOnly: true,
  },
  budget: {
    title: { zh: "预算", en: "Budget" },
    description: { zh: "月度成本燃烧率与月末预测。", en: "Monthly cost burn and month-end projection." },
    category: "compare",
    span: "half",
    aggregateOnly: true,
  },
  coverage: {
    title: { zh: "覆盖与同步", en: "Coverage & sync" },
    description: { zh: "数据覆盖范围、远端同步状态与错误。", en: "Data coverage, host sync state and errors." },
    category: "compare",
    span: "half",
    aggregateOnly: true,
  },
};

const CARD_IDS = new Set<string>(Object.keys(CARD_CATALOG));

export function isCardId(id: string): id is CardId {
  return CARD_IDS.has(id);
}

export function cardTitle(id: CardId, locale: Locale): string {
  return text(CARD_CATALOG[id].title, locale);
}

export function cardDescription(id: CardId, locale: Locale): string {
  return text(CARD_CATALOG[id].description, locale);
}

export function pageTitle(page: DashboardPage, locale: Locale): string {
  if (page.name) return page.name;
  const copy = PAGE_COPY[page.id as PageId];
  if (copy) return text(copy.title, locale);
  return locale === "zh" ? "我的看板" : "My dashboard";
}

export function pageHint(page: DashboardPage, locale: Locale): string {
  const copy = PAGE_COPY[page.id as PageId];
  return copy ? text(copy.hint, locale) : "";
}

export function pageCopy(id: PageId): { title: Copy; hint: Copy } {
  return PAGE_COPY[id];
}

function newIid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function card(iid: string, id: CardId, span?: DashboardSpan, hidden?: boolean): DashboardCard {
  return { iid, card: id, span: span ?? CARD_CATALOG[id].span, ...(hidden ? { hidden: true } : {}) };
}

export const DEFAULT_PAGES: DashboardPage[] = [
  {
    id: "overview",
    builtin: true,
    customized: false,
    cards: [
      card("overview:pulse", "pulse", "full"),
      card("overview:trend", "trend", "full"),
      card("overview:period", "periodCompare", "half"),
      card("overview:anomaly", "anomaly", "half"),
      card("overview:agents", "agentShare", "half"),
      card("overview:hosts", "hostCompare", "half"),
    ],
  },
  {
    id: "composition",
    builtin: true,
    customized: false,
    cards: [
      card("composition:token", "tokenComposition", "half"),
      card("composition:model", "modelRank", "half"),
      card("composition:project", "projectRank", "half"),
      card("composition:agent-model", "agentModel", "full"),
      card("composition:project-agent", "projectAgent", "full"),
      card("composition:treemap", "treemap", "full"),
    ],
  },
  {
    id: "efficiency",
    builtin: true,
    customized: false,
    cards: [
      card("efficiency:cache-hit", "cacheHit", "half"),
      card("efficiency:cache-flow", "cacheFlow", "half"),
      card("efficiency:avg-request", "avgRequest", "half"),
      card("efficiency:io", "ioStructure", "half"),
      card("efficiency:quadrant", "efficiencyQuadrant", "full"),
      card("efficiency:cost", "cost", "half"),
      card("efficiency:cumulative", "cumulative", "full"),
    ],
  },
  {
    id: "rhythm",
    builtin: true,
    customized: false,
    cards: [
      card("rhythm:calendar", "calendar", "full"),
      card("rhythm:punchcard", "punchcard", "full"),
      card("rhythm:hourly", "hourly", "half"),
      card("rhythm:weekday", "weekday", "half"),
      card("rhythm:activity", "activity", "full"),
      card("rhythm:time-agent", "timeAgent", "full"),
    ],
  },
  {
    id: "sessions",
    builtin: true,
    customized: false,
    cards: [
      card("sessions:scatter", "sessionScatter", "full"),
      card("sessions:distribution", "sessionDistribution", "half"),
      card("sessions:top", "topSessions", "half"),
      card("sessions:swimlane", "swimlane", "full"),
      card("sessions:request-size", "requestSize", "half"),
      card("sessions:pace", "recentPace", "half"),
      card("sessions:table", "sessionTable", "full"),
      card("sessions:log", "requestLog", "full"),
    ],
  },
  {
    id: "compare",
    builtin: true,
    customized: false,
    cards: [
      card("compare:radar", "agentRadar", "full"),
      card("compare:period", "periodCompare", "half"),
      card("compare:cost", "cost", "half"),
      card("compare:budget", "budget", "half"),
      card("compare:coverage", "coverage", "half"),
    ],
  },
];

const DEFAULT_BY_ID = new Map(DEFAULT_PAGES.map((page) => [page.id, page]));

function cloneCard(instance: DashboardCard): DashboardCard {
  return { ...instance, ...(instance.hidden ? { hidden: true } : {}) };
}

function clonePage(page: DashboardPage): DashboardPage {
  return { ...page, cards: page.cards.map(cloneCard), ...(page.hidden ? { hidden: true } : {}) };
}

function sanitizeCards(input: unknown): DashboardCard[] {
  if (!Array.isArray(input)) return [];
  const cards: DashboardCard[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < input.length && cards.length < DASHBOARD_MAX_CARDS; index += 1) {
    const raw = input[index];
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const id = typeof record.card === "string" && isCardId(record.card) ? record.card : null;
    if (!id) continue;
    const rawIid = typeof record.iid === "string" ? record.iid.trim().slice(0, 64) : "";
    const iid = rawIid || `${id}-${index}-${newIid()}`;
    if (seen.has(iid)) continue;
    seen.add(iid);
    cards.push({ iid, card: id, span: record.span === "full" ? "full" : "half", ...(record.hidden === true ? { hidden: true } : {}) });
  }
  return cards;
}

export function defaultDashboard(): DashboardConfig {
  return { version: 1, pages: DEFAULT_PAGES.map(clonePage) };
}

export function sanitizeDashboard(raw: DashboardConfig | undefined | null): DashboardConfig {
  if (!raw || !Array.isArray(raw.pages)) return defaultDashboard();
  const pages: DashboardPage[] = [];
  const seen = new Set<string>();
  for (const item of raw.pages) {
    if (!item || typeof item.id !== "string" || !item.id || seen.has(item.id)) continue;
    const fallback = DEFAULT_BY_ID.get(item.id);
    const builtin = Boolean(fallback);
    if (!builtin && item.builtin) continue;
    const customized = builtin ? item.customized === true : true;
    const sourceCards = builtin && !customized ? (fallback as DashboardPage).cards : item.cards;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 40) : "";
    pages.push({
      id: item.id,
      ...(name ? { name } : {}),
      builtin,
      ...(item.hidden ? { hidden: true } : {}),
      ...(builtin ? { customized } : {}),
      cards: sanitizeCards(sourceCards),
    });
    seen.add(item.id);
    if (pages.length >= DASHBOARD_MAX_PAGES) break;
  }
  for (const builtin of DEFAULT_PAGES) {
    if (seen.has(builtin.id)) continue;
    pages.push(clonePage(builtin));
    if (pages.length >= DASHBOARD_MAX_PAGES) break;
  }
  return { version: 1, pages };
}

export function visiblePages(config: DashboardConfig): DashboardPage[] {
  return config.pages.filter((page) => !page.hidden);
}

export function visiblePageCards(page: DashboardPage, scope: DashboardScope): DashboardCard[] {
  return page.cards.filter((instance) => {
    if (instance.hidden) return false;
    if (scope === "agent" && CARD_CATALOG[instance.card as CardId]?.aggregateOnly) return false;
    return true;
  });
}

export function splitRows(cards: readonly DashboardCard[], compact: boolean): DashboardCard[][] {
  if (compact) return cards.map((instance) => [instance]);
  const rows: DashboardCard[][] = [];
  for (let index = 0; index < cards.length; index += 1) {
    const instance = cards[index];
    if (!instance) continue;
    if (instance.span === "full") {
      rows.push([instance]);
      continue;
    }
    const next = cards[index + 1];
    if (next && next.span === "half") {
      rows.push([instance, next]);
      index += 1;
    } else {
      rows.push([instance]);
    }
  }
  return rows;
}

function updatePage(config: DashboardConfig, pageId: string, update: (page: DashboardPage) => DashboardPage): DashboardConfig {
  return { ...config, pages: config.pages.map((page) => (page.id === pageId ? update(page) : page)) };
}

function markEdited(page: DashboardPage): DashboardPage {
  return page.builtin ? { ...page, customized: true } : page;
}

export function addCard(config: DashboardConfig, pageId: string, id: CardId): DashboardConfig {
  return updatePage(config, pageId, (page) => {
    if (page.cards.length >= DASHBOARD_MAX_CARDS) return page;
    return markEdited({ ...page, cards: [...page.cards, { iid: newIid(), card: id, span: CARD_CATALOG[id].span }] });
  });
}

export function removeCard(config: DashboardConfig, pageId: string, iid: string): DashboardConfig {
  return updatePage(config, pageId, (page) => markEdited({ ...page, cards: page.cards.filter((instance) => instance.iid !== iid) }));
}

export function moveCard(config: DashboardConfig, pageId: string, iid: string, delta: -1 | 1): DashboardConfig {
  return updatePage(config, pageId, (page) => {
    const index = page.cards.findIndex((instance) => instance.iid === iid);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= page.cards.length) return page;
    const cards = [...page.cards];
    const [item] = cards.splice(index, 1);
    if (!item) return page;
    cards.splice(target, 0, item);
    return markEdited({ ...page, cards });
  });
}

export function toggleCardHidden(config: DashboardConfig, pageId: string, iid: string): DashboardConfig {
  return updatePage(config, pageId, (page) =>
    markEdited({
      ...page,
      cards: page.cards.map((instance) => (instance.iid === iid ? { ...instance, hidden: !instance.hidden } : instance)),
    }),
  );
}

export function toggleCardSpan(config: DashboardConfig, pageId: string, iid: string): DashboardConfig {
  return updatePage(config, pageId, (page) =>
    markEdited({
      ...page,
      cards: page.cards.map((instance) => (instance.iid === iid ? { ...instance, span: instance.span === "full" ? "half" : "full" } : instance)),
    }),
  );
}

export function addPage(config: DashboardConfig, name: string, fromPageId?: string): DashboardConfig {
  if (config.pages.length >= DASHBOARD_MAX_PAGES) return config;
  const source = fromPageId ? config.pages.find((page) => page.id === fromPageId) : undefined;
  const copied = source
    ? source.cards.filter((instance) => !instance.hidden).map((instance) => ({ ...instance, iid: newIid(), hidden: undefined }))
    : [];
  const page: DashboardPage = {
    id: `custom-${newIid()}`,
    name: name.trim().slice(0, 40),
    builtin: false,
    cards: copied,
  };
  return { ...config, pages: [...config.pages, page] };
}

export function renamePage(config: DashboardConfig, pageId: string, name: string): DashboardConfig {
  return updatePage(config, pageId, (page) => ({ ...page, name: name.trim().slice(0, 40) }));
}

export function togglePageHidden(config: DashboardConfig, pageId: string): DashboardConfig {
  return updatePage(config, pageId, (page) => ({ ...page, hidden: !page.hidden }));
}

export function movePage(config: DashboardConfig, pageId: string, delta: -1 | 1): DashboardConfig {
  const index = config.pages.findIndex((page) => page.id === pageId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= config.pages.length) return config;
  const pages = [...config.pages];
  const [page] = pages.splice(index, 1);
  if (!page) return config;
  pages.splice(target, 0, page);
  return { ...config, pages };
}

export function deletePage(config: DashboardConfig, pageId: string): DashboardConfig {
  return { ...config, pages: config.pages.filter((page) => page.id !== pageId || page.builtin) };
}

export function resetPage(config: DashboardConfig, pageId: string): DashboardConfig {
  const fallback = DEFAULT_BY_ID.get(pageId);
  if (!fallback) return config;
  return updatePage(config, pageId, () => clonePage(fallback));
}

export function resetAll(config: DashboardConfig): DashboardConfig {
  const custom = config.pages.filter((page) => !page.builtin);
  return { version: 1, pages: [...DEFAULT_PAGES.map(clonePage), ...custom.map((page) => ({ ...page, hidden: false }))] };
}
