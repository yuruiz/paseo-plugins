import type { PluginTheme } from "@getpaseo/plugin";
import { createElement, memo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { GitRef } from "../shared/history-contracts";
import { setWebTitle } from "./controls";
import { type GraphRow, shortDate } from "./graph-model";
import { Icon } from "./icons";
import { mixColor, panelTokens } from "./theme";

export const COMMIT_ROW_HEIGHT = 34;
const LANE_WIDTH = 16;
const x = (lane: number) => 18 + lane * LANE_WIDTH;
const palettes = {
  dark: ["#6ca8f5", "#c792ea", "#52bfa4", "#e3ae62", "#e27b9c", "#6ec5d6"],
  light: ["#286fc4", "#8a47b8", "#17856b", "#a66a13", "#bc4772", "#167e98"],
};
export function graphPalette(theme: PluginTheme) {
  const background = theme.colors.surface0.replace("#", "");
  return palettes[Number.parseInt(background.slice(0, 2), 16) > 128 ? "light" : "dark"];
}

function GraphCell({
  row,
  width,
  palette,
  background,
  head,
}: {
  row: GraphRow;
  width: number;
  palette: string[];
  background: string;
  head: boolean;
}) {
  const middle = COMMIT_ROW_HEIGHT / 2;
  const color = palette[row.color % palette.length];
  if (Platform.OS === "web")
    return createElement(
      "svg",
      {
        width,
        height: COMMIT_ROW_HEIGHT,
        viewBox: `0 0 ${width} ${COMMIT_ROW_HEIGHT}`,
        "aria-hidden": true,
        style: { flexShrink: 0, overflow: "hidden" },
      },
      ...row.edges.map((edge, index) =>
        createElement("path", {
          key: index,
          d:
            edge.half === "top"
              ? `M ${x(edge.from)} 0 L ${x(edge.to)} ${middle}`
              : `M ${x(edge.from)} ${middle} C ${x(edge.from)} ${middle + 10}, ${x(edge.to)} ${middle + 7}, ${x(edge.to)} ${COMMIT_ROW_HEIGHT}`,
          fill: "none",
          stroke: palette[edge.color % palette.length],
          strokeWidth: 1.7,
        }),
      ),
      ...(head
        ? [
            createElement("circle", {
              key: "head",
              cx: x(row.lane),
              cy: middle,
              r: 7,
              fill: background,
              stroke: color,
              strokeWidth: 1.5,
            }),
          ]
        : []),
      createElement("circle", {
        cx: x(row.lane),
        cy: middle,
        r: row.commit.parents.length > 1 ? 4.5 : 3.8,
        fill: row.commit.parents.length > 1 ? background : color,
        stroke: color,
        strokeWidth: 1.8,
      }),
    );
  return (
    <View accessible={false} style={{ width, height: COMMIT_ROW_HEIGHT }}>
      {row.edges.map((edge) => {
        const start = edge.half === "top" ? 0 : middle;
        const delta = x(edge.to) - x(edge.from);
        const length = Math.hypot(delta, middle);
        return (
          <View
            key={`${edge.half}:${edge.from}:${edge.to}:${edge.color}`}
            style={{
              position: "absolute",
              height: length,
              width: 1.7,
              left: (x(edge.to) + x(edge.from)) / 2,
              top: start + middle / 2 - length / 2,
              backgroundColor: palette[edge.color % palette.length],
              transform: [{ rotate: `${-Math.atan2(delta, middle)}rad` }],
            }}
          />
        );
      })}
      <View
        style={{
          position: "absolute",
          left: x(row.lane) - (head ? 7 : 4),
          top: middle - (head ? 7 : 4),
          width: head ? 14 : 8,
          height: head ? 14 : 8,
          borderRadius: 8,
          borderColor: color,
          borderWidth: head ? 2 : 0,
          backgroundColor: head ? background : color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {head ? (
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
        ) : null}
      </View>
    </View>
  );
}

export function RefBadge({
  reference,
  theme,
  maxWidth = 180,
}: {
  reference: GitRef;
  theme: PluginTheme;
  maxWidth?: number;
}) {
  const c = panelTokens(theme);
  const palette = graphPalette(theme);
  const color = reference.current
    ? c.accent
    : reference.kind === "tag"
      ? palette[3]
      : reference.kind === "remote"
        ? palette[2]
        : palette[1];
  return (
    <View
      ref={(node) => setWebTitle(node, reference.fullName)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        maxWidth,
        paddingHorizontal: 5,
        height: 19,
        backgroundColor: mixColor(color, c.surface0, 0.12),
        borderWidth: 1,
        borderColor: mixColor(color, c.surface0, 0.45),
        borderRadius: 3,
      }}
    >
      {reference.kind !== "tag" ? (
        <Icon name="branch" color={color} size={11} />
      ) : (
        <Text style={{ color, fontSize: 10 }}>#</Text>
      )}
      <Text numberOfLines={1} style={{ color, fontSize: 10, flexShrink: 1 }}>
        {reference.name}
      </Text>
    </View>
  );
}

export const CommitGraphRow = memo(function CommitGraphRow({
  row,
  graphWidth,
  theme,
  references,
  head,
  active,
  matched,
  showAuthor,
  showDate,
  onSelect,
  disabled = false,
}: {
  row: GraphRow;
  graphWidth: number;
  theme: PluginTheme;
  references: GitRef[];
  head: boolean;
  active: boolean;
  matched: boolean;
  showAuthor: boolean;
  showDate: boolean;
  disabled?: boolean;
  onSelect(oid: string): void;
}) {
  const c = panelTokens(theme);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const background = active ? c.selection : hovered ? c.surface2 : c.surface0;
  const visibleRefs = showDate ? 2 : 1;
  return (
    <Pressable
      ref={(node) =>
        setWebTitle(
          node,
          `${row.commit.subject}\n${row.commit.author} <${row.commit.email}>\n${row.commit.date}\n${row.commit.oid}${references.length ? `\n${references.map((ref) => ref.fullName).join("\n")}` : ""}`,
        )
      }
      accessibilityRole="button"
      accessibilityLabel={`提交 ${row.commit.oid.slice(0, 8)} ${row.commit.subject} · ${row.commit.author}`}
      {...(Platform.OS === "web"
        ? { "aria-pressed": active, tabIndex: active ? 0 : -1 }
        : { accessibilityState: { selected: active } })}
      disabled={disabled}
      testID={`git-commit-${row.commit.oid}`}
      onPress={() => onSelect(row.commit.oid)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        height: COMMIT_ROW_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: background,
        borderWidth: 1,
        borderColor: focused ? c.accent : "transparent",
        paddingRight: 12,
      }}
    >
      <GraphCell
        row={row}
        width={graphWidth}
        palette={graphPalette(theme)}
        background={background}
        head={head}
      />
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingRight: 12,
          opacity: matched ? 1 : 0.4,
          overflow: "hidden",
        }}
      >
        {head && showDate ? (
          <Text style={{ color: c.accent, fontFamily: c.mono, fontSize: 9, fontWeight: "600" }}>
            HEAD
          </Text>
        ) : null}
        {references.slice(0, visibleRefs).map((ref) => (
          <RefBadge
            key={ref.fullName}
            reference={ref}
            theme={theme}
            maxWidth={showDate ? 180 : 110}
          />
        ))}
        {references.length > visibleRefs ? (
          <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>
            +{references.length - visibleRefs}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, flexShrink: 1 }}>
          {row.commit.subject || "（无提交说明）"}
        </Text>
      </View>
      {showAuthor ? (
        <Text
          numberOfLines={1}
          style={{
            color: c.foregroundMuted,
            fontSize: 11,
            width: 130,
            paddingRight: 12,
            opacity: matched ? 1 : 0.4,
          }}
        >
          {row.commit.author}
        </Text>
      ) : null}
      {showDate ? (
        <Text
          style={{ color: c.foregroundMuted, fontSize: 11, width: 100, opacity: matched ? 1 : 0.4 }}
        >
          {shortDate(row.commit.date)}
        </Text>
      ) : null}
      <Text
        style={{
          color: active ? c.accent : c.foregroundMuted,
          fontFamily: c.mono,
          fontSize: 11,
          width: 68,
          opacity: matched ? 1 : 0.4,
        }}
      >
        {row.commit.oid.slice(0, 8)}
      </Text>
    </Pressable>
  );
});
