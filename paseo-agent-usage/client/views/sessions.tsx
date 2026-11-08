import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { agentColor, agentShort, COST_COLOR, TOKEN_COLORS } from "../agents";
import { formatCount, formatDurationMs, formatTokens, formatUsd, shortProject } from "../format";
import { Empty, Histogram, MetricSwitch, ScatterPlot, Swimlane, TrendChart } from "../visuals";
import { formatBucket, pick, sum, topSessionLabel, type CardProps } from "./shared";

export function SessionScatterCard({ data, theme, locale }: CardProps) {
  const sessions = data.sessionStats.scatter;
  if (sessions.length === 0) return <Empty theme={theme} text={pick(locale, "当前范围没有会话。", "No sessions in this range.")} />;
  const maxRequests = Math.max(1, ...sessions.map((session) => session.requests));
  const points = sessions.map((session) => ({
    key: session.id,
    x: Math.max(0, session.durationMs),
    y: Math.max(0, session.tokens),
    size: 2 + Math.sqrt(session.requests / maxRequests) * 5,
    color: agentColor(session.agent),
    label: session.project,
  }));
  const agents = [...new Set(sessions.map((session) => session.agent))];
  return (
    <View style={{ gap: 6 }}>
      <ScatterPlot
        theme={theme}
        points={points}
        xLabel={pick(locale, "会话时长", "Session duration")}
        yLabel={pick(locale, "Token", "Tokens")}
        formatX={formatDurationMs}
        formatY={formatTokens}
        logX
        logY
        height={190}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {agents.map((agent) => (
          <View key={agent} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: agentColor(agent) }} />
            <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{agentShort(agent)}</Text>
          </View>
        ))}
      </View>
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(locale, `${sessions.length} 个采样会话；横轴和纵轴为对数刻度。`, `${sessions.length} sampled sessions; both axes are logarithmic.`)}
      </Text>
    </View>
  );
}

type DistributionMetric = "duration" | "tokens" | "cost";

export function SessionDistributionCard({ data, theme, locale }: CardProps) {
  const [metric, setMetric] = useState<DistributionMetric>("duration");
  const stats = data.sessionStats;
  const buckets = metric === "duration" ? stats.durationHistogram : metric === "tokens" ? stats.tokenHistogram : stats.costHistogram;
  const median = metric === "duration" ? stats.medianDurationMs : metric === "tokens" ? stats.medianTokens : stats.medianCostUsd;
  const p90 = metric === "duration" ? stats.p90DurationMs : metric === "tokens" ? stats.p90Tokens : stats.p90CostUsd;
  const formatter = metric === "duration" ? formatDurationMs : metric === "tokens" ? formatTokens : formatUsd;
  return (
    <View style={{ gap: 6 }}>
      <MetricSwitch
        theme={theme}
        value={metric}
        options={[
          { value: "duration", label: pick(locale, "时长", "Duration") },
          { value: "tokens", label: pick(locale, "Token", "Tokens") },
          { value: "cost", label: pick(locale, "成本", "Cost") },
        ]}
        onChange={setMetric}
      />
      <Histogram theme={theme} buckets={buckets} format={(from, to) => formatBucket(metric === "cost" ? "usd" : metric, from, to)} color={metric === "duration" ? TOKEN_COLORS.cacheWrite : metric === "tokens" ? TOKEN_COLORS.output : COST_COLOR} height={104} />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(locale, `中位 ${formatter(median)} · P90 ${formatter(p90)} · 共 ${stats.count} 个会话`, `Median ${formatter(median)} · P90 ${formatter(p90)} · ${stats.count} sessions`)}
      </Text>
    </View>
  );
}

export function TopSessionsCard({ data, theme, locale }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const sessions = data.sessionStats.top;
  if (sessions.length === 0) return <Empty theme={theme} text={pick(locale, "当前范围没有会话。", "No sessions in this range.")} />;
  const shown = expanded ? sessions : sessions.slice(0, 6);
  return (
    <View style={{ gap: 2 }}>
      {shown.map((session, index) => (
        <View key={session.id} style={{ gap: 3, paddingVertical: 6, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ width: 16, textAlign: "right", fontSize: 10, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{index + 1}</Text>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>{topSessionLabel(session)}</Text>
            <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{formatTokens(session.totalTokens)}</Text>
          </View>
          <Text numberOfLines={1} style={{ marginLeft: 22, fontSize: 9, color: theme.colors.foregroundMuted }}>
            {[shortProject(session.project), formatDurationMs(session.durationMs), `${formatCount(session.requests)} ${pick(locale, "次", "req")}`, agentShort(session.agent)].join(" · ")}
          </Text>
        </View>
      ))}
      {sessions.length > 6 ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={{ paddingTop: 5, alignItems: "center" }}>
          <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{expanded ? pick(locale, "收起", "Collapse") : pick(locale, `展开全部 ${sessions.length}`, `Show all ${sessions.length}`)}</Text>
        </Pressable>
      ) : null}
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "按会话总 Token 排序。", "Ranked by session tokens.")}</Text>
    </View>
  );
}

export function SwimlaneCard({ data, theme, locale, compact }: CardProps) {
  const sessions = data.sessionStats.scatter.slice(-80);
  if (sessions.length === 0) return <Empty theme={theme} text={pick(locale, "当前范围没有会话。", "No sessions in this range.")} />;
  return (
    <View style={{ gap: 6 }}>
      <Swimlane theme={theme} sessions={sessions} compact={compact} locale={locale} />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "最近 80 个采样会话；每个色条是一个会话，按 Agent 分行。", "Latest 80 sampled sessions; each bar is a session, grouped by agent.")}</Text>
    </View>
  );
}

export function RequestSizeCard({ data, theme, locale }: CardProps) {
  const stats = data.requestStats;
  if (stats.sampled === 0) return <Empty theme={theme} text={pick(locale, "最近调用日志没有可用样本。", "No recent call samples.")} />;
  return (
    <View style={{ gap: 6 }}>
      <Histogram theme={theme} buckets={stats.histogram} format={(from, to) => formatBucket("tokens", from, to)} color={TOKEN_COLORS.input} height={104} />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(locale, `中位 ${formatTokens(stats.medianTokens)} · P90 ${formatTokens(stats.p90Tokens)} · 共 ${formatCount(stats.sampled)} 次调用`, `Median ${formatTokens(stats.medianTokens)} · P90 ${formatTokens(stats.p90Tokens)} · ${formatCount(stats.sampled)} calls`)}
      </Text>
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "日志只保留最近约 400 条/Agent，样本不代表完整历史。", "Logs keep only the latest ~400 calls per agent; not full history.")}</Text>
    </View>
  );
}

type PaceWindow = "30" | "60";

export function RecentPaceCard({ data, theme, locale }: CardProps) {
  const [windowMinutes, setWindowMinutes] = useState<PaceWindow>("30");
  const samples = data.requestStats.scatter;
  const series = useMemo(() => {
    if (samples.length === 0) return [];
    const end = Math.max(...samples.map((sample) => sample.ts));
    const windowMs = Number(windowMinutes) * 60_000;
    const start = end - windowMs;
    const bucketMs = 60_000;
    const count = Number(windowMinutes);
    const values = Array.from({ length: count }, () => 0);
    for (const sample of samples) {
      if (sample.ts < start || sample.ts > end) continue;
      const index = Math.min(count - 1, Math.floor((sample.ts - start) / bucketMs));
      values[index] = (values[index] ?? 0) + sample.tokens;
    }
    return values.map((value, index) => ({
      label: new Date(start + index * bucketMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      value,
      detail: new Date(start + index * bucketMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }));
  }, [samples, windowMinutes]);
  if (samples.length === 0) return <Empty theme={theme} text={pick(locale, "最近没有调用日志。", "No recent call logs.")} />;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
        <MetricSwitch
          theme={theme}
          value={windowMinutes}
          options={[
            { value: "30", label: pick(locale, "30 分钟", "30 min") },
            { value: "60", label: pick(locale, "60 分钟", "60 min") },
          ]}
          onChange={setWindowMinutes}
        />
        <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, `合计 ${formatTokens(sum(series.map((point) => point.value)))}`, `Total ${formatTokens(sum(series.map((point) => point.value)))}`)}</Text>
      </View>
      <TrendChart theme={theme} points={series} color={TOKEN_COLORS.output} format={formatTokens} height={104} average={false} />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "按调用发生时间分桶，不是实时流；扫描间隔决定数据新鲜度。", "Buckets by call time, not a live stream; the scan interval sets how fresh the data is.")}</Text>
    </View>
  );
}
const PAGE_SIZE = 20;

export function SessionTableCard({ data, theme, locale }: CardProps) {
  const [page, setPage] = useState(0);
  const sessions = data.sessions;
  if (sessions.length === 0) return <Empty theme={theme} text={pick(locale, "当前范围没有会话。", "No sessions in this range.")} />;
  const totalPages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const rows = sessions.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", paddingBottom: 3 }}>
        <Text style={{ width: 74, fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "时间", "Time")}</Text>
        <Text style={{ flex: 1, fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "会话 / 项目", "Session / project")}</Text>
        <Text style={{ width: 52, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "请求", "Req")}</Text>
        <Text style={{ width: 58, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "Token", "Token")}</Text>
        <Text style={{ width: 48, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "时长", "Time")}</Text>
      </View>
      {rows.map((session, index) => (
        <View key={session.id} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
          <Text style={{ width: 74, fontSize: 9, color: theme.colors.foregroundMuted }}>{new Date(session.start).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 10, color: theme.colors.foreground }}>{topSessionLabel(session)}</Text>
            <Text numberOfLines={1} style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{shortProject(session.project)} · {agentShort(session.agent)}</Text>
          </View>
          <Text style={{ width: 52, textAlign: "right", fontSize: 10, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{formatCount(session.requests)}</Text>
          <Text style={{ width: 58, textAlign: "right", fontSize: 10, color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{formatTokens(session.totalTokens)}</Text>
          <Text style={{ width: 48, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{formatDurationMs(session.durationMs)}</Text>
        </View>
      ))}
      <Pager theme={theme} locale={locale} page={current} totalPages={totalPages} onChange={setPage} />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {data.scope === "agent" ? pick(locale, `共 ${data.sessionCount} 个会话，显示最近 ${sessions.length} 个。`, `${data.sessionCount} sessions, latest ${sessions.length} shown.`) : pick(locale, "聚合视图只显示 Top 12；切到单个 Agent 可看完整会话列表。", "Aggregate shows top 12 only; open one agent for the full list.")}
      </Text>
    </View>
  );
}

export function RequestLogCard({ data, theme, locale }: CardProps) {
  const [page, setPage] = useState(0);
  if (data.scope === "aggregate") {
    const rows = data.requestStats.scatter.slice(-8).reverse();
    return (
      <View style={{ gap: 4 }}>
        {rows.length === 0 ? <Empty theme={theme} text={pick(locale, "最近没有请求日志。", "No recent request log.")} /> : null}
        {rows.map((row, index) => (
          <View key={`${row.ts}-${index}`} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
            <Text style={{ width: 76, fontSize: 9, color: theme.colors.foregroundMuted }}>{new Date(row.ts).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" })}</Text>
            <Text style={{ flex: 1, fontSize: 10, color: theme.colors.foreground }}>{agentShort(row.agent)}</Text>
            <Text style={{ fontSize: 10, color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{formatTokens(row.tokens)}</Text>
          </View>
        ))}
        <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "聚合视图只显示最近采样；切到单个 Agent 可看模型、项目与会话。", "Aggregate shows recent samples; open one agent for model, project and session.")}</Text>
      </View>
    );
  }
  const requests = data.requests;
  if (requests.length === 0) return <Empty theme={theme} text={pick(locale, "当前范围没有请求记录；日志只保留最近约 400 条调用。", "No requests in this range; only the latest ~400 calls are kept.")} />;
  const totalPages = Math.max(1, Math.ceil(requests.length / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const rows = requests.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  return (
    <View style={{ gap: 4 }}>
      {rows.map((record, index) => {
        const tokens = record.input + record.output + record.cacheRead + record.cacheWrite;
        return (
          <View key={`${record.ts}-${index}`} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
            <Text style={{ width: 82, fontSize: 9, color: theme.colors.foregroundMuted }}>{new Date(record.ts).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</Text>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 10, color: theme.colors.foreground }}>{record.model}</Text>
            <Text numberOfLines={1} style={{ width: 92, fontSize: 9, color: theme.colors.foregroundMuted }}>{shortProject(record.project)}{record.origin !== "local" ? ` · ${record.origin}` : ""}</Text>
            <Text style={{ width: 58, textAlign: "right", fontSize: 10, color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{formatTokens(tokens)}</Text>
          </View>
        );
      })}
      <Pager theme={theme} locale={locale} page={current} totalPages={totalPages} onChange={setPage} />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "日志只保留最近约 400 条调用，更早的会滚动淘汰。", "Only the latest ~400 calls are kept; older ones roll off.")}</Text>
    </View>
  );
}

function Pager({ theme, locale, page, totalPages, onChange }: { theme: CardProps["theme"]; locale: CardProps["locale"]; page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 6 }}>
      <Text accessibilityRole="button" accessibilityLabel={pick(locale, "上一页", "Previous page")} onPress={page > 0 ? () => onChange(page - 1) : undefined} style={{ fontSize: 10, color: page > 0 ? theme.colors.foreground : theme.colors.foregroundMuted }}>{pick(locale, "← 上一页", "← Prev")}</Text>
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{`${page + 1} / ${totalPages}`}</Text>
      <Text accessibilityRole="button" accessibilityLabel={pick(locale, "下一页", "Next page")} onPress={page < totalPages - 1 ? () => onChange(page + 1) : undefined} style={{ fontSize: 10, color: page < totalPages - 1 ? theme.colors.foreground : theme.colors.foregroundMuted }}>{pick(locale, "下一页 →", "Next →")}</Text>
    </View>
  );
}
