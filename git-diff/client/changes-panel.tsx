import type { PluginTheme } from "@getpaseo/plugin";
import {
  openExternalUrl,
  type PluginWorkspacePanelProps,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import {
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from "react-native";
import {
  type FileChange,
  fileCapabilitiesRpc,
  resolveLinkRpc,
  revealFileRpc,
} from "../shared/contracts";
import { parsePreviewLink } from "../shared/preview-links";
import type { TabStats } from "../shared/tab-cache";
import {
  buildChangeRows,
  type ChangeRow,
  comparisons,
  entryKey,
  statusLabels,
} from "./changes-model";
import { ComparisonPicker } from "./comparison-picker";
import { InputField, setWebTitle, ToolButton } from "./controls";
import { type CloseTabs, closeTabs, openTab, type TabsState } from "./editor-model";
import { EditorTabs } from "./editor-tabs";
import { FileMenu, type FileMenuItem, type FileMenuTarget } from "./file-menu";
import { filePaths } from "./file-paths";
import { HistoryPanel } from "./history-panel";
import { fileAppearance, Icon } from "./icons";
import { previewKind } from "./preview-model";
import { reviewFileKey } from "./review-model";
import { SettingsPanel } from "./settings-panel";
import { TabCache } from "./tab-cache";
import { TabEditor } from "./tab-editor";
import { panelTokens } from "./theme";
import { useChanges } from "./use-changes";
import { usePanelSettings } from "./use-panel-settings";
import { type ReviewSelection, useReview } from "./use-review";
import { ViewSwitcher, type WorkspaceView } from "./view-switcher";
import { ScrollbarStyle, SidebarResizer } from "./web-chrome";

function displayPath(path: string) {
  return path.replace(/\n/g, "↵").replace(/\t/g, "⇥").replace(/\r/g, "␍");
}
function basename(path: string) {
  return displayPath(path.split("/").at(-1) || path);
}
function statusColor(file: FileChange, theme: PluginTheme) {
  return file.status === "conflicted" || file.status === "deleted"
    ? theme.colors.statusDanger
    : file.status === "added" || file.status === "untracked"
      ? theme.colors.statusSuccess
      : theme.colors.statusWarning;
}

export function ChangesPanel(props: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(props.workspaceId, ({ directory, name }) => ({ directory, name }));
  if (!workspace)
    return (
      <View style={{ padding: 20 }}>
        <Text style={{ color: props.theme.colors.foregroundMuted }}>工作区不可用。</Text>
      </View>
    );
  return (
    <WorkspaceChanges
      key={workspace.directory}
      directory={workspace.directory}
      name={workspace.name}
      theme={props.theme}
      compact={props.layout.compact}
    />
  );
}

type Styles = ReturnType<typeof makeStyles>;
const INITIAL_HUNK_NAVIGATION = { index: 0, request: 0 };
const ChangeItem = memo(function ChangeItem({
  item,
  styles,
  theme,
  name,
  tree,
  compact,
  active,
  collapsed,
  onToggle,
  onSelect,
  onRegister,
  onFocusFile,
  onContextMenu,
  reviewed = false,
}: {
  reviewed?: boolean;
  item: ChangeRow;
  styles: Styles;
  theme: PluginTheme;
  name: string;
  tree: boolean;
  compact: boolean;
  active: boolean;
  collapsed: boolean;
  onToggle(key: string): void;
  onSelect(repositoryId: string, path: string): void;
  onRegister(key: string, node: View | null): void;
  onFocusFile(key: string): void;
  onContextMenu(target: FileMenuTarget): void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const { repository } = item;
  const rowFeedback = [
    hovered && styles.hoveredRow,
    active && styles.selectedRow,
    focused && styles.focusedRow,
  ];
  if (item.kind === "notice")
    return (
      <View style={styles.notice}>
        <Icon
          name={repository.state === "ready" ? "check" : "warning"}
          size={14}
          color={
            repository.state === "ready" ? theme.colors.foregroundMuted : theme.colors.statusWarning
          }
        />
        <Text style={[styles.small, repository.state !== "ready" && styles.warning]}>
          {repository.state === "uninitialized"
            ? "子模块未初始化"
            : repository.state === "error"
              ? repository.error
              : "此视图没有更改"}
        </Text>
      </View>
    );
  if (item.kind === "repository") {
    const drift = Boolean(
      repository.recordedHead &&
        repository.recordedHead !== repository.head &&
        repository.state === "ready",
    );
    const label = repository.id === "." ? name : basename(repository.relativePath);
    return (
      <Pressable
        ref={(node) =>
          setWebTitle(node, `${repository.directory}\nHEAD ${repository.head ?? "尚无提交"}`)
        }
        accessibilityRole="button"
        accessibilityLabel={`${collapsed ? "展开" : "收起"}仓库 ${repository.relativePath || name}`}
        accessibilityState={{ expanded: !collapsed }}
        {...(Platform.OS === "web"
          ? {
              title: `${repository.directory}\nHEAD ${repository.head ?? "尚无提交"}${drift ? `\n父仓记录 ${repository.recordedHead} → 当前 ${repository.head}` : ""}`,
              "aria-expanded": !collapsed,
            }
          : {})}
        onPress={() => onToggle(item.key)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.repository, ...rowFeedback]}
      >
        <Icon
          name={collapsed ? "chevronRight" : "chevronDown"}
          size={12}
          color={theme.colors.foregroundMuted}
        />
        <Icon name="repository" color={theme.colors.foregroundMuted} />
        <View style={[styles.fileName, styles.inline]}>
          <Text numberOfLines={1} style={[styles.repositoryTitle, { flexShrink: 1 }]}>
            {label}
          </Text>
          <View style={styles.branchLine}>
            <Icon name="branch" size={11} color={theme.colors.foregroundMuted} />
            <Text numberOfLines={1} style={styles.small}>
              {repository.branch ?? (repository.head ? repository.head.slice(0, 8) : "尚无提交")}
              {repository.parentId !== null ? " · 子模块" : ""}
            </Text>
          </View>
        </View>
        {drift ? (
          <View accessibilityLabel="子模块提交指针已变化" style={styles.pointerBadge}>
            <Icon name="pointer" size={12} color={theme.colors.statusWarning} />
          </View>
        ) : null}
        <Text style={styles.count}>{item.count}</Text>
      </Pressable>
    );
  }
  if (item.kind === "folder")
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${collapsed ? "展开" : "收起"}目录 ${displayPath(item.path)}`}
        accessibilityState={{ expanded: !collapsed }}
        {...(Platform.OS === "web" ? { "aria-expanded": !collapsed } : {})}
        onPress={() => onToggle(item.key)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.file,
          compact && styles.touchRow,
          { paddingLeft: 10 + Math.min(item.depth, 6) * 14 },
          ...rowFeedback,
        ]}
      >
        <Icon
          name={collapsed ? "chevronRight" : "chevronDown"}
          size={12}
          color={theme.colors.foregroundMuted}
        />
        <Icon name="folder" color={theme.colors.foregroundMuted} />
        <Text numberOfLines={1} style={[styles.fileText, styles.fileName]}>
          {displayPath(item.label)}
        </Text>
        <Text style={styles.small}>{item.count}</Text>
      </Pressable>
    );
  if (item.kind !== "file") return null;
  const { file } = item;
  const appearance = fileAppearance(file.path, theme.colors.foregroundMuted);
  const parent = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  const status = statusLabels[file.status];
  const label = `${status.label} ${repository.id}/${file.path}${file.oldPath ? `，原路径 ${file.oldPath}` : ""}，${file.binary ? "二进制文件" : `新增 ${file.additions ?? "未知"} 行，删除 ${file.deletions ?? "未知"} 行`}${file.staged && file.unstaged ? "，同时有已暂存和未暂存更改" : ""}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看 diff ${label}`}
      ref={(node) => {
        onRegister(item.key, node);
        setWebTitle(node, label);
      }}
      accessibilityState={Platform.OS !== "web" ? { selected: active } : {}}
      {...(Platform.OS === "web"
        ? { title: label, "aria-current": active ? "true" : undefined }
        : {})}
      onPress={() => onSelect(repository.id, file.path)}
      onLongPress={(event) =>
        onContextMenu({
          repositoryId: repository.id,
          path: file.path,
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
        })
      }
      {...(Platform.OS === "web"
        ? {
            onContextMenu: (event: {
              clientX: number;
              clientY: number;
              preventDefault(): void;
            }) => {
              event.preventDefault();
              onContextMenu({
                repositoryId: repository.id,
                path: file.path,
                x: event.clientX,
                y: event.clientY,
              });
            },
          }
        : {})}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => {
        setFocused(true);
        onFocusFile(item.key);
      }}
      onBlur={() => setFocused(false)}
      style={[
        styles.file,
        compact && styles.touchRow,
        { paddingLeft: tree ? 25 + Math.min(item.depth, 6) * 14 : 24 },
        ...rowFeedback,
      ]}
    >
      <Icon name={appearance.icon} color={appearance.color} />
      <Text
        numberOfLines={1}
        style={[
          styles.fileText,
          file.status === "deleted" && styles.deletedName,
          tree && styles.fileName,
        ]}
      >
        {basename(file.path)}
      </Text>
      {!tree ? (
        <Text numberOfLines={1} style={[styles.small, styles.fileName]}>
          {displayPath(parent)}
        </Text>
      ) : null}
      {reviewed ? (
        <View accessibilityLabel="已阅">
          <Icon name="check" size={12} color={theme.colors.statusSuccess} />
        </View>
      ) : null}
      {file.staged && file.unstaged ? (
        <View accessibilityLabel="部分暂存" style={styles.partialMarker} />
      ) : null}
      <Text style={[styles.fileStatus, { color: statusColor(file, theme) }]}>{status.badge}</Text>
    </Pressable>
  );
});

export function WorkspaceChanges(props: {
  directory: string;
  name: string;
  theme: PluginTheme;
  compact: boolean;
}) {
  const preferences = usePanelSettings();
  const [view, setView] = useState<WorkspaceView>("changes");
  const [historyOpened, setHistoryOpened] = useState(false);
  const changesButton = useRef<View>(null);
  const historyButton = useRef<View>(null);
  useEffect(() => {
    if (!historyOpened) return;
    // Wait for the closing modal to release focus before focusing the visible view.
    const timer = setTimeout(
      () => (view === "changes" ? changesButton : historyButton).current?.focus(),
      0,
    );
    return () => clearTimeout(timer);
  }, [view, historyOpened]);
  function switchView(next: WorkspaceView) {
    if (next === "history") setHistoryOpened(true);
    setView(next);
  }
  if (!preferences.loaded)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: props.theme.colors.surface0,
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        {preferences.error ? (
          <>
            <Text style={{ color: props.theme.colors.statusDanger }}>{preferences.error}</Text>
            <ToolButton
              theme={props.theme}
              label="重试加载设置"
              icon="refresh"
              text="重试"
              onPress={preferences.retry}
            />
          </>
        ) : (
          <ActivityIndicator color={props.theme.colors.accent} />
        )}
      </View>
    );
  const c = panelTokens(props.theme);
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: c.surface0 }}>
      <View style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        <WorkspacePane active={view === "changes"}>
          <WorkspaceEditor
            {...props}
            preferences={preferences}
            active={view === "changes"}
            viewSwitcher={
              <ViewSwitcher
                value="changes"
                onChange={switchView}
                buttonRef={changesButton}
                theme={props.theme}
              />
            }
          />
        </WorkspacePane>
        {historyOpened ? (
          <WorkspacePane active={view === "history"}>
            <HistoryPanel
              {...props}
              preferences={preferences}
              viewSwitcher={
                <ViewSwitcher
                  value="history"
                  onChange={switchView}
                  buttonRef={historyButton}
                  theme={props.theme}
                />
              }
            />
          </WorkspacePane>
        ) : null}
      </View>
    </View>
  );
}

function WorkspacePane({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <View
      ref={(node) => {
        if (Platform.OS !== "web" || !node) return;
        const element = node as unknown as { style: { visibility: string }; inert: boolean };
        element.style.visibility = active ? "visible" : "hidden";
        element.inert = !active;
      }}
      pointerEvents={active ? "auto" : "none"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      {...(Platform.OS === "web" ? { "aria-hidden": !active } : {})}
      style={{ position: "absolute", inset: 0, minWidth: 0, minHeight: 0, opacity: active ? 1 : 0 }}
    >
      {children}
    </View>
  );
}

function WorkspaceEditor({
  directory,
  name,
  theme,
  compact: hostCompact,
  preferences,
  active,
  viewSwitcher,
}: {
  directory: string;
  name: string;
  theme: PluginTheme;
  compact: boolean;
  preferences: ReturnType<typeof usePanelSettings>;
  active: boolean;
  viewSwitcher: ReactNode;
}) {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const colors = useMemo(() => panelTokens(theme), [theme]);
  const [width, setWidth] = useState<number | null>(null);
  const compact = hostCompact || (width !== null && width < 720);
  const [page, setPage] = useState<"changes" | "diff">("changes");
  const { values: settings, update: updateSettings } = preferences;
  const { tree, automatic, mode, context, ignoreWhitespace } = settings;
  const [review, setReview] = useState<ReviewSelection | null>(null);
  const [showComparisonPicker, setShowComparisonPicker] = useState(false);
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  const comparison = review ? "head" : settings.comparison;
  const [filter, setFilter] = useState("");
  const query = useDeferredValue(filter.trim().toLocaleLowerCase());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [tabs, setTabs] = useState<TabsState>({ tabs: [], active: null });
  const [linkedFiles, setLinkedFiles] = useState<
    Record<string, { repositoryId: string; path: string; version: string }>
  >({});
  const [previewNavigation, setPreviewNavigation] = useState<{
    key: string;
    fragment: string;
    request: number;
  } | null>(null);
  const navigationRequest = useRef(0);
  const [focusedFile, setFocusedFile] = useState<string | null>(null);
  const initialized = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [previews, setPreviews] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<FileMenuTarget | null>(null);
  const [fileAction, setFileAction] = useState<string | null>(null);
  const getCapabilities = useRpc(fileCapabilitiesRpc);
  const revealFile = useRpc(revealFileRpc);
  const resolveLink = useRpc(resolveLinkRpc);
  const [capabilities, setCapabilities] = useState({
    reveal: false,
    label: "在文件管理器中显示",
    platform: "",
  });
  useEffect(() => {
    let stopped = false;
    void getCapabilities({}).then(
      (data) => {
        if (!stopped) setCapabilities(data);
      },
      () => {},
    );
    return () => {
      stopped = true;
    };
  }, [getCapabilities]);
  const [editorStats, setEditorStats] = useState<Record<string, TabStats>>({});
  const [hunkPositions, setHunkPositions] = useState<
    Record<string, { view: string; index: number; request: number }>
  >({});
  const recordStats = useCallback((key: string, stats: TabStats) => {
    setEditorStats((previous) =>
      previous[key]?.bytes === stats.bytes &&
      previous[key]?.hunks === stats.hunks &&
      previous[key]?.view === stats.view
        ? previous
        : { ...previous, [key]: stats },
    );
  }, []);
  const panelRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<ChangeRow>>(null);
  const rowRefs = useRef(new Map<string, View>());
  const pendingFocus = useRef<string | null>(null);
  const focusFilterOnMount = useRef(false);
  useEffect(() => {
    if (page === "changes" && (compact || settings.sidebarVisible) && focusFilterOnMount.current) {
      focusFilterOnMount.current = false;
      inputRef.current?.focus();
    }
  }, [page, compact, settings.sidebarVisible]);
  const registerRow = useCallback((key: string, node: View | null) => {
    if (!node) {
      rowRefs.current.delete(key);
      return;
    }
    rowRefs.current.set(key, node);
    if (pendingFocus.current === key) {
      pendingFocus.current = null;
      node.focus();
    }
  }, []);
  const localChanges = useChanges(
    directory,
    settings.comparison,
    automatic && active && !review,
    settings.refreshInterval,
  );
  const reviewState = useReview(directory, review, localChanges.data);
  const reviewResult = reviewState.result;
  const changes = review
    ? {
        ...reviewState.changes,
        loading: reviewState.changes.loading || localChanges.loading,
        error: reviewState.changes.error ?? localChanges.error,
        refresh: () => {
          localChanges.refresh();
          reviewState.changes.refresh();
        },
      }
    : localChanges;
  const repositories = changes.data?.repositories;
  const model = useMemo(() => {
    const repos = repositories ?? [];
    const entries = repos.flatMap((repository) =>
      repository.files.map((file) => ({ repository, file })),
    );
    const filtered = query
      ? entries.filter(({ repository, file }) =>
          `${repository.relativePath}/${file.path}\n${file.oldPath ?? ""}`
            .toLocaleLowerCase()
            .includes(query),
        )
      : entries;
    return {
      entries,
      filtered,
      lookup: new Map(
        entries.map((entry) => [entryKey(entry.repository.id, entry.file.path), entry]),
      ),
      totals: entries.reduce(
        (total, { file }) => ({
          additions: total.additions + (file.additions ?? 0),
          deletions: total.deletions + (file.deletions ?? 0),
          incomplete: total.incomplete || file.additions === null,
        }),
        { additions: 0, deletions: 0, incomplete: false },
      ),
      rows: buildChangeRows(repos, query, tree, collapsed),
    };
  }, [repositories, query, tree, collapsed]);
  const repositoryHeaders = useMemo(
    () => model.rows.flatMap((row, index) => (row.kind === "repository" ? [index] : [])),
    [model.rows],
  );
  const selectedKey = tabs.active;
  const linked = !review && selectedKey ? linkedFiles[selectedKey] : undefined;
  const linkedPath = linked?.path;
  const linkedId = linked?.repositoryId;
  useEffect(() => {
    if (!selectedKey || !linkedPath || !linkedId) return;
    let stopped = false;
    void resolveLink({
      directory,
      repositoryId: linkedId,
      path: linkedPath,
      href: `./${encodeURIComponent(linkedPath.split("/").at(-1) ?? "")}`,
    }).then(
      (target) => {
        if (stopped) return;
        setLinkedFiles((previous) =>
          previous[selectedKey] && previous[selectedKey].version !== target.version
            ? { ...previous, [selectedKey]: target }
            : previous,
        );
      },
      (error: unknown) => {
        if (!stopped)
          setFileAction(
            `无法检查文件最新状态：${error instanceof Error ? error.message : String(error)}`,
          );
      },
    );
    return () => {
      stopped = true;
    };
  }, [directory, selectedKey, linkedPath, linkedId, resolveLink]);
  const linkedRepository = linked
    ? repositories?.find((repo) => repo.id === linked.repositoryId)
    : undefined;
  const selected =
    (selectedKey ? model.lookup.get(selectedKey) : undefined) ??
    (linked && linkedRepository
      ? {
          repository: linkedRepository,
          file: { path: linked.path, version: linked.version, oldPath: undefined },
        }
      : undefined);
  const currentTab = tabs.tabs.find((tab) => tab.key === tabs.active);
  const kind =
    !review && selected ? (previewKind(selected.file.path) ?? (linked ? "code" : null)) : null;
  const preview = Boolean(
    kind && selectedKey && (linked || (previews[selectedKey] ?? settings.previewDefault)),
  );
  useEffect(() => {
    if (!initialized.current && model.entries.length) {
      initialized.current = true;
      setTabs((state) => openTab(state, model.entries[0]));
    }
  }, [model.entries]);
  const baseline = reviewResult
    ? {
        from: reviewResult.baseOid?.slice(0, 8) ?? "空树",
        to: reviewResult.targetOid.slice(0, 8),
        group: reviewResult.title,
      }
    : (comparisons.find((item) => item.value === comparison) ?? comparisons[0]);
  const selectedReviewKey =
    reviewResult && selected
      ? reviewFileKey(selected.repository.id, reviewResult.revision, selected.file.path)
      : null;
  const reviewedCount = reviewResult
    ? model.entries.filter(({ repository, file }) =>
        reviewed.has(reviewFileKey(repository.id, reviewResult.revision, file.path)),
      ).length
    : 0;
  const effectiveMode =
    compact ||
    (width !== null && width - (settings.sidebarVisible ? settings.sidebarWidth : 0) < 650)
      ? mode === "split"
        ? "unified"
        : mode
      : mode;
  const viewKey = JSON.stringify([selected?.file.version, comparison, context, ignoreWhitespace]);
  const currentStats = selectedKey ? editorStats[selectedKey] : undefined;
  const hunkCount = currentStats?.view === viewKey ? currentStats.hunks : 0;
  const position = selectedKey ? hunkPositions[selectedKey] : undefined;
  const hunkIndex = Math.min(
    position?.view === viewKey ? position.index : 0,
    Math.max(0, hunkCount - 1),
  );
  const hunkRequest = position?.request ?? 0;
  const hunkTarget = position?.view === viewKey ? position : INITIAL_HUNK_NAVIGATION;
  const visibleFiles = useMemo(() => model.rows.filter((row) => row.kind === "file"), [model.rows]);
  const fileIndex = visibleFiles.findIndex((row) => row.key === (focusedFile ?? selectedKey));
  const toggle = useCallback(
    (key: string) =>
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  const selectFile = useCallback(
    (repositoryId: string, path: string) => {
      const entry = model.lookup.get(entryKey(repositoryId, path));
      if (!entry) return;
      navigationRequest.current++;
      setPreviewNavigation(null);
      setLinkedFiles((previous) => {
        if (!previous[entryKey(repositoryId, path)]) return previous;
        const next = { ...previous };
        delete next[entryKey(repositoryId, path)];
        return next;
      });
      setTabs((state) => openTab(state, entry));
      setFocusedFile(entryKey(repositoryId, path));
      setPage("diff");
    },
    [model.lookup],
  );
  function moveFile(delta: number) {
    const next = visibleFiles[Math.max(0, Math.min(visibleFiles.length - 1, fileIndex + delta))];
    if (next?.kind !== "file") return;
    selectFile(next.repository.id, next.file.path);
    pendingFocus.current = next.key;
    listRef.current?.scrollToIndex({
      index: model.rows.indexOf(next),
      animated: false,
      viewPosition: 0.5,
    });
    const node = rowRefs.current.get(next.key);
    if (node) {
      pendingFocus.current = null;
      node.focus();
    }
  }
  function moveSearchMatch(delta: -1 | 1) {
    if (!visibleFiles.length) return;
    const index = visibleFiles.findIndex((row) => row.key === selectedKey);
    const nextIndex =
      index < 0
        ? delta > 0
          ? 0
          : visibleFiles.length - 1
        : (index + delta + visibleFiles.length) % visibleFiles.length;
    const next = visibleFiles[nextIndex];
    selectFile(next.repository.id, next.file.path);
    if (compact) setPage("changes");
    listRef.current?.scrollToIndex({
      index: model.rows.indexOf(next),
      animated: false,
      viewPosition: 0.5,
    });
  }
  function moveHunk(delta: number) {
    if (hunkCount && selectedKey)
      setHunkPositions((previous) => ({
        ...previous,
        [selectedKey]: {
          view: viewKey,
          index: (hunkIndex + delta + hunkCount) % hunkCount,
          request: hunkRequest + 1,
        },
      }));
  }
  function closeFile(key: string, action: CloseTabs = "close") {
    navigationRequest.current++;
    const nextTabs = closeTabs(tabs, key, action);
    const kept = new Set(nextTabs.tabs.map((tab) => tab.key));
    setTabs(nextTabs);
    setFocusedFile(null);
    setPreviews((previous) => {
      return Object.fromEntries(Object.entries(previous).filter(([key]) => kept.has(key)));
    });
    setLinkedFiles((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => kept.has(key))),
    );
    setPreviewNavigation((previous) => (previous && kept.has(previous.key) ? previous : null));
    setEditorStats((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => kept.has(key))),
    );
    setHunkPositions((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => kept.has(key))),
    );
    panelRef.current?.focus();
  }
  function onKeyDown(event: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    target?: {
      tagName?: string;
      getAttribute?(name: string): string | null;
      closest?(selector: string): unknown;
    };
    preventDefault(): void;
    stopPropagation(): void;
  }) {
    if (event.target?.closest?.('[role="menu"]')) return;
    const editing = ["INPUT", "TEXTAREA"].includes(event.target?.tagName ?? "");
    if (event.target?.getAttribute?.("role") === "separator") return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      setPage("changes");
      updateSettings({ sidebarVisible: true });
      focusFilterOnMount.current = (compact && page === "diff") || !settings.sidebarVisible;
      inputRef.current?.focus();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w" && selectedKey) {
      event.preventDefault();
      event.stopPropagation();
      closeFile(selectedKey);
    } else if (event.ctrlKey && ["PageUp", "PageDown"].includes(event.key) && tabs.tabs.length) {
      event.preventDefault();
      navigationRequest.current++;
      const index = tabs.tabs.findIndex((tab) => tab.key === selectedKey);
      const next =
        tabs.tabs[
          (index + (event.key === "PageDown" ? 1 : -1) + tabs.tabs.length) % tabs.tabs.length
        ];
      setTabs((state) => ({ ...state, active: next.key }));
      setFocusedFile(next.key);
    } else if (event.key === "Escape") {
      if (filter) setFilter("");
      else if (compact) setPage("changes");
    } else if (!editing && event.key === "/") {
      event.preventDefault();
      setPage("changes");
      updateSettings({ sidebarVisible: true });
      focusFilterOnMount.current = (compact && page === "diff") || !settings.sidebarVisible;
      inputRef.current?.focus();
    } else if (
      ((!editing && event.target?.closest?.('[data-testid="git-file-list"]')) || event.altKey) &&
      ["ArrowDown", "ArrowUp"].includes(event.key)
    ) {
      event.preventDefault();
      moveFile(event.key === "ArrowDown" ? 1 : -1);
    } else if (!editing && event.key === "F7") {
      event.preventDefault();
      moveHunk(event.shiftKey ? -1 : 1);
    }
  }
  const renderRow = useCallback(
    ({ item }: { item: ChangeRow }) => (
      <ChangeItem
        item={item}
        reviewed={Boolean(
          reviewResult &&
            item.kind === "file" &&
            reviewed.has(reviewFileKey(item.repository.id, reviewResult.revision, item.file.path)),
        )}
        styles={styles}
        theme={theme}
        name={name}
        tree={tree}
        compact={compact}
        active={item.key === selectedKey}
        collapsed={!query && collapsed.has(item.key)}
        onToggle={toggle}
        onSelect={selectFile}
        onRegister={registerRow}
        onFocusFile={setFocusedFile}
        onContextMenu={setMenu}
      />
    ),
    [
      styles,
      theme,
      name,
      tree,
      compact,
      selectedKey,
      query,
      collapsed,
      toggle,
      selectFile,
      registerRow,
      reviewResult,
      reviewed,
    ],
  );
  const hasProblems = Boolean(
    changes.error || repositories?.some((repository) => repository.state !== "ready"),
  );
  function sidebarWidth(value: number) {
    updateSettings({
      sidebarWidth: Math.round(Math.max(180, Math.min(600, (width ?? 1000) - 360, value))),
    });
  }
  async function reveal(target: { repositoryId: string; path: string }, scope?: "workspace") {
    setMenu(null);
    setFileAction(null);
    try {
      const result = await revealFile({
        directory,
        comparison,
        repositoryId: target.repositoryId,
        path: target.path,
        scope:
          scope ??
          (linkedFiles[entryKey(target.repositoryId, target.path)] ? "workspace" : "changes"),
      });
      setFileAction(result.directory && !scope ? "文件已删除，已定位到所在目录。" : null);
    } catch (error) {
      setFileAction(error instanceof Error ? error.message : String(error));
    }
  }
  async function copyPath(target: FileMenuTarget, relative: boolean) {
    setFileAction(null);
    const repository = repositories?.find((repo) => repo.id === target.repositoryId);
    if (!repository) return;
    const paths = filePaths(repository, target.path);
    try {
      await copyText(relative ? paths.relative : paths.absolute);
    } catch (error) {
      setFileAction(`复制失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async function navigatePreview(href: string) {
    const link = parsePreviewLink(href);
    if (!link || !selected) return;
    setFileAction(null);
    const request = ++navigationRequest.current;
    if (link.kind === "web") {
      try {
        await (link.url.startsWith("mailto:")
          ? Linking.openURL(link.url)
          : openExternalUrl(link.url));
      } catch (error) {
        setFileAction(`打开链接失败：${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (link.kind === "anchor") {
      setPreviewNavigation({ key: selectedKey ?? "", fragment: link.fragment, request });
      return;
    }
    try {
      const target = await resolveLink({
        directory,
        repositoryId: selected.repository.id,
        path: selected.file.path,
        href,
      });
      if (request !== navigationRequest.current) return;
      if (target.kind === "directory") {
        await reveal(target, "workspace");
        return;
      }
      const repository = repositories?.find((repo) => repo.id === target.repositoryId);
      if (!repository) throw new Error("链接所属仓库已变化，请刷新后重试。");
      const key = entryKey(target.repositoryId, target.path);
      initialized.current = true;
      setLinkedFiles((previous) => ({ ...previous, [key]: target }));
      setTabs((state) => openTab(state, { repository, file: target }));
      setFocusedFile(key);
      setPreviewNavigation({ key, fragment: target.fragment, request });
      setPage("diff");
    } catch (error) {
      if (request === navigationRequest.current)
        setFileAction(error instanceof Error ? error.message : String(error));
    }
  }
  function menuItems(target: FileMenuTarget): FileMenuItem[] {
    const items: FileMenuItem[] = [
      {
        key: "copy",
        label: "复制路径",
        icon: "copy",
        onPress: () => {
          void copyPath(target, false);
        },
      },
      {
        key: "copy-relative",
        label: "复制相对路径",
        icon: "copy",
        onPress: () => {
          void copyPath(target, true);
        },
      },
      {
        key: "reveal",
        label: capabilities.label,
        icon: "reveal",
        separator: true,
        disabled: !capabilities.reveal || Boolean(review),
        onPress: () => {
          void reveal(target);
        },
      },
    ];
    if (!review && previewKind(target.path))
      items.push({
        key: "preview",
        label: "打开文件预览",
        icon: "preview",
        onPress: () => {
          const key = entryKey(target.repositoryId, target.path);
          if (tabs.tabs.some((tab) => tab.key === key)) {
            navigationRequest.current++;
            setTabs((state) => ({ ...state, active: key }));
            setPage("diff");
          } else selectFile(target.repositoryId, target.path);
          setPreviews((previous) => ({ ...previous, [key]: true }));
        },
      });
    if (target.tabKey) {
      const key = target.tabKey;
      const index = tabs.tabs.findIndex((tab) => tab.key === key);
      items.push(
        {
          key: "close",
          label: "关闭",
          icon: "close",
          separator: true,
          onPress: () => closeFile(key),
        },
        {
          key: "others",
          label: "关闭其他",
          icon: "closeAll",
          disabled: tabs.tabs.length < 2,
          onPress: () => closeFile(key, "others"),
        },
        {
          key: "right",
          label: "关闭右侧",
          icon: "pointer",
          disabled: index < 0 || index === tabs.tabs.length - 1,
          onPress: () => closeFile(key, "right"),
        },
        {
          key: "left",
          label: "关闭左侧",
          icon: "back",
          disabled: index <= 0,
          onPress: () => closeFile(key, "left"),
        },
        { key: "all", label: "关闭全部", icon: "closeAll", onPress: () => closeFile(key, "all") },
      );
    }
    return items;
  }
  return (
    <View
      ref={panelRef}
      testID="git-changes-panel"
      {...(Platform.OS === "web" ? { dataSet: { pmono: "true" } } : {})}
      style={styles.root}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      {...(Platform.OS === "web" ? { onKeyDownCapture: onKeyDown, tabIndex: -1 } : {})}
    >
      {showComparisonPicker ? (
        <ComparisonPicker
          directory={directory}
          name={name}
          theme={theme}
          repositories={localChanges.data?.repositories ?? []}
          value={review}
          onClose={() => setShowComparisonPicker(false)}
          onApply={(next) => {
            if (next && JSON.stringify(next) === JSON.stringify(review))
              reviewState.changes.refresh();
            setReview(next);
            setShowComparisonPicker(false);
            setPage("changes");
          }}
        />
      ) : null}
      <ScrollbarStyle theme={theme} thin={settings.scrollbar === "thin"} />
      {showSettings ? (
        <SettingsPanel
          theme={theme}
          values={settings}
          update={updateSettings}
          saving={preferences.saving}
          error={preferences.error}
          retry={preferences.retry}
          reset={preferences.reset}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
      {menu ? (
        <FileMenu
          target={menu}
          theme={theme}
          items={menuItems(menu)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {fileAction ? (
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={[styles.small, styles.fileName]}>{fileAction}</Text>
          <ToolButton
            theme={theme}
            label="关闭文件操作提示"
            icon="close"
            onPress={() => setFileAction(null)}
          />
        </View>
      ) : null}
      <View style={styles.body}>
        {(!compact && settings.sidebarVisible) || (compact && page === "changes") ? (
          <View
            style={[
              styles.rail,
              { width: Math.min(settings.sidebarWidth, Math.max(180, (width ?? 1000) - 360)) },
              compact && styles.compactRail,
            ]}
          >
            <View style={styles.titlebar}>
              {viewSwitcher}
              <Text style={styles.heading}>更改</Text>
              <Text style={styles.count}>{model.entries.length}</Text>
              <ToolButton
                theme={theme}
                label={tree ? "切换为列表视图" : "切换为目录树"}
                icon={tree ? "list" : "tree"}
                onPress={() => updateSettings({ tree: !tree })}
              />
              <ToolButton
                theme={theme}
                label="折叠或展开全部仓库"
                icon="collapse"
                onPress={() =>
                  setCollapsed((previous) => {
                    const keys = (repositories ?? []).map((repo) => `repo:${repo.id}`);
                    return keys.every((key) => previous.has(key)) ? new Set() : new Set(keys);
                  })
                }
              />
              <ToolButton
                theme={theme}
                label="刷新 Git 状态"
                icon="refresh"
                busy={changes.refreshing}
                onPress={changes.refresh}
              />
              {compact ? (
                <ToolButton
                  theme={theme}
                  label="Git 设置"
                  icon="settings"
                  onPress={() => setShowSettings(true)}
                />
              ) : null}
            </View>
            <View style={[styles.tabs, { gap: 4, paddingRight: 4, alignItems: "center" }]}>
              <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 18, flex: 1 }}>
                {comparisons.map((item) => (
                  <Pressable
                    key={item.value}
                    accessibilityRole="tab"
                    accessibilityLabel={item.label}
                    ref={(node) => setWebTitle(node, `${item.label} · ${item.from} → ${item.to}`)}
                    accessibilityState={{ selected: !review && comparison === item.value }}
                    {...(Platform.OS === "web"
                      ? {
                          title: `${item.label} · ${item.from} → ${item.to}`,
                          "aria-selected": !review && comparison === item.value,
                        }
                      : {})}
                    onPress={() => {
                      setReview(null);
                      updateSettings({ comparison: item.value });
                    }}
                    style={({ pressed }) => [
                      styles.tab,
                      !review && comparison === item.value && styles.activeTab,
                      pressed && styles.hoveredRow,
                    ]}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        !review && comparison === item.value && styles.activeTabText,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <ToolButton
                theme={theme}
                label="选择比较范围"
                text={
                  compact ||
                  Math.min(settings.sidebarWidth, Math.max(180, (width ?? 1000) - 360)) >= 220
                    ? "比较"
                    : undefined
                }
                icon="branch"
                active={Boolean(review)}
                onPress={() => setShowComparisonPicker(true)}
              />
            </View>
            {review ? (
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  gap: 4,
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text numberOfLines={2} style={styles.small}>
                  {reviewResult?.title ??
                    (review.selection.mode === "branch" ? "分支对比" : "连续提交")}
                </Text>
                {reviewResult ? (
                  <Text style={styles.small}>
                    {reviewResult.commitCount} 个提交 · 已阅 {reviewedCount}/{model.entries.length}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <InputField
              theme={theme}
              icon="search"
              inputRef={inputRef}
              accessibilityLabel="筛选变更文件"
              placeholder="筛选文件路径…"
              value={filter}
              onChangeText={setFilter}
              containerStyle={styles.filterWrap}
              autoCapitalize="none"
              autoCorrect={false}
              onNavigateMatch={moveSearchMatch}
            >
              {filter ? (
                <ToolButton
                  theme={theme}
                  label="清除筛选"
                  icon="close"
                  onPress={() => setFilter("")}
                />
              ) : null}
            </InputField>
            {changes.error ? (
              <View accessibilityRole="alert" style={styles.error}>
                <Icon name="warning" color={colors.statusDanger} />
                <Text selectable style={[styles.small, styles.danger, styles.fileName]}>
                  {changes.data ? "刷新失败，显示上次结果。" : "无法读取 Git 状态。"}
                  {changes.error}
                </Text>
                <ToolButton
                  theme={theme}
                  label="重试读取 Git 状态"
                  icon="refresh"
                  onPress={changes.refresh}
                />
              </View>
            ) : null}
            {changes.loading ? (
              <View style={styles.loading}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.muted}>正在读取 Git 状态…</Text>
              </View>
            ) : (
              <FlatList
                testID="git-file-list"
                ref={listRef}
                style={styles.list}
                data={model.rows}
                stickyHeaderIndices={repositoryHeaders}
                stickyHeaderHiddenOnScroll={false}
                renderItem={renderRow}
                keyExtractor={(item) => item.key}
                initialNumToRender={24}
                maxToRenderPerBatch={24}
                windowSize={7}
                onScrollToIndexFailed={({ index, averageItemLength }) =>
                  listRef.current?.scrollToOffset({
                    offset: index * averageItemLength,
                    animated: false,
                  })
                }
                ListEmptyComponent={
                  <View style={styles.loading}>
                    <Icon name="search" color={colors.foregroundMuted} size={24} />
                    <Text style={styles.muted}>{query ? "没有匹配的更改" : "没有可用仓库"}</Text>
                    {query ? (
                      <ToolButton
                        theme={theme}
                        label="清除筛选"
                        text="清除筛选"
                        onPress={() => setFilter("")}
                      />
                    ) : null}
                  </View>
                }
              />
            )}
            <View style={styles.railSummary}>
              <Text style={[styles.small, styles.fileName]}>{model.entries.length} 个更改</Text>
              <Text style={styles.added}>+{model.totals.additions}</Text>
              <Text style={styles.removed}>−{model.totals.deletions}</Text>
              {model.totals.incomplete ? (
                <View accessibilityLabel="统计不含二进制及超限文件">
                  <Icon name="info" size={12} color={colors.foregroundMuted} />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
        {!compact && settings.sidebarVisible ? (
          <SidebarResizer
            width={Math.min(settings.sidebarWidth, Math.max(180, (width ?? 1000) - 360))}
            onChange={sidebarWidth}
            onCommit={preferences.flush}
            theme={theme}
          />
        ) : null}
        <View
          ref={(node) => {
            if (Platform.OS !== "web" || !node) return;
            const element = node as unknown as { style: { visibility: string }; inert: boolean };
            element.style.visibility = compact && page !== "diff" ? "hidden" : "visible";
            element.inert = compact && page !== "diff";
          }}
          accessibilityElementsHidden={compact && page !== "diff"}
          importantForAccessibility={compact && page !== "diff" ? "no-hide-descendants" : "auto"}
          pointerEvents={compact && page !== "diff" ? "none" : "auto"}
          style={[
            styles.content,
            compact && page !== "diff" && { position: "absolute", inset: 0, opacity: 0 },
          ]}
        >
          <View style={styles.editorTitlebar}>
            {(!compact && !settings.sidebarVisible) || (compact && page === "diff") ? (
              <View style={{ paddingLeft: 8, justifyContent: "center" }}>{viewSwitcher}</View>
            ) : null}
            {review && ((!compact && !settings.sidebarVisible) || (compact && page === "diff")) ? (
              <ToolButton
                theme={theme}
                label="选择比较范围"
                icon="branch"
                active
                onPress={() => setShowComparisonPicker(true)}
              />
            ) : null}
            <EditorTabs
              tabs={tabs.tabs}
              active={tabs.active}
              theme={theme}
              onSelect={(key) => {
                navigationRequest.current++;
                setTabs((state) => ({ ...state, active: key }));
                setFocusedFile(key);
              }}
              onClose={closeFile}
              onContextMenu={setMenu}
              compact={compact}
              sidebarVisible={settings.sidebarVisible}
              onToggleSidebar={() =>
                compact
                  ? setPage("changes")
                  : updateSettings({ sidebarVisible: !settings.sidebarVisible })
              }
              onSettings={() => setShowSettings(true)}
              settingsError={Boolean(preferences.error)}
            />
          </View>
          {selected ? (
            <>
              <View style={styles.diffToolbar}>
                <View
                  style={[styles.inline, styles.fileName]}
                  {...(Platform.OS === "web"
                    ? {
                        title: `${selected.repository.directory}/${selected.file.path}\n${linked ? "工作目录文件" : `${baseline.from} → ${baseline.to}`} · 只读`,
                      }
                    : {})}
                >
                  <Icon
                    name={selected.repository.parentId ? "repository" : "file"}
                    size={12}
                    color={colors.foregroundMuted}
                  />
                  <Text numberOfLines={1} style={[styles.small, styles.fileName]}>
                    {displayPath(selected.repository.relativePath || name)} /{" "}
                    {displayPath(selected.file.path)}
                  </Text>
                </View>
                {linked ? <Text style={styles.small}>工作目录文件</Text> : null}
                {selectedReviewKey ? (
                  <ToolButton
                    theme={theme}
                    label={reviewed.has(selectedReviewKey) ? "取消已阅" : "标记已阅"}
                    icon="check"
                    active={reviewed.has(selectedReviewKey)}
                    onPress={() =>
                      setReviewed((previous) => {
                        const next = new Set(previous);
                        if (next.has(selectedReviewKey)) next.delete(selectedReviewKey);
                        else next.add(selectedReviewKey);
                        return next;
                      })
                    }
                  />
                ) : null}
                {kind && (!linked || (selectedKey && model.lookup.has(selectedKey))) ? (
                  <ToolButton
                    theme={theme}
                    label={
                      preview
                        ? "查看文件差异"
                        : `预览 ${kind === "markdown" ? "Markdown" : kind === "html" ? "HTML" : "图片"} · ${baseline.to}`
                    }
                    icon={preview ? "code" : "preview"}
                    active={preview}
                    onPress={() => {
                      if (linked && selectedKey)
                        setLinkedFiles((previous) => {
                          const next = { ...previous };
                          delete next[selectedKey];
                          return next;
                        });
                      setPreviews((previous) => ({ ...previous, [selectedKey || ""]: !preview }));
                    }}
                  />
                ) : null}
                {!preview ? (
                  <>
                    <ToolButton
                      theme={theme}
                      label={`当前${effectiveMode === "split" ? "左右对比，切换为统一对比" : "统一对比，切换为左右对比"}`}
                      icon={effectiveMode === "split" ? "split" : "unified"}
                      onPress={() =>
                        updateSettings({
                          mode: mode === "split" ? "unified" : "split",
                        })
                      }
                    />
                    <ToolButton
                      theme={theme}
                      label={`上一个差异块（Shift+F7）· ${hunkCount ? hunkIndex + 1 : 0}/${hunkCount}`}
                      icon="up"
                      disabled={!hunkCount}
                      onPress={() => moveHunk(-1)}
                    />
                    <ToolButton
                      theme={theme}
                      label={`下一个差异块（F7）· ${hunkCount ? hunkIndex + 1 : 0}/${hunkCount}`}
                      icon="down"
                      disabled={!hunkCount}
                      onPress={() => moveHunk(1)}
                    />
                  </>
                ) : null}
              </View>
              {selected.file.oldPath ? (
                <View style={styles.rename}>
                  <Text selectable style={styles.small}>
                    重命名：{displayPath(selected.file.oldPath)} → {displayPath(selected.file.path)}
                  </Text>
                </View>
              ) : null}
              {selected.repository.recordedHead &&
              selected.repository.head &&
              selected.repository.recordedHead !== selected.repository.head ? (
                <View style={styles.rename}>
                  <Icon name="pointer" size={12} color={colors.statusWarning} />
                  <Text style={styles.small}>
                    子模块指针 {selected.repository.recordedHead.slice(0, 7)} →{" "}
                    {selected.repository.head.slice(0, 7)} · 以下比较子仓自身 {baseline.from}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
          <TabCache
            key={
              review ? JSON.stringify([review.repositoryId, reviewResult?.revision]) : comparison
            }
            active={selectedKey}
            open={tabs.tabs.map((tab) => tab.key)}
            limit={settings.tabCacheSize}
            stats={editorStats}
          >
            {selected && selectedKey ? (
              <TabEditor
                tabKey={selectedKey}
                directory={directory}
                repositoryId={selected.repository.id}
                path={selected.file.path}
                version={selected.file.version}
                comparison={comparison}
                revision={
                  reviewResult
                    ? { baseOid: reviewResult.baseOid, targetOid: reviewResult.targetOid }
                    : undefined
                }
                linked={Boolean(linked)}
                preview={preview}
                kind={kind}
                settings={settings}
                theme={theme}
                mode={effectiveMode}
                navigation={hunkTarget}
                previewNavigation={
                  previewNavigation?.key === selectedKey ? previewNavigation : undefined
                }
                onNavigate={(href) => {
                  void navigatePreview(href);
                }}
                onStats={recordStats}
                onSplitRatioChange={(splitRatio) => updateSettings({ splitRatio })}
                onSplitRatioCommit={preferences.flush}
                from={baseline.from}
                to={baseline.to}
              />
            ) : currentTab ? (
              <View style={styles.emptyState}>
                <Icon name="file" size={32} color={colors.foregroundMuted} />
                <Text style={styles.emptyTitle}>此视图没有该文件的更改</Text>
                <Text style={styles.muted}>
                  {currentTab.path} · {baseline.group}
                </Text>
                <Text style={styles.small}>可以切换比较范围，或关闭这个标签。</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Icon
                  name={
                    changes.loading
                      ? "source"
                      : hasProblems
                        ? "warning"
                        : query
                          ? "search"
                          : "check"
                  }
                  size={40}
                  color={hasProblems ? colors.statusWarning : colors.foregroundMuted}
                />
                <Text style={styles.emptyTitle}>
                  {changes.loading
                    ? "正在读取更改"
                    : hasProblems
                      ? "仓库状态未完整读取"
                      : model.entries.length
                        ? "选择文件开始审阅"
                        : query
                          ? "没有匹配的更改"
                          : review
                            ? "这个范围没有文件差异"
                            : comparison === "staged"
                              ? "没有已暂存的更改"
                              : comparison === "unstaged"
                                ? "没有未暂存的更改"
                                : "与 HEAD 没有差异"}
                </Text>
                <Text style={[styles.muted, styles.emptyDescription]}>
                  {model.entries.length && !query
                    ? "从侧栏打开文件；多个文件会保留在独立标签中。"
                    : query
                      ? "试试其他文件名或路径。"
                      : review
                        ? "点击侧栏的比较按钮调整分支或提交区间。"
                        : comparison === "staged"
                          ? "没有已暂存的更改，可以切换查看全部。"
                          : comparison === "unstaged"
                            ? "没有未暂存的更改，可以切换查看全部。"
                            : "工作目录与各仓库 HEAD 一致；可切换已暂存或未暂存，单独查看暂存区。"}
                </Text>
                {query ? (
                  <ToolButton
                    theme={theme}
                    label="清除筛选"
                    text="清除筛选"
                    onPress={() => setFilter("")}
                  />
                ) : null}
              </View>
            )}
          </TabCache>
        </View>
      </View>
      <View style={styles.statusbar}>
        <View style={[styles.inline, styles.fileName]}>
          <Icon name="branch" size={12} color={colors.foregroundMuted} />
          <Text numberOfLines={1} style={styles.statusText}>
            {(selected?.repository ?? repositories?.[0])?.branch ??
              (selected?.repository.head?.slice(0, 8) || "HEAD")}
          </Text>
          {!compact ? (
            <>
              <Text style={styles.statusText}>·</Text>
              <Text style={styles.statusText}>
                {reviewResult
                  ? `${reviewResult.commitCount} 个提交 · 已阅 ${reviewedCount}/${model.entries.length}`
                  : `${repositories?.length ?? 0} 个仓库 · 递归子模块`}
              </Text>
            </>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={review ? "刷新比较范围" : automatic ? "暂停自动刷新" : "开启自动刷新"}
          onPress={() => (review ? changes.refresh() : updateSettings({ automatic: !automatic }))}
          style={styles.statusAction}
        >
          <Icon
            name={hasProblems ? "warning" : review ? "refresh" : automatic ? "pause" : "play"}
            size={11}
            color={hasProblems ? colors.statusWarning : colors.foregroundMuted}
          />
          <Text style={styles.statusText}>
            {hasProblems
              ? "读取异常"
              : review
                ? "比较 · 手动刷新"
                : automatic
                  ? `自动刷新 · ${settings.refreshInterval / 1000}s`
                  : "刷新已暂停"}
          </Text>
        </Pressable>
        {selected && (!compact || page === "diff") ? (
          <View style={styles.inline}>
            <ToolButton
              theme={theme}
              label="上一个文件"
              icon="up"
              disabled={fileIndex <= 0}
              onPress={() => moveFile(-1)}
            />
            <Text style={styles.statusText}>
              {Math.max(0, fileIndex + 1)}/{visibleFiles.length}
            </Text>
            <ToolButton
              theme={theme}
              label="下一个文件"
              icon="down"
              disabled={fileIndex < 0 || fileIndex >= visibleFiles.length - 1}
              onPress={() => moveFile(1)}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(theme: PluginTheme) {
  const c = panelTokens(theme);
  return StyleSheet.create({
    root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: c.surface0 },
    body: { flex: 1, minHeight: 0, flexDirection: "row" },
    rail: {
      width: 240,
      minHeight: 0,
      backgroundColor: c.surface1,
      borderRightWidth: 1,
      borderRightColor: c.border,
    },
    compactRail: { flex: 1, width: "100%", borderRightWidth: 0 },
    titlebar: {
      height: 34,
      paddingHorizontal: 8,
      gap: 4,
      flexDirection: "row",
      alignItems: "center",
    },
    heading: { flex: 1, color: c.foreground, fontSize: 11, fontWeight: "600", letterSpacing: 1 },
    count: {
      minWidth: 19,
      paddingHorizontal: 5,
      paddingVertical: 1,
      textAlign: "center",
      fontSize: 10,
      color: c.foreground,
      backgroundColor: c.surface2,
      borderRadius: 8,
      fontVariant: ["tabular-nums"],
      overflow: "hidden",
    },
    workspace: {
      minHeight: 38,
      paddingHorizontal: 12,
      gap: 8,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    workspaceName: { fontSize: 12, fontWeight: "600", color: c.foreground },
    tabs: {
      flexDirection: "row",
      paddingHorizontal: 12,
      gap: 18,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    tab: {
      paddingTop: 7,
      paddingBottom: 6,
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    activeTab: { borderBottomColor: c.accent },
    tabText: { color: c.foregroundMuted, fontSize: 12 },
    activeTabText: { color: c.foreground },
    filterWrap: {
      marginHorizontal: 12,
      marginTop: 6,
      marginBottom: 6,
    },
    sectionbar: {
      minHeight: 30,
      paddingHorizontal: 8,
      paddingLeft: 14,
      gap: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    sectionTitle: { color: c.foregroundMuted, fontSize: 11 },
    list: { flex: 1, minHeight: 0 },
    repository: {
      minHeight: 34,
      paddingVertical: 4,
      paddingLeft: 8,
      paddingRight: 13,
      gap: 6,
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: "transparent",
      backgroundColor: c.surface1,
      borderBottomColor: c.border,
    },
    repositoryTitle: { color: c.foreground, fontSize: 12, fontWeight: "600", lineHeight: 17 },
    branchLine: { flexDirection: "row", alignItems: "center", gap: 4 },
    fileName: { flex: 1, minWidth: 0 },
    file: {
      minHeight: 28,
      paddingVertical: 4,
      paddingRight: 12,
      gap: 7,
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: "transparent",
    },
    touchRow: { minHeight: 38 },
    fileText: { maxWidth: "75%", color: c.foreground, fontSize: 12, lineHeight: 18, flexShrink: 1 },
    deletedName: { textDecorationLine: "line-through", color: c.foregroundMuted },
    fileStatus: { width: 13, textAlign: "center", fontSize: 11, fontWeight: "600", lineHeight: 18 },
    hoveredRow: { backgroundColor: c.surface2 },
    selectedRow: { backgroundColor: c.selection },
    focusedRow: { borderColor: c.accent },
    partialMarker: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.foregroundMuted },
    pointerBadge: { padding: 3, borderRadius: 3, backgroundColor: c.surface2 },
    notice: { flexDirection: "row", gap: 7, paddingLeft: 31, paddingRight: 14, paddingVertical: 8 },
    railSummary: {
      minHeight: 30,
      paddingHorizontal: 13,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    muted: { color: c.foregroundMuted, fontSize: 12, lineHeight: 20 },
    small: { color: c.foregroundMuted, fontSize: 10, lineHeight: 16, flexShrink: 1 },
    added: { color: c.statusSuccess, fontSize: 11, fontVariant: ["tabular-nums"] },
    removed: { color: c.statusDanger, fontSize: 11, fontVariant: ["tabular-nums"] },
    warning: { color: c.statusWarning },
    danger: { color: c.statusDanger },
    inline: { flexDirection: "row", gap: 7, alignItems: "center" },
    content: { flex: 1, minHeight: 0, minWidth: 0 },
    editorTitlebar: {
      minHeight: 34,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface1,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      paddingRight: 6,
    },
    editorTab: {
      flex: 1,
      minWidth: 0,
      minHeight: 34,
      maxWidth: 320,
      paddingHorizontal: 12,
      gap: 8,
      flexDirection: "row",
      alignItems: "center",
      borderTopWidth: 1,
      borderTopColor: c.accent,
      borderRightWidth: 1,
      borderRightColor: c.border,
      backgroundColor: c.surface0,
    },
    modeTools: {
      flex: 1,
      minWidth: 94,
      flexDirection: "row",
      justifyContent: "flex-end",
      paddingLeft: 4,
      gap: 1,
    },
    breadcrumb: {
      minHeight: 29,
      paddingHorizontal: 14,
      gap: 7,
      flexDirection: "row",
      alignItems: "center",
    },
    readOnly: {
      color: c.foregroundMuted,
      fontSize: 9,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 3,
    },
    diffToolbar: {
      minHeight: 30,
      paddingHorizontal: 8,
      gap: 2,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    baseline: { flexGrow: 1 },
    navigation: { flexDirection: "row", alignItems: "center", gap: 1, marginLeft: "auto" },
    hunkCounter: {
      minWidth: 27,
      color: c.foregroundMuted,
      fontSize: 10,
      textAlign: "center",
      fontVariant: ["tabular-nums"],
    },
    options: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: c.surface1,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    rename: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 4,
      paddingHorizontal: 14,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    loading: { flex: 1, padding: 24, gap: 12, alignItems: "center", justifyContent: "center" },
    emptyState: { flex: 1, padding: 30, gap: 13, alignItems: "center", justifyContent: "center" },
    emptyTitle: { color: c.foreground, fontSize: 15, fontWeight: "500" },
    emptyDescription: { textAlign: "center", maxWidth: 310 },
    error: {
      flexDirection: "row",
      gap: 7,
      alignItems: "center",
      paddingLeft: 12,
      paddingRight: 5,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    statusbar: {
      minHeight: 28,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface1,
    },
    statusText: {
      color: c.foregroundMuted,
      fontSize: 10,
      flexShrink: 1,
      fontVariant: ["tabular-nums"],
    },
    statusAction: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 7 },
  });
}
