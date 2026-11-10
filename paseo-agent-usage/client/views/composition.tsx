import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { UsageModelItem, UsageProjectItem } from "../../shared/usage";
import { agentColor, agentShort, TOKEN_COLORS } from "../agents";
import { totalTokens } from "../dashboard-data";
import { formatCount, formatTokens, formatUsd, shortProject } from "../format";
import { Dial, Empty, Legend, MatrixHeatmap, MetricSwitch, RankedRows, ShareBar, Treemap, TrendChart } from "../visuals";
import { pick, sum, type CardProps } from "./shared";

type ValueMetric = "tokens" | "requests" | "cost";

const tokenNames = (locale: CardProps["locale"]) =>
  locale === "zh"
    ? { cacheRead: "缓存读", cacheWrite: "缓存写", input: "新输入", output: "输出" }
    : { cacheRead: "Cache read", cacheWrite: "Cache write", input: "New input", output: "Output" };

export function TokenCompositionCard({ data, theme, locale }: CardProps) {
  const totals = data.totals;
  const total = totalTokens(totals);
  const names = tokenNames(locale);
  const segments = [
    { key: "cacheRead", value: totals.cacheRead, color: TOKEN_COLORS.cacheRead },
    { key: "cacheWrite", value: totals.cacheWrite, color: TOKEN_COLORS.cacheWrite },
    { key: "input", value: totals.input, color: TOKEN_COLORS.input },
    { key: "output", value: totals.output, color: TOKEN_COLORS.output },
  ];
  const hit = total > 0 ? totals.cacheRead / Math.max(1, totals.input + totals.cacheRead + totals.cacheWrite) : null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <Dial
        theme={theme}
        size={124}
        stroke={14}
        segments={segments}
        center={
          <>
            <Text style={{ fontSize: 19, fontWeight: "700", color: theme.colors.foreground }}>{hit === null ? "—" : `${Math.round(hit * 100)}%`}</Text>
            <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, "缓存命中", "Cache hit")}</Text>
          </>
        }
      />
      <View style={{ flex: 1, minWidth: 170, gap: 7 }}>
        {segments.map((segment) => (
          <View key={segment.key} style={{ gap: 3 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 1, backgroundColor: segment.color }} />
              <Text style={{ flex: 1, fontSize: 11, color: theme.colors.foreground }}>{names[segment.key as keyof typeof names]}</Text>
              <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{formatTokens(segment.value)}</Text>
              <Text style={{ width: 38, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{total > 0 ? `${Math.round((segment.value / total) * 100)}%` : "—"}</Text>
            </View>
            <ShareBar theme={theme} height={3} segments={[{ key: segment.key, value: segment.value, color: segment.color }]} />
          </View>
        ))}
        <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "缓存读通常占大头，输出才是实际生成量。", "Cache reads usually dominate; output is what gets generated.")}</Text>
      </View>
    </View>
  );
}

interface RankGroup {
  key: string;
  label: string;
  value: number;
  requests: number;
  cost: number;
  agents: Set<string>;
}

function groupModels(models: readonly UsageModelItem[]): RankGroup[] {
  const map = new Map<string, RankGroup>();
  for (const model of models) {
    const key = model.model || "unknown";
    const group = map.get(key) ?? { key, label: key, value: 0, requests: 0, cost: 0, agents: new Set<string>() };
    group.value += model.totalTokens;
    group.requests += model.requests;
    group.cost += model.reportedCostUsd;
    group.agents.add(model.agent);
    map.set(key, group);
  }
  return [...map.values()];
}

function groupProjects(projects: readonly UsageProjectItem[]): RankGroup[] {
  return projects.map((project) => ({
    key: project.project || "unknown",
    label: shortProject(project.project) || "—",
    value: project.totalTokens,
    requests: project.requests,
    cost: 0,
    agents: new Set<string>(),
  }));
}

function metricOf(group: RankGroup, metric: ValueMetric): number {
  return metric === "tokens" ? group.value : metric === "requests" ? group.requests : group.cost;
}

function RankCard({
  data,
  theme,
  locale,
  kind,
}: CardProps & { kind: "model" | "project" }) {
  const [metric, setMetric] = useState<ValueMetric>("tokens");
  const [view, setView] = useState<"rank" | "pareto">("rank");
  const groups = useMemo(() => (kind === "model" ? groupModels(data.models) : groupProjects(data.projects)), [data.models, data.projects, kind]);
  const sorted = useMemo(() => [...groups].filter((group) => metricOf(group, metric) > 0).sort((a, b) => metricOf(b, metric) - metricOf(a, metric)), [groups, metric]);
  const total = sum(sorted.map((group) => metricOf(group, metric)));
  const rows = sorted.map((group) => ({
    key: group.key,
    label: group.label,
    sub: kind === "model" ? [...group.agents].map(agentShort).join(" · ") : `${formatCount(group.requests)} ${pick(locale, "请求", "req")}`,
    value: metricOf(group, metric),
    color: kind === "model" ? agentColor([...group.agents][0] ?? "codex") : TOKEN_COLORS.cacheRead,
  }));
  const pareto = useMemo(() => {
    let running = 0;
    return sorted.map((group) => {
      running += metricOf(group, metric);
      return {
        label: group.label.slice(0, 10),
        value: total > 0 ? (running / total) * 100 : 0,
        detail: group.label,
      };
    });
  }, [sorted, metric, total]);
  const formatter = (value: number) => (metric === "tokens" ? formatTokens(value) : metric === "requests" ? formatCount(value) : formatUsd(value));
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 4, flexWrap: "wrap" }}>
        <MetricSwitch
          theme={theme}
          value={view}
          options={[
            { value: "rank", label: pick(locale, "排行", "Rank") },
            { value: "pareto", label: pick(locale, "集中度", "Concentration") },
          ]}
          onChange={setView}
        />
        <MetricSwitch
          theme={theme}
          value={metric}
          options={[
            { value: "tokens", label: pick(locale, "Token", "Tokens") },
            { value: "requests", label: pick(locale, "请求", "Requests") },
            ...(kind === "model" ? [{ value: "cost" as const, label: pick(locale, "成本", "Cost") }] : []),
          ]}
          onChange={setMetric}
        />
      </View>
      {sorted.length === 0 ? (
        <Empty theme={theme} text={pick(locale, "当前范围没有可排行的数据。", "Nothing to rank in this range.")} />
      ) : view === "pareto" ? (
        <TrendChart theme={theme} points={pareto} color={kind === "model" ? agentColor("codex") : TOKEN_COLORS.cacheRead} format={(value) => `${value.toFixed(0)}%`} mode="line" average={false} height={110} compact />
      ) : (
        <RankedRows theme={theme} rows={rows} format={formatter} limit={6} compact emptyText="" locale={locale} />
      )}
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(locale, `共 ${sorted.length} 项，合计 ${formatter(total)}。`, `${sorted.length} items, total ${formatter(total)}.`)}
      </Text>
    </View>
  );
}

export function ModelRankCard(props: CardProps) {
  return <RankCard {...props} kind="model" />;
}

export function ProjectRankCard(props: CardProps) {
  return <RankCard {...props} kind="project" />;
}

export function AgentModelCard({ data, theme, locale, compact }: CardProps) {
  const pairs = data.pairs?.agentModels;
  if (!pairs) return <Empty theme={theme} text={pick(locale, "当前作用域没有配对矩阵。", "No pair matrix in this scope.")} />;
  return (
    <View style={{ gap: 6 }}>
      <MatrixHeatmap
        theme={theme}
        rows={pairs.rows}
        cols={pairs.cols}
        values={pairs.tokens}
        color={agentColor("codex")}
        format={formatTokens}
        rowLabel={(key) => data.agents.find((agent) => agent.id === key)?.label ?? agentShort(key)}
        colLabel={(key) => key}
        compact={compact}
        locale={locale}
      />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "Top 8 Agent × Top 8 模型。", "Top 8 agents × top 8 models.")}</Text>
    </View>
  );
}

export function ProjectAgentCard({ data, theme, locale, compact }: CardProps) {
  const pairs = data.pairs?.projectAgents;
  if (!pairs) return <Empty theme={theme} text={pick(locale, "当前作用域没有配对矩阵。", "No pair matrix in this scope.")} />;
  return (
    <View style={{ gap: 6 }}>
      <MatrixHeatmap
        theme={theme}
        rows={pairs.rows}
        cols={pairs.cols}
        values={pairs.tokens}
        color={agentColor("opencode")}
        format={formatTokens}
        rowLabel={(key) => shortProject(key)}
        colLabel={(key) => agentShort(key)}
        compact={compact}
        locale={locale}
      />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "Top 8 项目 × Top 8 Agent。", "Top 8 projects × top 8 agents.")}</Text>
    </View>
  );
}

export function TreemapCard({ data, theme, locale, compact }: CardProps) {
  const [kind, setKind] = useState<"project" | "model">("project");
  const pairs = data.pairs;
  const items = useMemo(() => {
    if (!pairs) return [];
    if (kind === "project") {
      return pairs.projectAgents.rows.map((project, rowIndex) => {
        const parts = pairs.projectAgents.cols.map((agent, colIndex) => ({
          key: agent,
          value: pairs.projectAgents.tokens[rowIndex]?.[colIndex] ?? 0,
          color: agentColor(agent),
        }));
        return {
          key: project,
          label: shortProject(project),
          value: sum(parts.map((part) => part.value)),
          parts,
        };
      });
    }
    return pairs.agentModels.cols.map((model, colIndex) => {
      const parts = pairs.agentModels.rows.map((agent, rowIndex) => ({
        key: agent,
        value: pairs.agentModels.tokens[rowIndex]?.[colIndex] ?? 0,
        color: agentColor(agent),
      }));
      return {
        key: model,
        label: model,
        value: sum(parts.map((part) => part.value)),
        parts,
      };
    });
  }, [pairs, kind]);
  return (
    <View style={{ gap: 7 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
        <MetricSwitch
          theme={theme}
          value={kind}
          options={[
            { value: "project", label: pick(locale, "项目", "Projects") },
            { value: "model", label: pick(locale, "模型", "Models") },
          ]}
          onChange={setKind}
        />
        <Legend
          theme={theme}
          items={data.agents.filter((agent) => agent.totalTokens > 0).map((agent) => ({ key: agent.id, label: agent.label, color: agentColor(agent.id) }))}
        />
      </View>
      <Treemap theme={theme} items={items} compact={compact} locale={locale} />
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pick(locale, "面积代表总量，内部颜色按 Agent 切分；只显示 Top 8。", "Area is total, colour splits by agent; top 8 only.")}</Text>
    </View>
  );
}