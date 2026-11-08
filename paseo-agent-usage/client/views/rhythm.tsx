import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { agentColor, agentShort, TOKEN_COLORS } from "../agents";
import { activeDays, streak } from "../dashboard-data";
import { formatCount, formatHour, formatTokens } from "../format";
import { CalendarDots, Empty, LedgerStrip, MatrixHeatmap, MetricSwitch, Punchcard, TrendChart, type LedgerCell } from "../visuals";
import { percentText, pick, sum, type CardProps } from "./shared";

type CalendarMetric = "tokens" | "requests" | "sessions";

const weekdayLabels = (locale: CardProps["locale"]): string[] =>
  locale === "zh" ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarCard({ data, theme, locale, compact }: CardProps) {
  const [metric, setMetric] = useState<CalendarMetric>("tokens");
  const values = metric === "tokens" ? data.calendar.tokens : metric === "requests" ? data.calendar.requests : data.calendar.sessions;
  const days = activeDays(data.calendar);
  const streaks = streak(data.calendar);
  return (
    <View style={{ gap: 7 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
        <MetricSwitch
          theme={theme}
          value={metric}
          options={[
            { value: "tokens", label: pick(locale, "Token", "Tokens") },
            { value: "requests", label: pick(locale, "请求", "Requests") },
            { value: "sessions", label: pick(locale, "会话", "Sessions") },
          ]}
          onChange={setMetric}
        />
        <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
          {pick(locale, `${days} 个活跃日 · 连续 ${streaks.current} 天`, `${days} active days · ${streaks.current}-day streak`)}
        </Text>
      </View>
      <CalendarDots
        theme={theme}
        calendar={data.calendar}
        values={values}
        color={metric === "tokens" ? TOKEN_COLORS.cacheRead : metric === "requests" ? TOKEN_COLORS.input : TOKEN_COLORS.output}
        compact={compact}
        locale={locale}
        formatValue={metric === "tokens" ? formatTokens : formatCount}
      />
    </View>
  );
}

type PunchMetric = "tokens" | "requests";

export function PunchcardCard({ data, theme, locale, compact }: CardProps) {
  const [metric, setMetric] = useState<PunchMetric>("tokens");
  const values = metric === "tokens" ? data.hourOfWeek.tokens : data.hourOfWeek.requests;
  const peak = values.reduce((best, value, index) => (value > (values[best] ?? 0) ? index : best), 0);
  return (
    <View style={{ gap: 7 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
        <MetricSwitch
          theme={theme}
          value={metric}
          options={[
            { value: "tokens", label: pick(locale, "Token", "Tokens") },
            { value: "requests", label: pick(locale, "请求", "Requests") },
          ]}
          onChange={setMetric}
        />
        <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
          {pick(locale, `峰值 ${weekdayLabels(locale)[Math.floor(peak / 24)]} ${formatHour(peak % 24)}`, `Peak ${weekdayLabels(locale)[Math.floor(peak / 24)]} ${formatHour(peak % 24)}`)}
        </Text>
      </View>
      <Punchcard theme={theme} matrix={data.hourOfWeek} values={values} color={TOKEN_COLORS.cacheRead} compact={compact} locale={locale} formatValue={metric === "tokens" ? formatTokens : formatCount} />
    </View>
  );
}

type HourMetric = "tokens" | "requests" | "sessions";

export function HourlyCard({ data, theme, locale, compact }: CardProps) {
  const [metric, setMetric] = useState<HourMetric>("tokens");
  const values = metric === "tokens" ? data.hourOfDay.tokens : metric === "requests" ? data.hourOfDay.requests : data.sessionStats.startHours;
  const peak = values.reduce((best, value, index) => (value > (values[best] ?? 0) ? index : best), 0);
  const formatter = metric === "sessions" ? formatCount : metric === "requests" ? formatCount : formatTokens;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
        <MetricSwitch
          theme={theme}
          value={metric}
          options={[
            { value: "tokens", label: pick(locale, "Token", "Tokens") },
            { value: "requests", label: pick(locale, "请求", "Requests") },
            { value: "sessions", label: pick(locale, "会话启动", "Session starts") },
          ]}
          onChange={setMetric}
        />
        <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
          {pick(locale, `峰值 ${formatHour(peak)}`, `Peak ${formatHour(peak)}`)}
        </Text>
      </View>
      <TrendChart
        theme={theme}
        points={values.map((value, hour) => ({ label: formatHour(hour), value, detail: `${formatHour(hour)} · ${formatter(value)}` }))}
        color={TOKEN_COLORS.input}
        format={formatter}
        height={116}
        compact={compact}
      />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(
          locale,
          `合计 ${formatter(sum(values))}；会话启动按会话首次请求所在的本地小时统计。`,
          `Total ${formatter(sum(values))}; session starts use the local hour of the first request.`,
        )}
      </Text>
    </View>
  );
}

type WeekdayMetric = "tokens" | "requests";

export function WeekdayCard({ data, theme, locale, compact }: CardProps) {
  const [metric, setMetric] = useState<WeekdayMetric>("tokens");
  const values = metric === "tokens" ? data.weekday.tokens : data.weekday.requests;
  const labels = weekdayLabels(locale);
  const formatter = metric === "tokens" ? formatTokens : formatCount;
  const peak = values.reduce((best, value, index) => (value > (values[best] ?? 0) ? index : best), 0);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
        <MetricSwitch
          theme={theme}
          value={metric}
          options={[
            { value: "tokens", label: pick(locale, "Token", "Tokens") },
            { value: "requests", label: pick(locale, "请求", "Requests") },
          ]}
          onChange={setMetric}
        />
        <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, `最活跃 ${labels[peak]}`, `Most active ${labels[peak]}`)}</Text>
      </View>
      <TrendChart
        theme={theme}
        points={values.map((value, index) => ({ label: labels[index] ?? "", value, detail: `${labels[index]} · ${formatter(value)}` }))}
        color={TOKEN_COLORS.cacheRead}
        format={formatter}
        height={116}
        average={false}
        compact={compact}
      />
    </View>
  );
}

export function ActivityCard({ data, theme, locale, compact }: CardProps) {
  const days = activeDays(data.calendar);
  const streaks = streak(data.calendar);
  const totalDays = data.calendar.tokens.length;
  const frequency = totalDays > 0 ? days / totalDays : 0;
  const recent = data.calendar.tokens.slice(-30);
  const cells: LedgerCell[] = [
    { key: "active", label: pick(locale, "活跃天数", "Active days"), value: `${days}`, sub: pick(locale, `共 ${totalDays} 天`, `of ${totalDays} days`), spark: { values: recent, color: TOKEN_COLORS.cacheRead } },
    { key: "current", label: pick(locale, "当前连续", "Current streak"), value: `${streaks.current}`, sub: pick(locale, "天", "days") },
    { key: "longest", label: pick(locale, "最长连续", "Longest streak"), value: `${streaks.longest}`, sub: pick(locale, "天", "days") },
    { key: "frequency", label: pick(locale, "使用频率", "Frequency"), value: percentText(frequency), sub: pick(locale, "按自然日", "calendar days") },
  ];
  return (
    <View style={{ gap: 7 }}>
      <LedgerStrip theme={theme} cells={cells} compact={compact} locale={locale} />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "以自然日计算；有 Token、请求或会话即视为活跃。", "Calendar days; any token, request or session counts as active.")}</Text>
    </View>
  );
}

export function TimeAgentCard({ data, theme, locale, compact }: CardProps) {
  const pairs = data.pairs?.agentHours;
  if (!pairs) return <Empty theme={theme} text={pick(locale, "当前作用域没有时段矩阵。", "No hour matrix in this scope.")} />;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {pairs.rows.map((agent) => (
          <View key={agent} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: agentColor(agent) }} />
            <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{agentShort(agent)}</Text>
          </View>
        ))}
      </View>
      <MatrixHeatmap
        theme={theme}
        rows={pairs.rows}
        cols={pairs.cols}
        values={pairs.tokens}
        color={agentColor("opencode")}
        format={formatTokens}
        rowLabel={(key) => agentShort(key)}
        colLabel={(key) => key}
        compact={compact}
        locale={locale}
      />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "每行是一个 Agent，每列是一个本地小时。", "Each row is an agent; each column is a local hour.")}</Text>
    </View>
  );
}
