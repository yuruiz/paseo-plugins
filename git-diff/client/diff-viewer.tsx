import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DiffLine, FileDiff } from "../shared/contracts";
import { buildDiffRows, type DiffRow } from "./diff-model";
import { Icon } from "./icons";
import { diffSyntaxStates, languageForPath } from "./syntax";
import { SyntaxText } from "./syntax-text";
import { panelTokens } from "./theme";
import { DiffResizer } from "./web-chrome";

export type DiffLayout = "unified" | "split";
type ViewerRow = DiffRow;
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
}) {
  const styles = useMemo(
    () => makeStyles(theme, fontSize, fontFamily, fontWeight, wrap),
    [theme, fontSize, fontFamily, fontWeight, wrap],
  );
  const colors = useMemo(() => panelTokens(theme), [theme]);
  const language = useMemo(() => languageForPath(diff.path), [diff.path]);
  const syntaxStates = useMemo(
    () =>
      syntaxHighlight ? diffSyntaxStates(diff.hunks, language) : new WeakMap<DiffLine, object>(),
    [diff.hunks, language, syntaxHighlight],
  );
  const [width, setWidth] = useState(360);
  const [horizontalOffsets, setHorizontalOffsets] = useState([0, 0]);
  const ratio = Math.max(0.2, Math.min(0.8, splitRatio));
  const rootRef = useRef<View>(null);
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
    () => buildDiffRows(diff.hunks, mode === "split"),
    [diff.hunks, mode],
  );
  const layout = useMemo(() => {
    let offset = 0;
    const hunks: number[] = [];
    const sizes = rows.map((row, index) => {
      if ("header" in row) hunks.push(index);
      const length = "header" in row ? HUNK_HEIGHT : LINE_HEIGHT + fontSize - 12;
      const result = { index, length, offset };
      offset += length;
      return result;
    });
    return { sizes, hunks };
  }, [rows, fontSize]);
  const { longest, columns } = useMemo(() => {
    let longest = 30;
    let columns = 30;
    for (const hunk of diff.hunks)
      for (const line of hunk.lines) {
        const expanded = line.content.replace(/\t/g, " ".repeat(tabSize));
        longest = Math.max(longest, expanded.length);
        let visibleColumns = 0;
        for (const character of expanded.slice(0, MAX_COLUMNS)) {
          // Reserve two cells for wide Unicode glyphs, including CJK comments.
          visibleColumns += (character.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
        }
        columns = Math.max(columns, visibleColumns);
      }
    return { longest, columns };
  }, [diff.hunks, tabSize]);
  const effectiveWrap = wrap;
  const contentWidth =
    effectiveWrap || mode === "split" ? width : Math.max(width, columns * fontSize * 0.65 + 106);
  const textWidth = columns * fontSize * 0.65 + 18;
  useEffect(() => {
    retried.current = false;
    const index = layout.hunks[navigation.index];
    if (index !== undefined)
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [navigation, layout.hunks]);

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
    return effectiveWrap ? content : content.slice(0, MAX_COLUMNS);
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
            />
          </Text>
        </View>
      </View>
    );
  }
  function renderRow({ item, index }: { item: ViewerRow; index: number }) {
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
        <View style={styles.line}>
          {splitCell(item.left, false)}
          {splitCell(item.right, true)}
        </View>
      );
    const line = item.left;
    if (!line) return null;
    return (
      <View style={[styles.line, { backgroundColor: background(line) }]}>
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
      {...(Platform.OS === "web" ? { dataSet: { gitCode: "true", pmono: "true" } } : {})}
      style={styles.root}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
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
      {!effectiveWrap && longest > MAX_COLUMNS ? (
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
        <ScrollView horizontal style={styles.root} contentContainerStyle={styles.horizontal}>
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
