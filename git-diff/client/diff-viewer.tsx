import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from "react-native";
import type { DiffLine, FileDiff } from "../shared/contracts";
import { buildContextRows, type ContextRow, validateFullContext } from "./context-model";
import { InputField, ToolButton } from "./controls";
import { buildDiffRows } from "./diff-model";
import { findMatches } from "./find-model";
import { Icon } from "./icons";
import { diffSyntaxStates, languageForPath } from "./syntax";
import { SyntaxText } from "./syntax-text";
import { panelTokens } from "./theme";
import { DiffResizer } from "./web-chrome";

export type DiffLayout = "unified" | "split";
type ViewerRow = ContextRow;
const LINE_HEIGHT = 22;
const HUNK_HEIGHT = 28;
const MAX_COLUMNS = 2000;
const INITIAL_NAVIGATION = { index: 0, request: 0 };

export function DiffViewer({
  diff,
  theme,
  mode,
  wrap,
  navigation = INITIAL_NAVIGATION,
  from = "HEAD",
  to = "工作目录",
  syntaxHighlight = true,
  fontSize = 12,
  fontFamily,
  fontWeight = "500",
  splitRatio = 0.5,
  onSplitRatioChange,
  onSplitRatioCommit,
  tabSize = 4,
  lineNumbers = true,
  loadFullContext,
  completeContext = false,
}: {
  diff: FileDiff;
  theme: PluginTheme;
  mode: DiffLayout;
  wrap: boolean;
  navigation?: { index: number; request: number };
  from?: string;
  to?: string;
  syntaxHighlight?: boolean;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: "400" | "500" | "600";
  splitRatio?: number;
  onSplitRatioChange?(ratio: number): void;
  onSplitRatioCommit?(): void;
  tabSize?: number;
  lineNumbers?: boolean;
  loadFullContext?(): Promise<FileDiff>;
  completeContext?: boolean;
}) {
  const [contextState, setContextState] = useState<{
    source: FileDiff;
    full: FileDiff | null;
    expanded: Record<number, number>;
    loading: boolean;
    error: string | null;
  }>({ source: diff, full: null, expanded: {}, loading: false, error: null });
  if (contextState.source !== diff)
    setContextState({ source: diff, full: null, expanded: {}, loading: false, error: null });
  const currentDiff = useRef(diff);
  currentDiff.current = diff;
  const contextRequest = useRef(false);
  const full = contextState.source === diff ? contextState.full : null;
  const displayedHunks = full?.hunks ?? diff.hunks;
  async function expandContext(gap: number, all = false) {
    if (contextRequest.current || !loadFullContext) return;
    contextRequest.current = true;
    setContextState((state) => ({ ...state, loading: true, error: null }));
    try {
      const loaded = full ?? (await loadFullContext());
      if (!full) validateFullContext(diff, loaded);
      if (currentDiff.current !== diff) return;
      setContextState((state) => ({
        ...state,
        full: loaded,
        loading: false,
        expanded: { ...state.expanded, [gap]: all ? Infinity : (state.expanded[gap] ?? 0) + 20 },
      }));
    } catch (error) {
      if (currentDiff.current === diff)
        setContextState((state) => ({
          ...state,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
    } finally {
      contextRequest.current = false;
    }
  }
  const styles = useMemo(
    () => makeStyles(theme, fontSize, fontFamily, fontWeight, wrap),
    [theme, fontSize, fontFamily, fontWeight, wrap],
  );
  const colors = useMemo(() => panelTokens(theme), [theme]);
  const language = useMemo(() => languageForPath(diff.path), [diff.path]);
  const syntaxStates = useMemo(() => {
    if (!syntaxHighlight) return new WeakMap<DiffLine, object>();
    const states = diffSyntaxStates(displayedHunks, language);
    if (full) {
      const byPosition = new Map(
        displayedHunks.flatMap((hunk) =>
          hunk.lines.map(
            (line) => [`${line.kind}:${line.oldLine}:${line.newLine}`, states.get(line)] as const,
          ),
        ),
      );
      for (const hunk of diff.hunks)
        for (const line of hunk.lines) {
          const state = byPosition.get(`${line.kind}:${line.oldLine}:${line.newLine}`);
          if (state) states.set(line, state);
        }
    }
    return states;
  }, [displayedHunks, diff.hunks, full, language, syntaxHighlight]);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const findInput = useRef<TextInput>(null);
  useEffect(() => {
    if (findOpen) findInput.current?.focus();
  }, [findOpen]);
  const [width, setWidth] = useState(360);
  const [horizontalOffsets, setHorizontalOffsets] = useState([0, 0]);
  const ratio = Math.max(0.2, Math.min(0.8, splitRatio));
  const rootRef = useRef<View>(null);
  const unifiedScroll = useRef<ScrollView>(null);
  const originalScroll = useRef<ScrollView>(null);
  const modifiedScroll = useRef<ScrollView>(null);
  const currentRatio = useRef(ratio);
  currentRatio.current = ratio;
  useEffect(() => {
    if (Platform.OS !== "web" || mode !== "split" || wrap || diff.state !== "text") return;
    type Wheel = {
      clientX: number;
      deltaX: number;
      deltaY: number;
      shiftKey: boolean;
      preventDefault(): void;
    };
    const node = rootRef.current as unknown as {
      getBoundingClientRect(): { left: number; width: number };
      addEventListener(
        type: string,
        handler: (event: Wheel) => void,
        options: { passive: boolean },
      ): void;
      removeEventListener(type: string, handler: (event: Wheel) => void): void;
    } | null;
    if (!node) return;
    const wheel = (event: Wheel) => {
      if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      const bounds = node.getBoundingClientRect();
      const ref =
        event.clientX < bounds.left + bounds.width * currentRatio.current
          ? originalScroll
          : modifiedScroll;
      const scroll = ref.current?.getScrollableNode() as {
        scrollLeft: number;
        scrollWidth: number;
        clientWidth: number;
      } | null;
      if (!scroll || scroll.scrollWidth <= scroll.clientWidth) return;
      event.preventDefault();
      scroll.scrollLeft += event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [mode, wrap, diff.state]);
  const listRef = useRef<FlatList<ViewerRow>>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retried = useRef(false);
  const rows = useMemo<ViewerRow[]>(
    () =>
      query && full
        ? buildDiffRows(full.hunks, mode === "split")
        : completeContext || !loadFullContext
          ? buildDiffRows(diff.hunks, mode === "split")
          : buildContextRows(diff, full, mode === "split", contextState.expanded),
    [diff, full, mode, contextState.expanded, completeContext, loadFullContext, query],
  );
  const matches = useMemo(() => findMatches(rows, query, tabSize), [rows, query, tabSize]);
  const activeMatch = matches[matchIndex % (matches.length || 1)];
  useEffect(() => {
    if (activeMatch) {
      retried.current = false;
      listRef.current?.scrollToIndex({
        index: activeMatch.row,
        animated: false,
        viewPosition: 0.4,
      });
      if (!wrap) {
        const x = Math.max(0, activeMatch.start * fontSize * 0.65 - 40);
        if (mode === "split") {
          (activeMatch.side === "right" ? modifiedScroll : originalScroll).current?.scrollTo({
            x,
            animated: false,
          });
        } else unifiedScroll.current?.scrollTo({ x, animated: false });
      }
    }
  }, [activeMatch, wrap, fontSize, mode]);
  useEffect(() => {
    if (Platform.OS !== "web" || diff.state !== "text") return;
    const node = rootRef.current as unknown as {
      addEventListener(
        type: string,
        handler: (event: {
          key: string;
          ctrlKey: boolean;
          metaKey: boolean;
          preventDefault(): void;
          stopPropagation(): void;
        }) => void,
      ): void;
      removeEventListener(type: string, handler: unknown): void;
    } | null;
    const keydown = (event: {
      key: string;
      ctrlKey: boolean;
      metaKey: boolean;
      preventDefault(): void;
      stopPropagation(): void;
    }) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        setFindOpen(true);
        findInput.current?.focus();
      } else if (event.key === "Escape" && findOpen) {
        event.preventDefault();
        event.stopPropagation();
        setFindOpen(false);
        setQuery("");
      }
    };
    node?.addEventListener("keydown", keydown);
    return () => node?.removeEventListener("keydown", keydown);
  }, [findOpen, diff.state]);
  function navigateMatch(direction: number) {
    setMatchIndex((index) => (index + direction + matches.length) % (matches.length || 1));
  }
  const layout = useMemo(() => {
    let offset = 0;
    const hunks: number[] = [];
    const sizes = rows.map((row, index) => {
      if ("header" in row) hunks.push(index);
      const length = "header" in row || "gap" in row ? HUNK_HEIGHT : LINE_HEIGHT + fontSize - 12;
      const result = { index, length, offset };
      offset += length;
      return result;
    });
    return { sizes, hunks };
  }, [rows, fontSize]);
  const { longest, columns } = useMemo(() => {
    let longest = 30;
    let columns = 30;
    for (const hunk of displayedHunks)
      for (const line of hunk.lines) {
        const expanded = line.content.replace(/\t/g, " ".repeat(tabSize));
        longest = Math.max(longest, expanded.length);
        let visibleColumns = 0;
        for (const character of query ? expanded : expanded.slice(0, MAX_COLUMNS)) {
          // Reserve two cells for wide Unicode glyphs, including CJK comments.
          visibleColumns += (character.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
        }
        columns = Math.max(columns, visibleColumns);
      }
    return { longest, columns };
  }, [displayedHunks, tabSize, query]);
  const effectiveWrap = wrap;
  const contentWidth =
    effectiveWrap || mode === "split" ? width : Math.max(width, columns * fontSize * 0.65 + 106);
  const textWidth = columns * fontSize * 0.65 + 18;
  const navigationTarget = useRef<typeof navigation | null>(null);
  useEffect(() => {
    if (query || navigationTarget.current === navigation) return;
    const initial = navigationTarget.current === null;
    navigationTarget.current = navigation;
    retried.current = false;
    const index = layout.hunks[navigation.index];
    if (index !== undefined) {
      const target = initial && index > 0 && "gap" in rows[index - 1] ? index - 1 : index;
      listRef.current?.scrollToIndex({ index: target, animated: false, viewPosition: 0 });
    }
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [navigation, layout.hunks, rows, query]);

  function background(line: DiffLine | null, gutter = false) {
    return line?.kind === "added"
      ? gutter
        ? colors.addedGutter
        : colors.addedBackground
      : line?.kind === "removed"
        ? gutter
          ? colors.removedGutter
          : colors.removedBackground
        : gutter || !line
          ? colors.surface1
          : colors.surface0;
  }
  function lineText(line: DiffLine | null) {
    const content = (line?.content || " ").replace(/\t/g, " ".repeat(tabSize));
    return effectiveWrap || query ? content : content.slice(0, MAX_COLUMNS);
  }
  function changeColor(line: DiffLine | null) {
    return line?.kind === "added"
      ? colors.statusSuccess
      : line?.kind === "removed"
        ? colors.statusDanger
        : colors.foregroundMuted;
  }
  function signStyle(line: DiffLine | null) {
    const changed = line?.kind === "added" || line?.kind === "removed";
    return {
      color: changeColor(line),
      backgroundColor: background(line, true),
      borderLeftColor: changed ? changeColor(line) : "transparent",
    };
  }
  function splitCell(line: DiffLine | null, right: boolean) {
    const codeWidth = Math.max(
      textWidth,
      width * (right ? 1 - ratio : ratio) - (lineNumbers ? 58 : 18),
    );
    return (
      <View
        style={[
          styles.cell,
          { flex: right ? 1 - ratio : ratio, backgroundColor: background(line) },
        ]}
      >
        {lineNumbers ? (
          <Text
            selectable
            style={[
              styles.gutter,
              { backgroundColor: background(line, true), color: changeColor(line) },
            ]}
          >
            {line ? (right ? line.newLine : line.oldLine) : ""}
          </Text>
        ) : null}
        <Text style={[styles.sign, signStyle(line)]}>
          {line?.kind === "added" ? "+" : line?.kind === "removed" ? "−" : " "}
        </Text>
        <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <Text
            selectable
            numberOfLines={effectiveWrap ? undefined : 1}
            ellipsizeMode="clip"
            style={[
              styles.code,
              { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
              line?.kind === "meta" && styles.meta,
              !effectiveWrap && {
                width: codeWidth,
                maxWidth: codeWidth,
                transform: [{ translateX: -horizontalOffsets[right ? 1 : 0] }],
              },
            ]}
          >
            <SyntaxText
              content={lineText(line)}
              language={language}
              state={line ? syntaxStates.get(line) : undefined}
              background={colors.surface0}
              enabled={syntaxHighlight && line?.kind !== "meta"}
              search={query}
              highlightColor={colors.addedGutter}
            />
          </Text>
        </View>
      </View>
    );
  }
  function renderRow({ item, index }: { item: ViewerRow; index: number }) {
    if ("gap" in item)
      return loadFullContext ? (
        <View style={styles.hunk}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              item.count === null ? "展开文件末尾上下文" : `展开 ${item.count} 行相同代码`
            }
            disabled={contextState.loading}
            onPress={() => void expandContext(item.gap)}
          >
            <Text style={styles.contextAction}>
              {contextState.loading
                ? "正在读取上下文…"
                : item.count === null
                  ? "展开后续上下文"
                  : `展开相同代码（${item.count} 行）`}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="展开此处全部相同代码"
            disabled={contextState.loading}
            onPress={() => void expandContext(item.gap, true)}
          >
            <Text style={styles.contextAction}>全部展开</Text>
          </Pressable>
        </View>
      ) : null;
    if ("header" in item)
      return (
        <View style={[styles.hunk, index === layout.hunks[navigation.index] && styles.activeHunk]}>
          <Icon name="code" color={colors.foregroundMuted} size={12} />
          <Text selectable numberOfLines={1} style={styles.hunkText}>
            {item.header}
          </Text>
        </View>
      );
    if (mode === "split")
      return (
        <View
          style={[
            styles.line,
            activeMatch?.row === index && {
              borderBottomWidth: 2,
              borderBottomColor: colors.accent,
            },
          ]}
        >
          {splitCell(item.left, false)}
          {splitCell(item.right, true)}
        </View>
      );
    const line = item.left;
    if (!line) return null;
    return (
      <View
        style={[
          styles.line,
          { backgroundColor: background(line) },
          activeMatch?.row === index && { borderBottomWidth: 2, borderBottomColor: colors.accent },
        ]}
      >
        {lineNumbers ? (
          <Text
            selectable
            style={[
              styles.gutter,
              { backgroundColor: background(line, true), color: changeColor(line) },
            ]}
          >
            {line.oldLine}
          </Text>
        ) : null}
        {lineNumbers ? (
          <Text
            selectable
            style={[
              styles.gutter,
              { backgroundColor: background(line, true), color: changeColor(line) },
            ]}
          >
            {line.newLine}
          </Text>
        ) : null}
        <Text style={[styles.sign, signStyle(line)]}>
          {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
        </Text>
        <Text
          selectable
          numberOfLines={effectiveWrap ? undefined : 1}
          ellipsizeMode="clip"
          style={[styles.code, line.kind === "meta" && styles.meta]}
        >
          <SyntaxText
            content={lineText(line)}
            language={language}
            state={syntaxStates.get(line)}
            background={colors.surface0}
            enabled={syntaxHighlight && line.kind !== "meta"}
            search={query}
            highlightColor={colors.addedGutter}
          />
        </Text>
      </View>
    );
  }
  if (diff.state !== "text")
    return (
      <View style={styles.message}>
        <Icon
          name={
            diff.state === "binary" ? "binary" : diff.state === "too_large" ? "warning" : "info"
          }
          size={32}
          color={colors.foregroundMuted}
        />
        <Text style={styles.messageTitle}>
          {diff.state === "binary"
            ? "二进制文件已更改"
            : diff.state === "too_large"
              ? "文件过大"
              : "没有文本差异"}
        </Text>
        <Text selectable style={styles.muted}>
          {diff.message}
        </Text>
        {diff.patch ? (
          <Text selectable style={styles.metadata}>
            {diff.patch}
          </Text>
        ) : null}
      </View>
    );
  const list = (
    <FlatList
      ref={listRef}
      testID="diff-lines"
      style={{ flex: 1, minHeight: 0, width: contentWidth }}
      data={rows}
      renderItem={renderRow}
      keyExtractor={(row) => row.key}
      initialNumToRender={40}
      maxToRenderPerBatch={32}
      windowSize={7}
      getItemLayout={!effectiveWrap ? (_, index) => layout.sizes[index] : undefined}
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
        if (!retried.current) {
          retried.current = true;
          retryTimer.current = setTimeout(
            () => listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 }),
            100,
          );
        }
      }}
    />
  );
  return (
    <View
      testID="git-code-viewer"
      ref={rootRef}
      {...(Platform.OS === "web"
        ? { tabIndex: 0, dataSet: { gitCode: "true", pmono: "true" } }
        : {})}
      style={styles.root}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 4 }}>
        {findOpen ? (
          <>
            <InputField
              theme={theme}
              inputRef={findInput}
              value={query}
              placeholder="搜索当前文件"
              accessibilityLabel="搜索当前文件"
              containerStyle={{ flex: 1 }}
              onChangeText={(value) => {
                setQuery(value);
                setMatchIndex(0);
                if (value && !full && !completeContext) void expandContext(-1, true);
              }}
              onNavigateMatch={navigateMatch}
            />
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              {contextState.loading
                ? "读取中…"
                : `${matches.length ? (matchIndex % matches.length) + 1 : 0}/${matches.length}`}
            </Text>
            <ToolButton
              theme={theme}
              label="上一个匹配 (Shift+Enter)"
              text="↑"
              disabled={!matches.length}
              onPress={() => navigateMatch(-1)}
            />
            <ToolButton
              theme={theme}
              label="下一个匹配 (Enter)"
              icon="chevronDown"
              disabled={!matches.length}
              onPress={() => navigateMatch(1)}
            />
            <ToolButton
              theme={theme}
              label="关闭搜索 (Escape)"
              icon="close"
              onPress={() => {
                setFindOpen(false);
                setQuery("");
              }}
            />
          </>
        ) : (
          <ToolButton
            theme={theme}
            label="搜索当前文件 (Ctrl/Cmd+F)"
            icon="search"
            onPress={() => setFindOpen(true)}
          />
        )}
      </View>
      {mode === "split" ? (
        <View style={styles.columnHeaders}>
          <View style={[styles.columnHeading, { width: `${ratio * 100}%` }]}>
            <Text style={styles.columnLabel}>原始 · {from}</Text>
          </View>
          <View style={[styles.columnHeading, { width: `${(1 - ratio) * 100}%` }]}>
            <Text style={styles.columnLabel}>修改 · {to}</Text>
          </View>
        </View>
      ) : null}
      {contextState.error ? (
        <View accessibilityRole="alert" style={styles.contextError}>
          <Text selectable style={styles.contextErrorText}>
            {contextState.error}
          </Text>
        </View>
      ) : null}
      {!effectiveWrap && !query && longest > MAX_COLUMNS ? (
        <View style={styles.longLineNotice}>
          <Icon name="info" size={12} color={colors.foregroundMuted} />
          <Text style={styles.columnLabel}>
            超长行显示前 2000 字符；开启自动换行可查看完整内容。
          </Text>
        </View>
      ) : null}
      {effectiveWrap || mode === "split" ? (
        list
      ) : (
        <ScrollView
          ref={unifiedScroll}
          horizontal
          style={styles.root}
          contentContainerStyle={styles.horizontal}
        >
          {list}
        </ScrollView>
      )}
      {mode === "split" && !effectiveWrap ? (
        <View style={{ flexDirection: "row", height: 12 }}>
          {[ratio, 1 - ratio].map((fraction, side) => (
            <ScrollView
              ref={side === 0 ? originalScroll : modifiedScroll}
              key={side === 0 ? "original" : "modified"}
              horizontal
              testID={side === 0 ? "diff-original-scroll" : "diff-modified-scroll"}
              accessibilityLabel={side === 0 ? "原始代码横向滚动" : "修改代码横向滚动"}
              style={{ flex: fraction, minWidth: 0, height: 12 }}
              scrollEventThrottle={16}
              onScroll={(event) => {
                const offset = event.nativeEvent.contentOffset.x;
                setHorizontalOffsets((previous) =>
                  previous[side] === offset
                    ? previous
                    : previous.map((value, index) => (index === side ? offset : value)),
                );
              }}
            >
              <View
                style={{
                  width: Math.max(width * fraction, textWidth + (lineNumbers ? 58 : 18)),
                  height: 1,
                }}
              />
            </ScrollView>
          ))}
        </View>
      ) : null}
      {mode === "split" && onSplitRatioChange ? (
        <DiffResizer
          ratio={ratio}
          width={width}
          onChange={onSplitRatioChange}
          onCommit={onSplitRatioCommit ?? (() => {})}
          theme={theme}
        />
      ) : null}
    </View>
  );
}

function makeStyles(
  theme: PluginTheme,
  fontSize: number,
  fontFamily?: string,
  fontWeight: "400" | "500" | "600" = "500",
  wrap = false,
) {
  const c = panelTokens(theme);
  const mono = fontFamily ?? c.mono;
  return StyleSheet.create({
    root: { flex: 1, minHeight: 0, minWidth: 0 },
    horizontal: { flexGrow: 1 },
    line: { flexDirection: "row", minHeight: LINE_HEIGHT + fontSize - 12, alignItems: "stretch" },
    cell: { flex: 1, minWidth: 0, flexDirection: "row" },
    divider: { borderLeftWidth: 1, borderLeftColor: c.border },
    gutter: {
      width: 40,
      paddingHorizontal: 7,
      paddingVertical: 2,
      textAlign: "right",
      fontFamily: mono,
      fontWeight,
      fontSize: 11,
      lineHeight: fontSize + 6,
      color: c.foregroundMuted,
      fontVariant: ["tabular-nums"],
    },
    sign: {
      width: 18,
      borderLeftWidth: 3,
      textAlign: "center",
      paddingVertical: 2,
      fontFamily: mono,
      fontWeight: "700",
      fontSize,
      lineHeight: fontSize + 6,
    },
    code: {
      // RN Web's numberOfLines={1} uses nowrap, which collapses code indentation.
      ...(Platform.OS === "web"
        ? { whiteSpace: wrap ? ("pre-wrap" as const) : ("pre" as const) }
        : {}),
      flex: 1,
      minWidth: 0,
      paddingRight: 12,
      paddingLeft: 3,
      paddingVertical: 2,
      fontFamily: mono,
      fontWeight,
      fontSize,
      lineHeight: fontSize + 6,
      color: c.foreground,
    },
    meta: { color: c.foregroundMuted, fontStyle: "italic" },
    hunk: {
      height: HUNK_HEIGHT,
      paddingHorizontal: 12,
      gap: 7,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface1,
      borderLeftWidth: 2,
      borderLeftColor: "transparent",
    },
    activeHunk: { borderLeftColor: c.accent, backgroundColor: c.selection },
    hunkText: { flex: 1, minWidth: 0, color: c.foregroundMuted, fontSize: 10, fontFamily: c.mono },
    contextAction: { color: c.accent, fontSize: 11, lineHeight: HUNK_HEIGHT },
    contextError: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: c.surface1 },
    contextErrorText: { color: c.statusDanger, fontSize: 12 },
    columnHeaders: {
      flexDirection: "row",
      minHeight: 28,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      backgroundColor: c.surface1,
    },
    columnHeading: { paddingHorizontal: 12, paddingVertical: 6 },
    columnLabel: { color: c.foregroundMuted, fontSize: 10, lineHeight: 16, flexShrink: 1 },
    longLineNotice: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      flexDirection: "row",
      gap: 6,
      alignItems: "center",
      backgroundColor: c.surface1,
    },
    message: { flex: 1, padding: 28, gap: 13, alignItems: "center", justifyContent: "center" },
    messageTitle: { color: c.foreground, fontSize: 14 },
    muted: { color: c.foregroundMuted, fontSize: 12, lineHeight: 20, textAlign: "center" },
    metadata: {
      color: c.foregroundMuted,
      fontFamily: c.mono,
      fontSize: 11,
      lineHeight: 19,
      maxHeight: 140,
    },
  });
}
