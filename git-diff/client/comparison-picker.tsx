import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Text, useWindowDimensions, View } from "react-native";
import type { RepositorySnapshot } from "../shared/contracts";
import type { GitRef } from "../shared/history-contracts";
import { CommitGraphRow } from "./commit-graph";
import { ToolButton } from "./controls";
import { buildCommitGraph } from "./graph-model";
import { SettingsSelect } from "./settings-select";
import { panelTokens } from "./theme";
import { useHistory } from "./use-history";
import type { ReviewSelection } from "./use-review";

const NO_REFS: GitRef[] = [];

export function ComparisonPicker({
  directory,
  name,
  theme,
  repositories,
  value,
  onApply,
  onClose,
}: {
  directory: string;
  name: string;
  theme: PluginTheme;
  repositories: RepositorySnapshot[];
  value: ReviewSelection | null;
  onApply(selection: ReviewSelection | null): void;
  onClose(): void;
}) {
  const c = panelTokens(theme);
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState<"branch" | "range">(value?.selection.mode ?? "branch");
  const [repositoryId, setRepositoryId] = useState(value?.repositoryId ?? ".");
  const [baseRef, setBaseRef] = useState(
    value?.selection.mode === "branch" ? value.selection.baseRef : "auto",
  );
  const [strategy, setStrategy] = useState<"merge-base" | "tips">(
    value?.selection.mode === "branch" ? value.selection.strategy : "merge-base",
  );
  const [oldest, setOldest] = useState(
    value?.selection.mode === "range" ? value.selection.oldest : "",
  );
  const [newest, setNewest] = useState(
    value?.selection.mode === "range" ? value.selection.newest : "",
  );
  const [anchor, setAnchor] = useState<string | null>(null);
  const history = useHistory(directory, repositoryId, "head", true);
  const graph = useMemo(
    () => buildCommitGraph(history.data?.commits ?? []),
    [history.data?.commits],
  );
  const commits = history.data?.commits ?? [];
  const start = oldest || commits[0]?.oid || "";
  const end = newest || commits[0]?.oid || "";
  const startIndex = commits.findIndex((commit) => commit.oid === start);
  const endIndex = commits.findIndex((commit) => commit.oid === end);
  const options = commits.map((commit) => ({
    value: commit.oid,
    label: `${commit.oid.slice(0, 8)} · ${commit.subject}`,
  }));
  // Preserve endpoints beyond the loaded page when reopening a large range.
  for (const oid of [start, end])
    if (oid && !options.some((item) => item.value === oid))
      options.push({ value: oid, label: oid.slice(0, 8) });
  function selectCommit(oid: string) {
    const a = commits.findIndex((commit) => commit.oid === anchor);
    const b = commits.findIndex((commit) => commit.oid === oid);
    if (a < 0) {
      setOldest(oid);
      setNewest(oid);
      setAnchor(oid);
    } else {
      setOldest(commits[Math.max(a, b)].oid);
      setNewest(commits[Math.min(a, b)].oid);
      setAnchor(null);
    }
  }
  return (
    <Modal transparent animationType="none" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: 12,
          backgroundColor: "#00000055",
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            width: Math.min(600, width - 24),
            maxHeight: height - 40,
            backgroundColor: c.surface0,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 5,
          }}
        >
          <View
            style={{
              height: 38,
              paddingHorizontal: 10,
              flexDirection: "row",
              alignItems: "center",
              borderBottomWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface1,
            }}
          >
            <Text style={{ flex: 1, color: c.foreground, fontSize: 12, fontWeight: "600" }}>
              比较范围
            </Text>
            <ToolButton theme={theme} label="关闭比较范围" icon="close" onPress={onClose} />
          </View>
          <FlatList
            style={{ flexGrow: 0, flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 12 }}
            data={mode === "range" ? graph.rows : []}
            keyExtractor={(row) => row.commit.oid}
            ListHeaderComponent={
              <View style={{ gap: 10, paddingBottom: 10 }}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <ToolButton
                    theme={theme}
                    label="分支对比"
                    text="分支对比"
                    icon="branch"
                    active={mode === "branch"}
                    onPress={() => setMode("branch")}
                  />
                  <ToolButton
                    theme={theme}
                    label="连续提交"
                    text="连续提交"
                    icon="source"
                    active={mode === "range"}
                    onPress={() => setMode("range")}
                  />
                </View>
                <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>仓库</Text>
                <SettingsSelect
                  theme={theme}
                  label="比较仓库"
                  value={repositoryId}
                  options={
                    repositories.length
                      ? repositories
                          .filter((repository) => repository.state === "ready")
                          .map((repository) => ({
                            value: repository.id,
                            label: repository.id === "." ? name : repository.relativePath,
                          }))
                      : [{ value: ".", label: name }]
                  }
                  onChange={(id) => {
                    setRepositoryId(id);
                    setBaseRef("auto");
                    setOldest("");
                    setNewest("");
                    setAnchor(null);
                  }}
                />
                {mode === "branch" ? (
                  <>
                    <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
                      基准分支 → 当前 HEAD
                    </Text>
                    <SettingsSelect
                      theme={theme}
                      label="基准分支"
                      value={baseRef}
                      onChange={setBaseRef}
                      options={[
                        { value: "auto", label: "自动 · 默认分支 / main / master" },
                        ...(history.data?.refs ?? [])
                          .filter((ref) => ref.kind !== "tag")
                          .map((ref) => ({ value: ref.fullName, label: ref.name })),
                      ]}
                    />
                    <SettingsSelect
                      theme={theme}
                      label="比较方式"
                      value={strategy}
                      onChange={(next) => setStrategy(next as typeof strategy)}
                      options={[
                        { value: "merge-base", label: "分支引入的改动 · 共同祖先 → HEAD" },
                        { value: "tips", label: "直接比较 · 基准分支 → HEAD" },
                      ]}
                    />
                    <Text style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 17 }}>
                      仅比较已提交内容；远端分支使用最近一次 fetch 的本地记录。
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>起始提交（包含）</Text>
                    <SettingsSelect
                      theme={theme}
                      label="起始提交（包含）"
                      value={start}
                      options={options}
                      onChange={(oid) => {
                        setOldest(oid);
                        setAnchor(null);
                      }}
                    />
                    <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>结束提交（包含）</Text>
                    <SettingsSelect
                      theme={theme}
                      label="结束提交（包含）"
                      value={end}
                      options={options}
                      onChange={(oid) => {
                        setNewest(oid);
                        setAnchor(null);
                      }}
                    />
                    <Text style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 17 }}>
                      {anchor
                        ? "再点击一个提交，选中包含首尾的连续区间。"
                        : "沿第一父提交链选择两个端点，包含首尾提交。"}
                    </Text>
                  </>
                )}
              </View>
            }
            renderItem={({ item, index }) => (
              <CommitGraphRow
                row={item}
                graphWidth={42}
                theme={theme}
                references={NO_REFS}
                head={history.data?.head === item.commit.oid}
                active={index >= endIndex && index <= startIndex}
                matched
                showAuthor={false}
                showDate={false}
                onSelect={selectCommit}
              />
            )}
            ListFooterComponent={
              <View style={{ gap: 10, paddingTop: 6 }}>
                {mode === "range" && history.data?.hasMore ? (
                  <ToolButton
                    theme={theme}
                    label="加载更多区间提交"
                    text="加载更多提交"
                    busy={history.loadingMore}
                    onPress={() => void history.loadMore()}
                  />
                ) : null}
                {history.loading ? (
                  <ActivityIndicator color={c.accent} />
                ) : history.error ? (
                  <View accessibilityRole="alert" style={{ gap: 5 }}>
                    <Text style={{ color: c.statusDanger, fontSize: 12 }}>{history.error}</Text>
                    <ToolButton
                      theme={theme}
                      label="重试读取比较历史"
                      icon="refresh"
                      text="重试"
                      onPress={history.refresh}
                    />
                  </View>
                ) : !history.data?.head ? (
                  <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>仓库尚无提交。</Text>
                ) : null}
              </View>
            }
          />
          <View
            style={{
              padding: 8,
              gap: 8,
              flexDirection: "row",
              justifyContent: "flex-end",
              borderTopWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface1,
            }}
          >
            {value ? (
              <ToolButton
                theme={theme}
                label="返回未提交更改"
                text="未提交更改"
                onPress={() => onApply(null)}
              />
            ) : null}
            <ToolButton theme={theme} label="取消比较选择" text="取消" onPress={onClose} />
            <ToolButton
              theme={theme}
              label="应用比较范围"
              text="比较"
              icon="check"
              disabled={
                history.loading ||
                Boolean(history.error) ||
                !history.data?.head ||
                (mode === "range" && (!start || !end))
              }
              onPress={() =>
                onApply({
                  repositoryId,
                  selection:
                    mode === "branch"
                      ? { mode, baseRef, strategy }
                      : { mode, oldest: start, newest: end },
                })
              }
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
