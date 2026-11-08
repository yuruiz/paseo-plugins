import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { UsageSeriesPoint } from "../../shared/usage";
import { agentColor, TOKEN_COLORS, COST_COLOR } from "../agents";
import { activeDays, totalTokens } from "../dashboard-data";
import { formatCount, formatTokens, formatUsd } from "../format";
import { Delta, Dial, Empty, LedgerStrip, MetricSwitch, RankedRows, ShareBar, StackedColumns, TrendChart, type LedgerCell } from "../visuals";
import {
  downsampleSeries,
  forecastSeries,
  hitOf,
  originLabel,
  originStatus,
  originSync,
  percentText,
  pick,
  seriesWindowLabel,
  sortAgents,
  sum,
  type CardProps,
} from "./shared";

const TOKEN_NAMES = (locale: CardProps["locale"]) =>
  locale === "zh"
    ? { cacheRead: "缓存读", cacheWrite: "缓存写", input: "新输入", output: "输出" }
    : { cacheRead: "Cache read", cacheWrite: "Cache write", input: "New input", output: "Output" };

export function PulseCard({ data, theme, compact, locale }: CardProps) {
  const totals = data.totals;
  const previous = data.previousTotals;
  const total = totalTokens(totals);
  const previousTotal = totalTokens(previous);
  const hit = hitOf(totals);
  const previousHit = hitOf(previous);
  const days = activeDays(data.calendar);
  const spark = data.series.slice(-14);
  const cells: LedgerCell[] = [
    {
      key: "tokens",
      label: pick(locale, "总 Token", "Total tokens"),
      value: formatTokens(total),
      sub: pick(locale, `缓存读 ${formatTokens(totals.cacheRead)}`, `Cache read ${formatTokens(totals.cacheRead)}`),
      delta: { current: total, previous: previousTotal },
      spark: { values: spark.map((point) => point.totalTokens), color: theme.colors.foreground },
    },
    {
      key: "requests",
      label: pick(locale, "请求", "Requests"),
      value: formatCount(totals.requests),
      sub: pick(locale, `${days} 个活跃日`, `${days} active days`),
      delta: { current: totals.requests, previous: previous.requests },
      spark: { values: spark.map((point) => point.requests), color: agentColor("codex") },
    },
    {
      key: "cache",
      label: pick(locale, "缓存命中", "Cache hit"),
      value: hit === null ? "—" : percentText(hit),
      sub: pick(locale, `输入侧 ${formatTokens(totals.input + totals.cacheRead + totals.cacheWrite)}`, `Input side ${formatTokens(totals.input + totals.cacheRead + totals.cacheWrite)}`),
      delta: hit !== null && previousHit !== null ? { current: hit * 100, previous: previousHit * 100 } : undefined,
    },
    {
      key: "cost",
      label: pick(locale, "成本", "Cost"),
      value: totals.reportedCostUsd > 0 ? formatUsd(totals.reportedCostUsd) : "—",
      sub: totals.reportedCostUsd > 0 ? pick(locale, "仅统计有上报的 Agent", "Reported agents only") : pick(locale, "当前没有成本上报", "No reported cost"),
      delta: { current: totals.reportedCostUsd, previous: previous.reportedCostUsd },
      spark: { values: spark.map((point) => point.costUsd), color: COST_COLOR },
    },
    {
      key: "days",
      label: pick(locale, "活跃天数", "Active days"),
      value: `${days}`,
      sub: data.firstDay ? pick(locale, `自 ${data.firstDay}`, `Since ${data.firstDay}`) : pick(locale, "暂无历史", "No history yet"),
    },
  ];
  return (
    <View style={{ gap: 8 }}>
      <LedgerStrip theme={theme} cells={cells} compact={compact} locale={locale} />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(
          locale,
          "成本只统计有上报的 Agent；缓存命中 = 缓存读 /（新输入 + 缓存读 + 缓存写）。",
          "Cost covers agents that report it; cache hit = cache read / (new input + cache read + cache write).",
        )}
      </Text>
    </View>
  );
}

type TrendMetric = "stack" | "fresh" | "output" | "requests" | "cost" | "forecast" | "dual";

export function TrendCard({ data, theme, compact, locale }: CardProps) {
  const [metric, setMetric] = useState<TrendMetric>("stack");
  const series = useMemo(() => downsampleSeries(data.series, compact ? 28 : 60), [data.series, compact]);
  const forecast = useMemo(() => forecastSeries(data.series), [data.series]);
  const names = TOKEN_NAMES(locale);
  const allKinds = [TOKEN_COLORS.cacheRead, TOKEN_COLORS.cacheWrite, TOKEN_COLORS.input, TOKEN_COLORS.output];
  const freshKinds = [TOKEN_COLORS.cacheWrite, TOKEN_COLORS.input, TOKEN_COLORS.output];
  const stackPoints = series.map((point) => ({
    key: point.key,
    label: point.label,
    detail: point.full,
    parts: metric === "fresh" ? [point.cacheWrite, point.input, point.output] : [point.cacheRead, point.cacheWrite, point.input, point.output],
  }));
  const stackNames = metric === "fresh" ? [names.cacheWrite, names.input, names.output] : [names.cacheRead, names.cacheWrite, names.input, names.output];
  const stackColors = metric === "fresh" ? freshKinds : allKinds;
  const options: Array<{ value: TrendMetric; label: string }> = [
    { value: "stack", label: pick(locale, "全部", "All") },
    { value: "fresh", label: pick(locale, "非缓存", "Uncached") },
    { value: "output", label: pick(locale, "输出", "Output") },
    { value: "requests", label: pick(locale, "请求", "Requests") },
    { value: "dual", label: pick(locale, "Token+请求", "Tokens + requests") },
    { value: "cost", label: pick(locale, "成本", "Cost") },
    { value: "forecast", label: pick(locale, "预测", "Forecast") },
  ];
  const footer =
    metric === "dual"
      ? pick(locale, "柱为 Token（左轴），线为请求（右轴）。", "Bars are tokens (left axis); the line is requests (right axis).")
      : metric === "output"
      ? pick(locale, "只显示输出 Token；缓存读不包含在内。", "Output tokens only; cache reads are excluded.")
      : metric === "cost"
      ? pick(locale, "成本仅统计有上报的 Agent。", "Cost only covers agents that report it.")
      : metric === "forecast"
        ? forecast.length > 0
          ? pick(locale, "预测使用最近 28 天的周内均值，仅作趋势参考。", "Forecast uses the last 28 days of weekday averages, for direction only.")
          : pick(locale, "预测只支持日粒度，且至少需要 7 天数据。", "Forecast needs daily granularity and at least 7 days.")
        : pick(locale, `区间 ${seriesWindowLabel(locale, series)}`, `Range ${seriesWindowLabel(locale, series)}`);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <MetricSwitch theme={theme} value={metric} options={options} onChange={setMetric} compact={compact} />
      </View>
      {metric === "stack" || metric === "fresh" ? (
        <StackedColumns theme={theme} points={stackPoints} colors={stackColors} names={stackNames} format={formatTokens} compact={compact} />
      ) : metric === "output" ? (
        <TrendChart
          theme={theme}
          points={series.map((point) => ({ label: point.label, value: point.output, detail: point.full }))}
          color={TOKEN_COLORS.output}
          format={formatTokens}
          average
          compact={compact}
        />
      ) : metric === "requests" ? (
        <TrendChart
          theme={theme}
          points={series.map((point) => ({ label: point.label, value: point.requests, detail: point.full }))}
          color={agentColor("codex")}
          format={formatCount}
          average={false}
          compact={compact}
        />
      ) : metric === "dual" ? (
        <TrendChart
          theme={theme}
          points={series.map((point) => ({ label: point.label, value: point.totalTokens, detail: point.full }))}
          secondary={series.map((point) => ({ label: point.label, value: point.requests, detail: point.full }))}
          secondaryFormat={formatCount}
          secondaryColor={agentColor("codex")}
          secondaryLabel={pick(locale, "请求", "req")}
          color={TOKEN_COLORS.cacheRead}
          format={formatTokens}
          average
          compact={compact}
        />
      ) : metric === "cost" ? (
        <TrendChart
          theme={theme}
          points={series.map((point) => ({ label: point.label, value: point.costUsd, detail: point.full }))}
          color={COST_COLOR}
          format={formatUsd}
          average
          compact={compact}
        />
      ) : (
        <TrendChart
          theme={theme}
          points={series.map((point) => ({ label: point.label, value: point.totalTokens, detail: point.full }))}
          color={TOKEN_COLORS.cacheRead}
          format={formatTokens}
          average
          forecast={forecast.map((point) => ({ label: point.label, value: point.totalTokens, detail: point.full }))}
          compact={compact}
        />
      )}
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{footer}</Text>
    </View>
  );
}

export function PeriodCompareCard({ data, theme, locale }: CardProps) {
  const current = data.totals;
  const previous = data.previousTotals;
  const hasCost = data.agents.some((agent) => agent.reportedCostUsd > 0);
  const hit = hitOf(current);
  const previousHit = hitOf(previous);
  const rows: Array<{ key: string; label: string; current: string; previous: string; currentValue: number; previousValue: number; invert?: boolean }> = [
    {
      key: "tokens",
      label: pick(locale, "总 Token", "Total tokens"),
      current: formatTokens(totalTokens(current)),
      previous: formatTokens(totalTokens(previous)),
      currentValue: totalTokens(current),
      previousValue: totalTokens(previous),
    },
    {
      key: "requests",
      label: pick(locale, "请求", "Requests"),
      current: formatCount(current.requests),
      previous: formatCount(previous.requests),
      currentValue: current.requests,
      previousValue: previous.requests,
    },
    {
      key: "cache",
      label: pick(locale, "缓存命中", "Cache hit"),
      current: hit === null ? "—" : percentText(hit),
      previous: previousHit === null ? "—" : percentText(previousHit),
      currentValue: (hit ?? 0) * 100,
      previousValue: (previousHit ?? 0) * 100,
    },
    {
      key: "cacheRead",
      label: pick(locale, "缓存读", "Cache read"),
      current: formatTokens(current.cacheRead),
      previous: formatTokens(previous.cacheRead),
      currentValue: current.cacheRead,
      previousValue: previous.cacheRead,
    },
    {
      key: "cacheWrite",
      label: pick(locale, "缓存写", "Cache write"),
      current: formatTokens(current.cacheWrite),
      previous: formatTokens(previous.cacheWrite),
      currentValue: current.cacheWrite,
      previousValue: previous.cacheWrite,
    },
    {
      key: "output",
      label: pick(locale, "输出", "Output"),
      current: formatTokens(current.output),
      previous: formatTokens(previous.output),
      currentValue: current.output,
      previousValue: previous.output,
    },
    {
      key: "reasoning",
      label: pick(locale, "Reasoning", "Reasoning"),
      current: formatTokens(current.reasoning),
      previous: formatTokens(previous.reasoning),
      currentValue: current.reasoning,
      previousValue: previous.reasoning,
    },
    {
      key: "cost",
      label: pick(locale, "成本", "Cost"),
      current: hasCost ? formatUsd(current.reportedCostUsd) : "—",
      previous: hasCost ? formatUsd(previous.reportedCostUsd) : "—",
      currentValue: hasCost ? current.reportedCostUsd : 0,
      previousValue: hasCost ? previous.reportedCostUsd : 0,
      invert: true,
    },
  ];
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 6, paddingBottom: 2 }}>
        <Text style={{ flex: 1, fontSize: 9, color: theme.colors.foregroundMuted }} />
        <Text style={{ width: 64, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "本期", "Now")}</Text>
        <Text style={{ width: 64, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "上期", "Prev")}</Text>
        <Text style={{ width: 52, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "变化", "Change")}</Text>
      </View>
      {rows.map((row) => (
        <View key={row.key} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <Text style={{ flex: 1, fontSize: 11, color: theme.colors.foreground }}>{row.label}</Text>
          <Text style={{ width: 64, textAlign: "right", fontSize: 11, color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{row.current}</Text>
          <Text style={{ width: 64, textAlign: "right", fontSize: 11, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{row.previous}</Text>
          <View style={{ width: 52, alignItems: "flex-end" }}>
            <Delta theme={theme} current={row.currentValue} previous={row.previousValue} invert={row.invert} locale={locale} />
          </View>
        </View>
      ))}
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "上期为等长且紧邻的上一段时间。", "Previous period is the equally long window immediately before.")}</Text>
      {!hasCost ? <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "成本：当前没有 Agent 上报。", "Cost: no agent reports it in this range.")}</Text> : null}
    </View>
  );
}

export function AnomalyCard({ data, theme, locale }: CardProps) {
  const daily = data.series.filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.key));
  const first = daily[0];
  const second = daily[1];
  const dailyGap = first && second ? Date.parse(`${second.key}T00:00:00.000Z`) - Date.parse(`${first.key}T00:00:00.000Z`) : 0;
  const series = dailyGap > 0 && dailyGap <= 1.5 * 86_400_000 ? daily : [];
  const anomalies = useMemo(() => {
    const output: Array<{ point: UsageSeriesPoint; z: number; average: number }> = [];
    for (let index = 7; index < series.length; index += 1) {
      const window = series.slice(index - 7, index);
      const values = window.map((point) => point.totalTokens);
      const average = sum(values) / Math.max(1, values.length);
      const variance = sum(values.map((value) => (value - average) ** 2)) / Math.max(1, values.length);
      const deviation = Math.sqrt(variance);
      if (deviation <= 0) continue;
      const z = ((series[index]?.totalTokens ?? 0) - average) / deviation;
      if (Math.abs(z) >= 2) output.push({ point: series[index] as UsageSeriesPoint, z, average });
    }
    return output.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 5);
  }, [series]);
  return (
    <View style={{ gap: 7 }}>
      <TrendChart
        theme={theme}
        points={series.map((point) => ({ label: point.label, value: point.totalTokens, detail: point.full }))}
        color={TOKEN_COLORS.cacheRead}
        format={formatTokens}
        height={72}
        average
        compact
      />
      {series.length < 9 ? (
        <Empty theme={theme} text={pick(locale, "至少需要 9 天日粒度数据才能判断异常。", "At least 9 daily points are needed to detect outliers.")} />
      ) : anomalies.length === 0 ? (
        <Empty theme={theme} text={pick(locale, "最近没有明显偏离滚动均值的日子。", "No days clearly off the rolling average.")} />
      ) : (
        anomalies.map((item) => (
          <View key={item.point.key} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
            <Text style={{ width: 62, fontSize: 10, color: theme.colors.foreground }}>{item.point.full}</Text>
            <Text style={{ flex: 1, fontSize: 11, color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{formatTokens(item.point.totalTokens)}</Text>
            <Text style={{ fontSize: 10, color: item.z > 0 ? theme.colors.statusDanger : theme.colors.statusSuccess, fontVariant: ["tabular-nums"] }}>{item.z > 0 ? "+" : ""}{item.z.toFixed(1)}σ</Text>
          </View>
        ))
      )}
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "7 日滚动均值，偏离 ±2σ 记为异常。", "7-day rolling mean; ±2σ marks an outlier.")}</Text>
    </View>
  );
}

type ShareMetric = "tokens" | "requests" | "cost";

export function AgentShareCard({ data, theme, locale }: CardProps) {
  const [metric, setMetric] = useState<ShareMetric>("tokens");
  const agents = sortAgents(data.agents, metric);
  const total = sum(agents.map((agent) => (metric === "tokens" ? agent.totalTokens : metric === "requests" ? agent.requests : agent.reportedCostUsd)));
  const segments = agents.map((agent) => ({ key: agent.id, value: metric === "tokens" ? agent.totalTokens : metric === "requests" ? agent.requests : agent.reportedCostUsd, color: agentColor(agent.id) }));
  const rows = agents.map((agent) => ({
    key: agent.id,
    label: agent.label,
    sub: `${formatTokens(agent.totalTokens)} tok · ${formatCount(agent.requests)} ${pick(locale, "次", "req")}`,
    value: metric === "tokens" ? agent.totalTokens : metric === "requests" ? agent.requests : agent.reportedCostUsd,
    color: agentColor(agent.id),
  }));
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <MetricSwitch
          theme={theme}
          value={metric}
          options={[
            { value: "tokens", label: pick(locale, "Token", "Tokens") },
            { value: "requests", label: pick(locale, "请求", "Requests") },
            { value: "cost", label: pick(locale, "成本", "Cost") },
          ]}
          onChange={setMetric}
        />
      </View>
      {agents.length === 0 ? (
        <Empty theme={theme} text={pick(locale, "当前范围没有 Agent 用量。", "No agent usage in this range.")} />
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Dial
              theme={theme}
              size={104}
              stroke={12}
              segments={segments}
              center={
                <>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: theme.colors.foreground }}>{metric === "cost" ? formatUsd(total) : metric === "requests" ? formatCount(total) : formatTokens(total)}</Text>
                  <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{metric === "cost" ? "USD" : metric === "requests" ? "req" : "tok"}</Text>
                </>
              }
            />
            <View style={{ flex: 1, minWidth: 160 }}>
              <RankedRows theme={theme} rows={rows} format={(value) => (metric === "cost" ? formatUsd(value) : metric === "requests" ? formatCount(value) : formatTokens(value))} limit={4} emptyText="" locale={locale} />
            </View>
          </View>
          {metric === "cost" ? <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "成本只统计有上报的 Agent。", "Cost only covers agents that report it.")}</Text> : null}
        </>
      )}
    </View>
  );
}

type HostMetric = "tokens" | "requests";

export function HostCompareCard({ data, theme, locale, localAlias }: CardProps) {
  const [metric, setMetric] = useState<HostMetric>("tokens");
  const origins = [...data.origins].sort((a, b) => (metric === "tokens" ? b.totalTokens - a.totalTokens : b.requests - a.requests));
  const total = sum(origins.map((origin) => (metric === "tokens" ? origin.totalTokens : origin.requests)));
  const rows = origins.map((origin, index) => ({
    key: origin.id,
    label: originLabel(origin, locale, localAlias),
    sub: `${originStatus(locale, origin.status)} · ${originSync(locale, origin)}`,
    value: metric === "tokens" ? origin.totalTokens : origin.requests,
    color: index === 0 ? agentColor("claude") : index === 1 ? agentColor("codex") : agentColor("opencode"),
  }));
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <MetricSwitch
          theme={theme}
          value={metric}
          options={[
            { value: "tokens", label: pick(locale, "Token", "Tokens") },
            { value: "requests", label: pick(locale, "请求", "Requests") },
          ]}
          onChange={setMetric}
        />
      </View>
      {origins.length === 0 ? (
        <Empty theme={theme} text={pick(locale, "还没有数据源。", "No data sources yet.")} />
      ) : (
        <>
          <ShareBar
            theme={theme}
            height={8}
            segments={origins.map((origin, index) => ({
              key: origin.id,
              value: metric === "tokens" ? origin.totalTokens : origin.requests,
              color: index === 0 ? agentColor("claude") : index === 1 ? agentColor("codex") : agentColor("opencode"),
            }))}
          />
          <RankedRows theme={theme} rows={rows} format={(value) => (metric === "tokens" ? formatTokens(value) : formatCount(value))} limit={5} emptyText="" locale={locale} />
          <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
            {pick(locale, `合计 ${metric === "tokens" ? formatTokens(total) : formatCount(total)}，远端失败会在这里显示。`, `Total ${metric === "tokens" ? formatTokens(total) : formatCount(total)}; remote errors show here.`)}
          </Text>
        </>
      )}
    </View>
  );
}
