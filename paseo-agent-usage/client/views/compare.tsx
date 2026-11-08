import { Text, View } from "react-native";
import { agentColor, COST_COLOR } from "../agents";
import { activeDays, totalTokens } from "../dashboard-data";
import { formatTokens, formatUsd } from "../format";
import { BudgetBar, Empty, LedgerStrip, Radar } from "../visuals";
import { originLabel, originStatus, percentText, pick, type CardProps } from "./shared";

export function AgentRadarCard({ data, theme, locale, compact }: CardProps) {
  const agents = data.agents.filter((agent) => agent.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 4);
  if (agents.length < 2) return <Empty theme={theme} text={pick(locale, "至少需要两个 Agent 才能做雷达对比。", "At least two agents are needed for a radar.")} />;
  const axes = [
    pick(locale, "总量", "Volume"),
    pick(locale, "请求", "Requests"),
    pick(locale, "缓存命中", "Cache hit"),
    pick(locale, "输出占比", "Output share"),
    pick(locale, "推理占比", "Reasoning"),
    pick(locale, "成本", "Cost"),
  ];
  const metric = (agent: (typeof agents)[number], index: number): number => {
    const total = totalTokens(agent);
    if (index === 0) return agent.totalTokens;
    if (index === 1) return agent.requests;
    if (index === 2) return agent.input + agent.cacheRead + agent.cacheWrite > 0 ? agent.cacheRead / (agent.input + agent.cacheRead + agent.cacheWrite) : 0;
    if (index === 3) return total > 0 ? agent.output / total : 0;
    if (index === 4) return total > 0 ? agent.reasoning / total : 0;
    return agent.reportedCostUsd;
  };
  const maxima = axes.map((_, index) => Math.max(...agents.map((agent) => metric(agent, index))));
  const series = agents.map((agent) => ({
    key: agent.id,
    color: agentColor(agent.id),
    values: axes.map((_, index) => {
      const max = maxima[index] ?? 0;
      return max > 0 ? metric(agent, index) / max : 0;
    }),
  }));
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
        <Radar theme={theme} axes={axes} series={series} size={compact ? 210 : 240} />
        <View style={{ gap: 7, minWidth: 150 }}>
          {agents.map((agent) => (
            <View key={agent.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: agentColor(agent.id) }} />
              <Text style={{ flex: 1, fontSize: 11, color: theme.colors.foreground }}>{agent.label}</Text>
              <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{formatTokens(agent.totalTokens)}</Text>
            </View>
          ))}
        </View>
      </View>
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "每个轴按参与对比的 Agent 最大值归一化；缓存命中为原始比例。", "Each axis is normalized to the largest agent; cache hit stays a raw ratio.")}</Text>
    </View>
  );
}

export function BudgetCard({ data, theme, locale, compact, budgetUsd = 0 }: CardProps) {
  const costAgents = data.agents.filter((agent) => agent.reportedCostUsd > 0);
  if (costAgents.length === 0) return <Empty theme={theme} text={pick(locale, "当前没有 Agent 上报成本，无法计算预算。", "No agent reports cost, so budget cannot be computed.")} />;
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 11, color: theme.colors.foreground }}>{pick(locale, "还没有设置月度预算。", "No monthly budget yet.")}</Text>
        <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "在「配置 → 通用」里填写月度预算（USD），这里会显示燃烧率和月末预测。", "Set a monthly budget (USD) in Settings → General to see burn rate and projection.")}</Text>
      </View>
    );
  }
  const now = new Date();
  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const spent = data.monthToDate.costUsd;
  const projected = day > 0 ? (spent / day) * daysInMonth : spent;
  const ratio = budgetUsd > 0 ? spent / budgetUsd : 0;
  const projectedRatio = budgetUsd > 0 ? projected / budgetUsd : 0;
  const cells = [
    { key: "spent", label: pick(locale, "本月已用", "Month to date"), value: formatUsd(spent), sub: pick(locale, `预算 ${formatUsd(budgetUsd)}`, `Budget ${formatUsd(budgetUsd)}`) },
    { key: "projected", label: pick(locale, "预计月末", "Projected"), value: formatUsd(projected), sub: pick(locale, `${daysInMonth - day} 天剩余`, `${daysInMonth - day} days left`) },
    { key: "ratio", label: pick(locale, "已用比例", "Used"), value: percentText(ratio), sub: pick(locale, `预计 ${percentText(projectedRatio)}`, `Projected ${percentText(projectedRatio)}`) },
  ];
  return (
    <View style={{ gap: 8 }}>
      <LedgerStrip theme={theme} cells={cells} compact={compact} locale={locale} />
      <BudgetBar theme={theme} ratio={ratio} color={COST_COLOR} />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "按本月至今的成本线性外推；只统计有成本上报的 Agent。", "Linearly projected from month-to-date cost; only agents that report cost.")}</Text>
    </View>
  );
}

export function CoverageCard({ data, theme, locale, compact, localAlias }: CardProps) {
  const days = data.calendar.tokens.length;
  const active = activeDays(data.calendar);
  return (
    <View style={{ gap: 7 }}>
      <LedgerStrip
        theme={theme}
        compact={compact}
        locale={locale}
        cells={[
          { key: "days", label: pick(locale, "日历覆盖", "Calendar"), value: `${days}d`, sub: pick(locale, `${active} 个活跃日`, `${active} active days`) },
          { key: "origins", label: pick(locale, "数据源", "Sources"), value: `${data.origins.length}`, sub: pick(locale, "本机 + 远端", "Local + remote") },
          { key: "first", label: pick(locale, "最早数据", "First data"), value: data.firstDay ?? "—", sub: data.scanError ? pick(locale, "扫描有错误", "Scan error") : pick(locale, "扫描正常", "Scan OK") },
        ]}
      />
      {data.origins.map((origin) => (
        <View key={origin.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <Text style={{ flex: 1, fontSize: 11, color: theme.colors.foreground }}>{originLabel(origin, locale, localAlias)}</Text>
          <Text style={{ fontSize: 10, color: origin.status === "error" ? theme.colors.statusDanger : theme.colors.foregroundMuted }}>{originStatus(locale, origin.status)}</Text>
          <Text style={{ width: 64, textAlign: "right", fontSize: 10, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{formatTokens(origin.totalTokens)}</Text>
        </View>
      ))}
      {data.scanError ? <Text style={{ fontSize: 10, color: theme.colors.statusDanger }}>{data.scanError}</Text> : null}
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(locale, `最后生成 ${new Date(data.generatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}；远端错误会显示在主机行。`, `Generated ${new Date(data.generatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}; remote errors appear on the host row.`)}
      </Text>
    </View>
  );
}
