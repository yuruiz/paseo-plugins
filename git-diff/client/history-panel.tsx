import type { PluginTheme } from "@getpaseo/plugin";
import { copyText } from "@getpaseo/plugin/client/react-native";
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FlatList, Platform, ScrollView, Text, type TextInput, View } from "react-native";
import type { GitRef } from "../shared/history-contracts";
import { defaultSettings } from "../shared/settings";
import { CommitDiff, CommitSummary, HistoryNotice } from "./commit-details";
import { COMMIT_ROW_HEIGHT, CommitGraphRow } from "./commit-graph";
import { InputField, ToolButton } from "./controls";
import { buildCommitGraph, type GraphRow, matchesCommit } from "./graph-model";
import { Icon } from "./icons";
import { SettingsPanel } from "./settings-panel";
import { SettingsSelect } from "./settings-select";
import { panelTokens } from "./theme";
import { useChanges } from "./use-changes";
import { useCommit, useHistory } from "./use-history";
import type { usePanelSettings } from "./use-panel-settings";
import { HistoryResizer, ScrollbarStyle } from "./web-chrome";

const NO_REFS: GitRef[] = [];

export function HistoryPanel({
  directory,
  name,
  theme,
  compact: hostCompact,
  preferences,
  viewSwitcher,
}: {
  directory: string;
  name: string;
  theme: PluginTheme;
  compact: boolean;
  preferences: ReturnType<typeof usePanelSettings>;
  viewSwitcher: ReactNode;
}) {
  const c = panelTokens(theme);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [bodyHeight, setBodyHeight] = useState(0);
  const compact = hostCompact || size.width < 720;
  const [repositoryId, setRepositoryId] = useState(".");
  const [reference, setReference] = useState("all");
  const [filter, setFilter] = useState("");
  const query = useDeferredValue(filter.trim());
  const [selection, setSelection] = useState<{ key: string; oid: string } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const scopeKey = JSON.stringify([directory, repositoryId, reference]);
  const selected = selection?.key === scopeKey ? selection.oid : null;
  const repositories = useChanges(directory, "head", false);
  const history = useHistory(directory, repositoryId, reference);
  const detail = useCommit(directory, repositoryId, selected);
  const refsByRepository = useRef(new Map<string, GitRef[]>());
  const refs = history.data?.refs ?? refsByRepository.current.get(repositoryId) ?? NO_REFS;
  useEffect(() => {
    if (history.data) refsByRepository.current.set(repositoryId, history.data.refs);
  }, [history.data, repositoryId]);
  const graph = useMemo(
    () => buildCommitGraph(history.data?.commits ?? []),
    [history.data?.commits],
  );
  const refsByOid = useMemo(() => {
    const lookup = new Map<string, GitRef[]>();
    for (const ref of refs) lookup.set(ref.oid, [...(lookup.get(ref.oid) ?? []), ref]);
    for (const items of lookup.values())
      items.sort(
        (a, b) =>
          Number(b.current) - Number(a.current) ||
          a.kind.localeCompare(b.kind) ||
          a.name.localeCompare(b.name),
      );
    return lookup;
  }, [refs]);
  const matching = useMemo(
    () => graph.rows.flatMap((row, index) => (matchesCommit(row.commit, query) ? [index] : [])),
    [graph.rows, query],
  );
  const listRef = useRef<FlatList<GraphRow>>(null);
  const inputRef = useRef<TextInput>(null);
  const selectedIndex = graph.rows.findIndex((row) => row.commit.oid === selected);
  const matchIndex = matching.indexOf(selectedIndex);
  const graphWidth = Math.max(68, graph.width * 16 + 26);
  const tableWidth = Math.max(size.width, graphWidth + 260);
  const showAuthor = size.width >= 1000;
  const showDate = size.width >= 820;
  const showDetails = Boolean(selected && (detailsOpen ?? !compact));
  const showGraph = !(showDetails && (expanded || compact));
  const minDetailsHeight = Math.min(160, bodyHeight / 2);
  const maxDetailsHeight = bodyHeight - Math.min(128, bodyHeight / 2);
  const detailsHeight = Math.max(
    minDetailsHeight,
    Math.min(maxDetailsHeight, bodyHeight * preferences.values.historyDetailsRatio),
  );
  const selectedCommit = graph.rows[selectedIndex]?.commit;
  const scrollTo = useCallback((index: number) => {
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.4 });
  }, []);
  const selectCommit = useCallback(
    (oid: string) => {
      setSelection({ key: scopeKey, oid });
      setFile(null);
      setDetailsOpen(true);
    },
    [scopeKey],
  );
  useEffect(() => {
    const first = history.data?.commits[0];
    if (!selected && first) {
      setSelection({ key: scopeKey, oid: first.oid });
      setFile(null);
    }
  }, [history.data, selected, scopeKey]);
  useEffect(() => {
    if (!query || !matching.length) return;
    const index = matching[0];
    setSelection({ key: scopeKey, oid: graph.rows[index].commit.oid });
    setFile(null);
    scrollTo(index);
  }, [query, matching, graph.rows, scopeKey, scrollTo]);
  function moveMatch(delta: number) {
    if (!matching.length) return;
    const next =
      matchIndex < 0
        ? delta > 0
          ? 0
          : matching.length - 1
        : (matchIndex + delta + matching.length) % matching.length;
    const index = matching[next];
    setSelection({ key: scopeKey, oid: graph.rows[index].commit.oid });
    setFile(null);
    scrollTo(index);
  }
  function changeRepository(value: string) {
    setRepositoryId(value);
    setReference("all");
    setDetailsOpen(null);
    setExpanded(false);
    setFile(null);
    setCopyStatus(null);
  }
  function refresh() {
    repositories.refresh();
    history.refresh();
  }
  function onKeyDown(event: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    target?: { tagName?: string; closest?(selector: string): unknown };
    preventDefault(): void;
    stopPropagation(): void;
  }) {
    if (event.target?.closest?.('[role="menu"]')) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.focus();
      return;
    }
    if (event.key === "Escape") {
      if (file) setFile(null);
      else if (filter) setFilter("");
      else if (showDetails) {
        setDetailsOpen(false);
        setExpanded(false);
      }
      return;
    }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName ?? "")) return;
    if (!event.target?.closest?.('[data-testid="git-commit-list"]')) return;
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) && graph.rows.length) {
      event.preventDefault();
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? graph.rows.length - 1
            : Math.max(
                0,
                Math.min(
                  graph.rows.length - 1,
                  selectedIndex + (event.key === "ArrowDown" ? 1 : -1),
                ),
              );
      setSelection({ key: scopeKey, oid: graph.rows[index].commit.oid });
      setFile(null);
      scrollTo(index);
    } else if (event.key === "Enter" && selected) {
      event.preventDefault();
      setDetailsOpen(true);
    }
  }
  const renderRow = useCallback(
    ({ item }: { item: GraphRow }) => (
      <CommitGraphRow
        row={item}
        graphWidth={graphWidth}
        theme={theme}
        references={refsByOid.get(item.commit.oid) ?? NO_REFS}
        head={history.data?.head === item.commit.oid}
        active={selected === item.commit.oid}
        matched={matchesCommit(item.commit, query)}
        showAuthor={showAuthor}
        showDate={showDate}
        onSelect={selectCommit}
      />
    ),
    [
      graphWidth,
      theme,
      refsByOid,
      history.data?.head,
      selected,
      query,
      showAuthor,
      showDate,
      selectCommit,
    ],
  );
  return (
    <View
      testID="git-history-panel"
      style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: c.surface0 }}
      onLayout={(event) =>
        setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
      }
      {...(Platform.OS === "web" ? { onKeyDownCapture: onKeyDown } : {})}
    >
      <ScrollbarStyle theme={theme} thin={preferences.values.scrollbar === "thin"} />
      {showSettings ? (
        <SettingsPanel
          theme={theme}
          values={preferences.values}
          update={preferences.update}
          saving={preferences.saving}
          error={preferences.error}
          retry={preferences.retry}
          reset={preferences.reset}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
      <View
        style={{
          minHeight: 44,
          flexDirection: "row",
          gap: 7,
          alignItems: "center",
          paddingHorizontal: 10,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
          backgroundColor: c.surface1,
        }}
      >
        {viewSwitcher}
        <View style={{ flex: 1, minWidth: 0, maxWidth: 310 }}>
          <SettingsSelect
            label="提交图仓库"
            value={repositoryId}
            options={
              (repositories.data?.repositories ?? []).length
                ? (repositories.data?.repositories ?? []).map((repo) => ({
                    value: repo.id,
                    label: `${repo.id === "." ? name : repo.relativePath}${repo.state === "uninitialized" ? " · 未初始化" : repo.state === "error" ? " · 读取失败" : ""}`,
                  }))
                : [{ value: ".", label: name }]
            }
            onChange={changeRepository}
            theme={theme}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0, maxWidth: 260 }}>
          <SettingsSelect
            label="提交图分支范围"
            value={reference}
            options={[
              { value: "all", label: "所有分支" },
              { value: "head", label: "当前 HEAD" },
              ...refs.map((ref) => ({
                value: ref.fullName,
                label: `${ref.kind === "tag" ? "标签" : ref.kind === "remote" ? "远端" : "分支"} · ${ref.name}`,
              })),
            ]}
            onChange={(value) => {
              setReference(value);
              setFile(null);
              setDetailsOpen(null);
              setExpanded(false);
            }}
            theme={theme}
          />
        </View>
        <View style={{ flex: compact ? 0 : 1 }} />
        <ToolButton
          theme={theme}
          icon="refresh"
          label="刷新提交图"
          busy={history.loading || repositories.refreshing}
          onPress={refresh}
        />
        <ToolButton
          theme={theme}
          icon="settings"
          label="Git 设置"
          onPress={() => setShowSettings(true)}
        />
      </View>
      <View
        style={{
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        <InputField
          theme={theme}
          icon="search"
          inputRef={inputRef}
          accessibilityLabel="搜索已加载提交"
          placeholder="在已加载提交中查找消息、作者或 SHA"
          value={filter}
          onChangeText={setFilter}
          autoCapitalize="none"
          autoCorrect={false}
          onNavigateMatch={moveMatch}
        >
          {query ? (
            <>
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: matching.length ? c.foregroundMuted : c.statusWarning,
                  fontSize: 10,
                }}
              >
                {matchIndex < 0 ? 0 : matchIndex + 1}/{matching.length}
              </Text>
              <ToolButton
                theme={theme}
                icon="up"
                label="上一个匹配提交"
                disabled={!matching.length}
                onPress={() => moveMatch(-1)}
              />
              <ToolButton
                theme={theme}
                icon="down"
                label="下一个匹配提交"
                disabled={!matching.length}
                onPress={() => moveMatch(1)}
              />
              <ToolButton
                theme={theme}
                icon="close"
                label="清除提交搜索"
                onPress={() => setFilter("")}
              />
            </>
          ) : !compact ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 10, paddingRight: 6 }}>
              ⌘ / Ctrl + F
            </Text>
          ) : null}
        </InputField>
      </View>
      {repositories.error || history.error ? (
        <View
          accessibilityRole="alert"
          style={{
            flexDirection: "row",
            paddingHorizontal: 12,
            paddingVertical: 6,
            gap: 8,
            alignItems: "center",
            backgroundColor: c.surface1,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <Icon name="warning" color={c.statusWarning} size={14} />
          <Text style={{ flex: 1, color: c.statusWarning, fontSize: 11 }}>
            {history.error ?? repositories.error}
          </Text>
          <ToolButton theme={theme} icon="refresh" label="重试刷新提交图" onPress={refresh} />
        </View>
      ) : null}
      <View
        testID="git-history-body"
        onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}
        style={{ flex: 1, minHeight: 0 }}
      >
        {showGraph ? (
          <View testID="git-commit-list" style={{ flex: 1, minHeight: 0 }}>
            {graph.rows.length ? (
              <ScrollView
                horizontal
                style={{ flex: 1, minHeight: 0 }}
                contentContainerStyle={{ flexGrow: 1 }}
              >
                <View style={{ width: tableWidth, flex: 1, minHeight: 0 }}>
                  <View
                    style={{
                      height: 28,
                      paddingRight: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      borderBottomWidth: 1,
                      borderBottomColor: c.border,
                      backgroundColor: c.surface1,
                    }}
                  >
                    <Text
                      style={{
                        width: graphWidth,
                        paddingLeft: 15,
                        color: c.foregroundMuted,
                        fontSize: 10,
                      }}
                    >
                      提交图
                    </Text>
                    <Text style={{ flex: 1, color: c.foregroundMuted, fontSize: 10 }}>
                      提交信息
                    </Text>
                    {showAuthor ? (
                      <Text style={{ width: 130, color: c.foregroundMuted, fontSize: 10 }}>
                        作者
                      </Text>
                    ) : null}
                    {showDate ? (
                      <Text style={{ width: 100, color: c.foregroundMuted, fontSize: 10 }}>
                        日期
                      </Text>
                    ) : null}
                    <Text style={{ width: 68, color: c.foregroundMuted, fontSize: 10 }}>提交</Text>
                  </View>
                  <FlatList
                    ref={listRef}
                    data={graph.rows}
                    keyExtractor={(row) => row.commit.oid}
                    renderItem={renderRow}
                    extraData={selected}
                    style={{ flex: 1, minHeight: 0 }}
                    initialNumToRender={24}
                    windowSize={7}
                    getItemLayout={(_, index) => ({
                      index,
                      length: COMMIT_ROW_HEIGHT,
                      offset: index * COMMIT_ROW_HEIGHT,
                    })}
                    onScrollToIndexFailed={({ index }) =>
                      listRef.current?.scrollToOffset({
                        offset: index * COMMIT_ROW_HEIGHT,
                        animated: false,
                      })
                    }
                    ListFooterComponent={
                      history.data?.hasMore ? (
                        <View
                          style={{
                            alignItems: "center",
                            padding: 8,
                            borderTopWidth: 1,
                            borderTopColor: c.border,
                          }}
                        >
                          <ToolButton
                            theme={theme}
                            icon="down"
                            label="加载更多提交"
                            text="加载更多提交"
                            busy={history.loadingMore}
                            onPress={() => {
                              void history.loadMore();
                            }}
                          />
                        </View>
                      ) : (
                        <View style={{ padding: 10, alignItems: "center" }}>
                          <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>
                            已显示全部本地历史
                          </Text>
                        </View>
                      )
                    }
                  />
                </View>
              </ScrollView>
            ) : history.loading ? (
              <HistoryNotice theme={theme} busy title="正在读取提交历史…" />
            ) : history.error ? (
              <HistoryNotice
                theme={theme}
                title="无法读取提交历史"
                description={history.error}
                retry={refresh}
              />
            ) : (
              <HistoryNotice
                theme={theme}
                title="此仓库还没有提交"
                description="首次提交后，分支与提交历史会显示在这里。"
              />
            )}
          </View>
        ) : null}
        {showDetails && selected ? (
          <View
            testID="git-commit-details"
            style={{
              ...(compact || expanded
                ? { flex: 1 }
                : {
                    height: bodyHeight
                      ? detailsHeight
                      : `${preferences.values.historyDetailsRatio * 100}%`,
                    flexShrink: 0,
                  }),
              minHeight: 0,
              borderTopWidth: 1,
              borderTopColor: c.border,
              backgroundColor: c.surface0,
            }}
          >
            {!compact && !expanded ? (
              <HistoryResizer
                theme={theme}
                height={detailsHeight}
                min={minDetailsHeight}
                max={maxDetailsHeight}
                onChange={(height) => {
                  if (bodyHeight > 0)
                    preferences.update({ historyDetailsRatio: height / bodyHeight });
                }}
                onCommit={preferences.flush}
                onReset={() => {
                  preferences.update({ historyDetailsRatio: defaultSettings.historyDetailsRatio });
                  preferences.flush();
                }}
              />
            ) : null}
            <View
              style={{
                minHeight: 34,
                paddingHorizontal: 8,
                gap: 7,
                flexDirection: "row",
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: c.border,
                backgroundColor: c.surface1,
              }}
            >
              {compact ? (
                <ToolButton
                  theme={theme}
                  icon="back"
                  label="返回提交图"
                  onPress={() => {
                    setDetailsOpen(false);
                    setExpanded(false);
                    setFile(null);
                  }}
                />
              ) : (
                <Icon name="source" color={c.foregroundMuted} size={14} />
              )}
              <Text style={{ color: c.accent, fontFamily: c.mono, fontSize: 11 }}>
                {selected.slice(0, 8)}
              </Text>
              <Text
                numberOfLines={1}
                style={{ flex: 1, minWidth: 0, color: c.foreground, fontSize: 11 }}
              >
                {selectedCommit?.subject ?? detail.data?.subject ?? "提交详情"}
              </Text>
              <ToolButton
                theme={theme}
                icon="copy"
                label="复制完整提交 SHA"
                onPress={() => {
                  void copyText(selected).then(
                    () => setCopyStatus("已复制提交 SHA"),
                    (error: unknown) =>
                      setCopyStatus(
                        `复制失败：${error instanceof Error ? error.message : String(error)}`,
                      ),
                  );
                }}
              />
              {!compact ? (
                <ToolButton
                  theme={theme}
                  icon={expanded ? "down" : "up"}
                  label={expanded ? "收起提交详情" : "展开提交详情"}
                  onPress={() => setExpanded((value) => !value)}
                />
              ) : null}
              {!compact ? (
                <ToolButton
                  theme={theme}
                  icon="close"
                  label="关闭提交详情"
                  onPress={() => {
                    setDetailsOpen(false);
                    setExpanded(false);
                  }}
                />
              ) : null}
            </View>
            {detail.error ? (
              <HistoryNotice
                theme={theme}
                title="读取提交详情失败"
                description={detail.error}
                retry={detail.retry}
              />
            ) : detail.data ? (
              file ? (
                <CommitDiff
                  key={`${selected}:${file}`}
                  directory={directory}
                  repositoryId={repositoryId}
                  commit={detail.data}
                  path={file}
                  theme={theme}
                  width={size.width}
                  preferences={preferences}
                  onBack={() => setFile(null)}
                />
              ) : (
                <CommitSummary
                  commit={detail.data}
                  theme={theme}
                  compact={compact}
                  onOpenFile={setFile}
                  onSelectParent={(oid) => {
                    selectCommit(oid);
                    scrollTo(graph.rows.findIndex((row) => row.commit.oid === oid));
                  }}
                />
              )
            ) : (
              <HistoryNotice theme={theme} busy title="正在读取提交详情…" />
            )}
          </View>
        ) : null}
      </View>
      <View
        style={{
          minHeight: 27,
          paddingHorizontal: 12,
          gap: 7,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: c.surface1,
          borderTopWidth: 1,
          borderTopColor: c.border,
        }}
      >
        <Icon name="branch" color={c.foregroundMuted} size={12} />
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 10, flexShrink: 1 }}>
          {history.data?.branch ?? history.data?.head?.slice(0, 8) ?? "HEAD"}
        </Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>
          · {graph.rows.length} 次提交{history.data?.hasMore ? "（可继续加载）" : ""}
        </Text>
        <View style={{ flex: 1 }} />
        {copyStatus ? (
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={1}
            style={{ color: c.foregroundMuted, fontSize: 10, flexShrink: 1 }}
          >
            {copyStatus}
          </Text>
        ) : (
          <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>
            {compact ? "只读" : `${refs.filter((ref) => ref.kind !== "tag").length} 个分支 · 只读`}
          </Text>
        )}
      </View>
    </View>
  );
}
