import type { PluginTheme } from "@getpaseo/plugin";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { GitRef } from "../shared/history-contracts";
import { COMMIT_ROW_HEIGHT, CommitGraphRow } from "./commit-graph";
import { InputField, ToolButton } from "./controls";
import { buildCommitGraph, type GraphRow, matchesCommit } from "./graph-model";
import { Icon } from "./icons";
import { defaultBranchReview } from "./review-model";
import { ReviewRangeHandles } from "./review-range";
import type { ReviewBounds } from "./review-range-model";
import { SettingsSelect } from "./settings-select";
import { panelTokens } from "./theme";
import { useChanges } from "./use-changes";
import { useHistory } from "./use-history";
import type { ReviewSelection } from "./use-review";

const NO_REFS: GitRef[] = [];
type Range = { anchor: string; focus: string; working: boolean };

export function HistoryPanel({
  directory,
  name,
  theme,
  reviewSelection,
  onReview,
  collapsed = false,
  onToggleCollapse,
}: {
  directory: string;
  name: string;
  theme: PluginTheme;
  reviewSelection: ReviewSelection | null;
  collapsed?: boolean;
  onToggleCollapse?(): void;
  onReview(selection: ReviewSelection | null, repositoryId: string): void;
}) {
  const c = panelTokens(theme);
  const [width, setWidth] = useState(600);
  const [repositoryId, setRepositoryId] = useState(".");
  const [reference, setReference] = useState("head");
  const [baseRef, setBaseRef] = useState("auto");
  const [defaultRequest, setDefaultRequest] = useState(0);
  const defaultScope = useRef<string | null>(null);
  const automaticRange = useRef(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const query = useDeferredValue(filter.trim());
  const [range, setRange] = useState<Range | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const [handleDraft, setHandleDraft] = useState<ReviewBounds | null>(null);
  const [dragRange, setDragRange] = useState<Range | null>(null);
  const dragging = useRef<Range | null>(null);
  const shifted = useRef(false);
  const list = useRef<FlatList<GraphRow>>(null);
  const repositories = useChanges(directory, "head", false);
  const history = useHistory(directory, repositoryId, reference, reference === "head", baseRef);
  const graph = useMemo(
    () => buildCommitGraph(history.data?.commits ?? []),
    [history.data?.commits],
  );
  const commits = history.data?.commits ?? [];
  const fork = history.data?.fork;
  const scopeKey = JSON.stringify([
    directory,
    repositoryId,
    reference,
    baseRef,
    history.data?.branch,
    defaultRequest,
  ]);
  const branchLast =
    reference === "head" && fork?.commitCount != null ? fork.commitCount : commits.length;
  function commitIndex(oid: string) {
    const index = commits.findIndex((commit) => commit.oid === oid);
    return index < 0 && oid === fork?.oldestOid && fork.commitCount ? fork.commitCount - 1 : index;
  }
  function commitOid(index: number) {
    return commits[index]?.oid ?? (index === branchLast - 1 ? fork?.oldestOid : null);
  }
  const selectableLast =
    reference !== "head" || fork?.message === "当前为基准分支"
      ? commits.length
      : fork?.commitCount != null
        ? Math.min(commits.length, fork.commitCount)
        : 0;
  useEffect(() => {
    if (reference !== "head" || !history.data || !range) return;
    if (
      [range.anchor, range.focus].some((oid) => {
        let index = history.data?.commits.findIndex((commit) => commit.oid === oid) ?? -1;
        if (index < 0 && oid === history.data?.fork?.oldestOid && history.data.fork.commitCount)
          index = history.data.fork.commitCount - 1;
        return index < 0 || index >= branchLast;
      })
    ) {
      setRange(null);
      onReview(null, repositoryId);
    }
  }, [reference, history.data, range, branchLast, onReview, repositoryId]);
  useEffect(() => {
    if (reference !== "head" || !history.data?.fork) return;
    if (defaultScope.current !== scopeKey) {
      defaultScope.current = scopeKey;
      automaticRange.current = true;
    }
    if (!automaticRange.current) return;
    const next = defaultBranchReview(history.data, repositoryId);
    const selected =
      next?.selection.mode === "range"
        ? { anchor: next.selection.newest, focus: next.selection.oldest, working: true }
        : null;
    setRange((previous) =>
      JSON.stringify(previous) === JSON.stringify(selected) ? previous : selected,
    );
    if (JSON.stringify(next) !== JSON.stringify(reviewSelection)) onReview(next, repositoryId);
  }, [reference, history.data, scopeKey, repositoryId, reviewSelection, onReview]);
  useEffect(() => {
    if (
      reference === "head" &&
      automaticRange.current &&
      history.data?.hasMore &&
      history.data.fork?.commitCount != null &&
      history.data.fork.commitCount <= 10000 &&
      history.data.commits.length <= history.data.fork.commitCount
    )
      void history.loadMore();
  }, [reference, history.data, history.loadMore]);
  const graphWidth = Math.max(52, graph.width * 16 + 26);
  function rangeForBounds(bounds: ReviewBounds): Range | null {
    if (bounds.bottom === 0 || bounds.bottom > branchLast) return null;
    const first = commitOid(Math.max(0, bounds.top - 1));
    const last = commitOid(bounds.bottom - 1);
    if (!first || !last) return null;
    return { anchor: first, focus: last, working: bounds.top === 0 };
  }
  const activeRange = handleDraft ? rangeForBounds(handleDraft) : (dragRange ?? range);
  const indices = activeRange ? [activeRange.anchor, activeRange.focus].map(commitIndex) : [];
  const low = Math.min(...indices);
  const high = Math.max(...indices);
  const refsByOid = useMemo(() => {
    const map = new Map<string, GitRef[]>();
    for (const ref of history.data?.refs ?? [])
      map.set(ref.oid, [...(map.get(ref.oid) ?? []), ref]);
    return map;
  }, [history.data?.refs]);
  const repo = repositories.data?.repositories.find((item) => item.id === repositoryId);
  const workingSelected = handleDraft
    ? handleDraft.top === 0
    : !reviewSelection || Boolean(activeRange?.working);
  const reviewBounds =
    handleDraft ??
    (!reviewSelection
      ? { top: 0, bottom: 0 }
      : low >= 0
        ? { top: activeRange?.working ? 0 : low + 1, bottom: high + 1 }
        : null);
  function apply(next: Range) {
    const a = commitIndex(next.anchor);
    const b = commitIndex(next.focus);
    if (a < 0 || b < 0 || a >= branchLast || b >= branchLast) return;
    automaticRange.current = false;
    defaultScope.current = scopeKey;
    setRange(next);
    onReview(
      {
        repositoryId,
        selection: {
          mode: "range",
          oldest: commitOid(Math.max(a, b)) ?? next.focus,
          newest: next.working
            ? (history.data?.head ?? commits[0].oid)
            : (commitOid(Math.min(a, b)) ?? next.anchor),
          workingTree: next.working,
        },
      },
      repositoryId,
    );
  }
  function select(oid: string, extend = false) {
    const next = {
      anchor: extend && range ? range.anchor : oid,
      focus: oid,
      working: extend && range ? range.working : false,
    };
    apply(next);
  }
  function selectWorking() {
    automaticRange.current = false;
    defaultScope.current = scopeKey;
    setRange(null);
    onReview(null, repositoryId);
  }
  function scope(value: string) {
    if (value === "head" && reference === "head") setDefaultRequest((value) => value + 1);
    defaultScope.current = null;
    automaticRange.current = true;
    setReference(value);
    setHandleDraft(null);
    dragging.current = null;
    setDragRange(null);
    // Endpoints are object IDs, so changing scope does not change the review.
  }
  function refresh() {
    history.refresh();
    repositories.refresh();
  }
  function keyDown(event: {
    key: string;
    shiftKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    stopPropagation(): void;
    target?: { tagName?: string; closest?(selector: string): unknown };
    preventDefault(): void;
  }) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !collapsed) {
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(true);
      return;
    }
    if (event.key === "Escape") {
      if (!searchOpen && !optionsOpen) return;
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(false);
      setOptionsOpen(false);
      setFilter("");
      return;
    }
    if (event.target?.closest?.('[role="slider"]')) return;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName ?? "")) return;
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !selectableLast) return;
    event.preventDefault();
    const current = commits.findIndex((commit) => commit.oid === range?.focus);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? selectableLast - 1
          : Math.max(
              0,
              Math.min(selectableLast - 1, current + (event.key === "ArrowDown" ? 1 : -1)),
            );
    select(commits[index].oid, Boolean(event.shiftKey));
    list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
  }
  return (
    <View
      testID="git-history-panel"
      style={{ flex: 1, minHeight: 0, minWidth: 0, backgroundColor: c.surface0 }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      {...(Platform.OS === "web" ? { onKeyDownCapture: keyDown } : {})}
    >
      <View
        style={{
          height: 34,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 6,
          borderBottomWidth: 1,
          borderColor: c.border,
        }}
      >
        {onToggleCollapse ? (
          <ToolButton
            theme={theme}
            icon={collapsed ? "chevronRight" : "chevronDown"}
            label={collapsed ? "展开提交图" : "收起提交图"}
            onPress={onToggleCollapse}
          />
        ) : (
          <Icon name="branch" size={15} color={c.accent} />
        )}
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: c.foreground, fontSize: 12 }}>
          {reference === "head"
            ? (history.data?.branch ?? "当前分支")
            : reference === "all"
              ? "所有分支"
              : (history.data?.refs.find((ref) => ref.fullName === reference)?.name ?? reference)}
        </Text>
        {!collapsed ? (
          <ToolButton
            theme={theme}
            icon="search"
            label="搜索提交"
            active={searchOpen}
            onPress={() => {
              setSearchOpen((value) => !value);
              setFilter("");
            }}
          />
        ) : null}
        <ToolButton
          theme={theme}
          icon="settings"
          label="提交图选项"
          active={optionsOpen}
          onPress={() => setOptionsOpen(true)}
        />
      </View>
      {optionsOpen ? (
        <Modal transparent animationType="none" onRequestClose={() => setOptionsOpen(false)}>
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <Pressable
              accessibilityLabel="关闭提交图选项"
              onPress={() => setOptionsOpen(false)}
              style={{ position: "absolute", inset: 0, backgroundColor: "#00000033" }}
            />
            <View
              accessibilityLabel="提交图选项"
              style={{
                width: 360,
                maxWidth: "92%",
                maxHeight: "80%",
                padding: 12,
                gap: 10,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 6,
                backgroundColor: c.surface1,
              }}
              {...(Platform.OS === "web"
                ? {
                    onKeyDown: (event: { key: string; stopPropagation(): void }) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setOptionsOpen(false);
                      }
                    },
                  }
                : {})}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ flex: 1, color: c.foreground, fontSize: 12 }}>提交图选项</Text>
                <ToolButton
                  theme={theme}
                  icon="refresh"
                  label="刷新提交图"
                  busy={history.loading}
                  onPress={refresh}
                />
                <ToolButton
                  theme={theme}
                  icon="close"
                  label="关闭选项"
                  onPress={() => setOptionsOpen(false)}
                />
              </View>
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <SettingsSelect
                    theme={theme}
                    label="提交图仓库"
                    value={repositoryId}
                    options={(repositories.data?.repositories ?? []).map((item) => ({
                      value: item.id,
                      label: item.id === "." ? name : item.relativePath,
                    }))}
                    onChange={(id) => {
                      setRepositoryId(id);
                      setRange(null);
                      setDragRange(null);
                      dragging.current = null;
                      onReview(null, id);
                    }}
                  />
                </View>
                <SettingsSelect
                  theme={theme}
                  label="提交图分支范围"
                  value={reference}
                  options={[
                    { value: "all", label: "所有分支" },
                    { value: "head", label: history.data?.branch ?? "HEAD" },
                    ...(history.data?.refs ?? []).map((ref) => ({
                      value: ref.fullName,
                      label: ref.name,
                    })),
                  ]}
                  onChange={scope}
                />
                {reference === "head" ? (
                  <View style={{ paddingHorizontal: 6, paddingBottom: 6, gap: 4 }}>
                    <SettingsSelect
                      theme={theme}
                      label="分叉基准分支"
                      value={baseRef}
                      onChange={(value) => {
                        defaultScope.current = null;
                        automaticRange.current = true;
                        setBaseRef(value);
                      }}
                      options={[
                        { value: "auto", label: "基准：自动 · 默认主分支" },
                        ...(history.data?.refs ?? [])
                          .filter((ref) => ref.kind !== "tag" && !ref.current)
                          .map((ref) => ({ value: ref.fullName, label: `基准：${ref.name}` })),
                      ]}
                    />
                    <Text numberOfLines={2} style={{ fontSize: 10, color: c.foregroundMuted }}>
                      {fork?.oid
                        ? `分叉点 ${fork.oid.slice(0, 8)} · ${fork.baseRef.replace(/^refs\/(heads|remotes)\//, "")} · ${fork.commitCount} 个分支提交`
                        : (fork?.message ?? "正在定位分叉点…")}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
      <View style={{ flex: 1, minHeight: 0, display: collapsed ? "none" : "flex" }}>
        {searchOpen ? (
          <View style={{ padding: 6 }}>
            <InputField
              theme={theme}
              icon="search"
              accessibilityLabel="搜索已加载提交"
              placeholder="搜索提交、作者、SHA"
              value={filter}
              onChangeText={setFilter}
              autoFocus
            >
              <ToolButton
                theme={theme}
                icon="close"
                label="关闭提交搜索"
                onPress={() => {
                  setSearchOpen(false);
                  setFilter("");
                }}
              />
            </InputField>
          </View>
        ) : null}
        <View
          style={{
            height: 28,
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: c.surface1,
            borderBottomWidth: 1,
            borderColor: c.border,
          }}
        >
          <Text
            style={{ width: graphWidth, paddingLeft: 12, color: c.foregroundMuted, fontSize: 10 }}
          >
            GRAPH
          </Text>
          <Text style={{ flex: 1, color: c.foregroundMuted, fontSize: 10 }}>提交消息</Text>
          {width > 800 ? (
            <Text style={{ width: 130, color: c.foregroundMuted, fontSize: 10 }}>作者</Text>
          ) : null}
          <Text style={{ width: 68, color: c.foregroundMuted, fontSize: 10 }}>提交</Text>
        </View>

        {history.error ? (
          <View accessibilityRole="alert" style={{ padding: 10 }}>
            <Text style={{ color: c.statusDanger }}>{history.error}</Text>
            <ToolButton theme={theme} text="重试" label="重试提交图" onPress={refresh} />
          </View>
        ) : null}
        <View
          style={{ flex: 1, minHeight: 0 }}
          onLayout={(event) => setListHeight(event.nativeEvent.layout.height)}
        >
          <ScrollView
            horizontal
            style={{ flex: 1, minHeight: 0 }}
            contentContainerStyle={{ minWidth: width, flex: 1 }}
          >
            <FlatList
              ref={list}
              testID="git-commit-list"
              style={{ flex: 1, minHeight: 0 }}
              data={graph.rows}
              ListHeaderComponent={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Review 未提交改动"
                  accessibilityState={{ selected: workingSelected }}
                  onPress={selectWorking}
                  {...(Platform.OS === "web"
                    ? {
                        onPointerDown: () => {
                          const head = history.data?.head;
                          if (head) {
                            dragging.current = { anchor: head, focus: head, working: true };
                          }
                        },
                      }
                    : {})}
                  style={{
                    height: COMMIT_ROW_HEIGHT,
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: workingSelected ? c.selection : c.surface0,
                    borderBottomWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <View style={{ width: graphWidth, alignItems: "center" }}>
                    <Icon name="source" color={c.accent} size={15} />
                  </View>
                  <Text
                    style={{
                      color: c.foreground,
                      fontStyle: "italic",
                      fontWeight: "600",
                      fontSize: 12,
                    }}
                  >
                    Working Changes
                  </Text>
                  <Text style={{ color: c.foregroundMuted, fontSize: 11, paddingLeft: 8 }}>
                    {repo?.files.length ?? 0} 个文件 · {history.data?.branch ?? "HEAD"}
                  </Text>
                </Pressable>
              }
              onScroll={(event) => setScrollOffset(event.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              onEndReached={() => {
                if (history.data?.hasMore) void history.loadMore();
              }}
              onEndReachedThreshold={0.3}
              keyExtractor={(row) => row.commit.oid}
              extraData={[reviewSelection, dragRange, range, query]}
              getItemLayout={(_, index) => ({
                index,
                length: COMMIT_ROW_HEIGHT,
                offset: (index + 1) * COMMIT_ROW_HEIGHT,
              })}
              onScrollToIndexFailed={({ index }) =>
                list.current?.scrollToOffset({ offset: index * COMMIT_ROW_HEIGHT, animated: false })
              }
              renderItem={({ item, index }) => (
                <View
                  style={{
                    opacity: index >= selectableLast && item.commit.oid !== fork?.oid ? 0.4 : 1,
                  }}
                  {...(Platform.OS === "web"
                    ? {
                        onPointerDown: (event) => {
                          if (index >= selectableLast) {
                            dragging.current = null;
                            return;
                          }
                          shifted.current = event.nativeEvent.shiftKey;
                          dragging.current = {
                            anchor: shifted.current && range ? range.anchor : item.commit.oid,
                            focus: item.commit.oid,
                            working: shifted.current && range ? range.working : false,
                          };
                        },
                        onPointerEnter: (event) => {
                          if (!dragging.current || !event.nativeEvent.buttons) return;
                          dragging.current = {
                            ...dragging.current,
                            focus:
                              commits[Math.min(index, selectableLast - 1)]?.oid ??
                              dragging.current.focus,
                          };
                          setDragRange(dragging.current);
                        },
                        onPointerUp: () => {
                          const next = dragging.current;
                          dragging.current = null;
                          setDragRange(null);
                          if (next) apply(next);
                        },
                        onPointerCancel: () => {
                          dragging.current = null;
                          setDragRange(null);
                        },
                      }
                    : {})}
                >
                  <CommitGraphRow
                    row={item}
                    disabled={index >= selectableLast}
                    graphWidth={graphWidth}
                    theme={theme}
                    references={refsByOid.get(item.commit.oid) ?? NO_REFS}
                    head={history.data?.head === item.commit.oid}
                    active={Boolean(
                      reviewSelection && activeRange && low >= 0 && index >= low && index <= high,
                    )}
                    matched={matchesCommit(item.commit, query)}
                    showAuthor={width > 800}
                    showDate={width > 1000}
                    onSelect={Platform.OS === "web" ? () => {} : (oid) => select(oid)}
                  />
                  {reference === "head" && item.commit.oid === fork?.oid ? (
                    <View
                      pointerEvents="none"
                      testID="git-branch-fork"
                      style={{
                        position: "absolute",
                        right: 4,
                        top: 5,
                        paddingHorizontal: 6,
                        paddingVertical: 3,
                        borderRadius: 3,
                        backgroundColor: c.surface2,
                      }}
                    >
                      <Text style={{ color: c.accent, fontSize: 10 }}>
                        分叉起点 · 不计入 Review
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
              ListEmptyComponent={
                <Text style={{ color: c.foregroundMuted, padding: 12 }}>
                  {history.loading ? "正在读取提交…" : "没有提交"}
                </Text>
              }
              ListFooterComponent={
                history.data?.hasMore ? (
                  <ToolButton
                    theme={theme}
                    icon="down"
                    text="加载更多提交"
                    label="加载更多提交"
                    busy={history.loadingMore}
                    onPress={() => void history.loadMore()}
                  />
                ) : null
              }
            />
          </ScrollView>
          {reviewBounds && listHeight > 0 ? (
            <ReviewRangeHandles
              bounds={reviewBounds}
              last={selectableLast}
              offset={scrollOffset}
              height={listHeight}
              theme={theme}
              onScroll={(offset) => {
                setScrollOffset(offset);
                list.current?.scrollToOffset({ offset, animated: false });
              }}
              onChange={setHandleDraft}
              onCommit={(bounds) => {
                const next = rangeForBounds(bounds);
                setHandleDraft(null);
                if (next) apply(next);
                else selectWorking();
              }}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}
