import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { UsageCalendarStats, UsageHistogramBucket, UsageSessionScatterPoint, UsageTimeMatrix } from "../shared/usage";
import { calendarDates } from "./dashboard-data";
import { agentColor } from "./agents";

export type Theme = PluginScreenProps["theme"];

const HAIRLINE = 1;

const num = (theme: Theme): TextStyle => ({ color: theme.colors.foreground, fontVariant: ["tabular-nums"] });
const muted = (theme: Theme): TextStyle => ({ color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] });
const axis = (theme: Theme): TextStyle => ({ color: theme.colors.foregroundMuted, fontSize: 10, fontVariant: ["tabular-nums"] });

export function useWidth(): { width: number; onLayout: (event: { nativeEvent: { layout: { width: number } } }) => void } {
  const [width, setWidth] = useState(0);
  return { width, onLayout: (event) => setWidth(Math.round(event.nativeEvent.layout.width)) };
}

export function InfoTip({ theme, text, label }: { theme: Theme; text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const visible = open || hovered;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? text}
        accessibilityState={{ expanded: visible }}
        hitSlop={8}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => {
          setHovered(false);
          setOpen(false);
        }}
        onPress={() => setOpen((value) => !value)}
        style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="CircleHelp" size={15} color={theme.colors.foreground} />
      </Pressable>
      {visible ? (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{
            position: "absolute",
            top: 20,
            left: 0,
            right: 0,
            zIndex: 30,
            elevation: 8,
            backgroundColor: theme.colors.surface0,
            borderColor: theme.colors.border,
            borderWidth: 1,
            borderRadius: 8,
            paddingHorizontal: 9,
            paddingVertical: 7,
            shadowColor: "#000000",
            shadowOpacity: 0.18,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          <Text style={{ fontSize: 10, lineHeight: 14, color: theme.colors.foreground }}>{text}</Text>
        </View>
      ) : null}
    </>
  );
}

export function CardFrame({
  theme,
  title,
  trailing,
  children,
  footer,
  highlight = false,
  fill = false,
  info,
  infoLabel,
}: {
  theme: Theme;
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
  footer?: string;
  highlight?: boolean;
  fill?: boolean;
  info?: string;
  infoLabel?: string;
}) {
  return (
    <View
      style={{
        flex: fill ? 1 : undefined,
        minWidth: 0,
        backgroundColor: theme.colors.surface1,
        borderColor: highlight ? theme.colors.accent : theme.colors.border,
        borderWidth: HAIRLINE,
        borderRadius: 10,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, zIndex: 20 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ position: "relative", flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ flexShrink: 1, fontSize: 13, fontWeight: "600", color: theme.colors.foreground }}>{title}</Text>
            {info ? <InfoTip theme={theme} text={info} label={infoLabel} /> : null}
          </View>
        </View>
        {trailing}
      </View>
      {children}
      {footer ? <Text style={{ fontSize: 10, lineHeight: 14, color: theme.colors.foregroundMuted }}>{footer}</Text> : null}
    </View>
  );
}

export function Delta({
  theme,
  current,
  previous,
  invert = false,
  suffix = "",
  locale,
}: {
  theme: Theme;
  current: number;
  previous: number;
  invert?: boolean;
  suffix?: string;
  locale: "zh" | "en";
}) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || (current === 0 && previous === 0)) return null;
  if (previous <= 0) return <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{locale === "zh" ? "新增" : "new"}</Text>;
  const change = (current - previous) / previous;
  const up = change >= 0;
  const good = invert ? !up : up;
  const color = Math.abs(change) < 0.001 ? theme.colors.foregroundMuted : good ? theme.colors.statusSuccess : theme.colors.statusDanger;
  return (
    <Text style={{ fontSize: 10, color, fontVariant: ["tabular-nums"] }}>
      {up ? "↑" : "↓"}
      {`${Math.abs(change * 100).toFixed(Math.abs(change) >= 0.1 ? 0 : 1)}%`}
      {suffix}
    </Text>
  );
}

export function SparkTicks({ values, color, theme, height = 22 }: { values: readonly number[]; color: string; theme: Theme; height?: number }) {
  const peak = Math.max(1, ...values);
  return (
    <View accessibilityElementsHidden style={{ flexDirection: "row", alignItems: "flex-end", gap: 1.5, height }}>
      {values.map((value, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: value > 0 ? Math.max(2, (value / peak) * height) : 1,
            backgroundColor: value > 0 ? color : theme.colors.border,
            opacity: value > 0 ? (index === values.length - 1 ? 1 : 0.55) : 0.7,
          }}
        />
      ))}
    </View>
  );
}

export interface LedgerCell {
  key: string;
  label: string;
  value: string;
  sub?: string;
  delta?: { current: number; previous: number; invert?: boolean };
  spark?: { values: readonly number[]; color: string };
}

export function LedgerStrip({ theme, cells, compact, locale }: { theme: Theme; cells: readonly LedgerCell[]; compact: boolean; locale: "zh" | "en" }) {
  const columns = compact ? 2 : Math.min(5, Math.max(1, cells.length));
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", borderColor: theme.colors.border, borderWidth: HAIRLINE, borderRadius: 10, overflow: "hidden", backgroundColor: theme.colors.surface1 }}>
      {cells.map((cell, index) => {
        const row = Math.floor(index / columns);
        return (
          <View
            key={cell.key}
            style={{
              width: compact ? "50%" : `${100 / columns}%`,
              padding: 12,
              gap: 3,
              borderTopWidth: row > 0 ? HAIRLINE : 0,
              borderTopColor: theme.colors.border,
              borderLeftWidth: compact ? (index % 2 === 0 ? 0 : HAIRLINE) : index % columns === 0 ? 0 : HAIRLINE,
              borderLeftColor: theme.colors.border,
            }}
          >
            <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{cell.label}</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
              <Text style={{ fontSize: 22, lineHeight: 26, fontWeight: "700", color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{cell.value}</Text>
              {cell.delta ? <Delta theme={theme} current={cell.delta.current} previous={cell.delta.previous} invert={cell.delta.invert} locale={locale} /> : null}
            </View>
            {cell.sub ? <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{cell.sub}</Text> : null}
            {cell.spark ? <SparkTicks values={cell.spark.values} color={cell.spark.color} theme={theme} height={18} /> : null}
          </View>
        );
      })}
    </View>
  );
}

export function MetricSwitch<T extends string>({
  theme,
  value,
  options,
  onChange,
  compact = false,
}: {
  theme: Theme;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  compact?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={{
              paddingHorizontal: compact ? 7 : 9,
              paddingVertical: 3,
              borderRadius: 4,
              backgroundColor: active ? theme.colors.surface2 : "transparent",
              borderWidth: HAIRLINE,
              borderColor: active ? theme.colors.border : "transparent",
            }}
          >
            <Text style={{ fontSize: 10, color: active ? theme.colors.foreground : theme.colors.foregroundMuted, fontWeight: active ? "600" : "400" }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Empty({ theme, text }: { theme: Theme; text: string }) {
  return <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted, paddingVertical: 8 }}>{text}</Text>;
}

export function Legend({ theme, items }: { theme: Theme; items: ReadonlyArray<{ key: string; label: string; color: string }> }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {items.map((item) => (
        <View key={item.key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 7, height: 7, borderRadius: 1, backgroundColor: item.color }} />
          <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function ShareBar({ theme, segments, height = 8 }: { theme: Theme; segments: ReadonlyArray<{ key: string; value: number; color: string }>; height?: number }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  return (
    <View style={{ flexDirection: "row", height, borderRadius: 2, overflow: "hidden", backgroundColor: theme.colors.surface2, gap: total > 0 ? 1 : 0 }}>
      {total > 0
        ? segments
            .filter((segment) => segment.value > 0)
            .map((segment) => <View key={segment.key} style={{ flexGrow: segment.value / total, flexBasis: 0, minWidth: 2, backgroundColor: segment.color }} />)
        : null}
    </View>
  );
}

export function InlineBar({ theme, value, max, color, height = 5 }: { theme: Theme; value: number; max: number; color: string; height?: number }) {
  return (
    <View style={{ height, backgroundColor: theme.colors.surface2, borderRadius: 1, overflow: "hidden" }}>
      <View style={{ height, width: `${Math.max(value > 0 ? 2 : 0, Math.min(100, max > 0 ? (value / max) * 100 : 0))}%`, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

export interface StackedPoint {
  key: string;
  label: string;
  detail?: string;
  parts: readonly number[];
}

export function StackedColumns({
  theme,
  points,
  colors,
  names,
  height = 150,
  format,
  compact = false,
}: {
  theme: Theme;
  points: readonly StackedPoint[];
  colors: readonly string[];
  names: readonly string[];
  height?: number;
  format: (value: number) => string;
  compact?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const totals = points.map((point) => point.parts.reduce((sum, value) => sum + Math.max(0, value), 0));
  const peak = Math.max(1, ...totals);
  const shown = selected !== null && selected < points.length ? selected : points.length - 1;
  const active = points[shown];
  const labelEvery = Math.max(1, Math.ceil(points.length / (compact ? 6 : 10)));
  const gap = points.length > 40 ? 0 : 2;
  return (
    <View style={{ gap: 5 }}>
      <View style={{ height }}>
        {[0, 0.5, 1].map((step) => (
          <View key={step} style={{ position: "absolute", left: 40, right: 0, bottom: step * height, height: HAIRLINE, backgroundColor: theme.colors.border, opacity: step === 0 ? 1 : 0.6 }} />
        ))}
        {[0.5, 1].map((step) => (
          <Text key={step} style={[axis(theme), { position: "absolute", left: 0, width: 34, textAlign: "right", bottom: step * height - 6 }]}>
            {format(peak * step)}
          </Text>
        ))}
        <View style={{ position: "absolute", left: 40, right: 0, bottom: 0, height, flexDirection: "row", alignItems: "flex-end", gap }}>
          {points.map((point, index) => {
            const total = totals[index] ?? 0;
            const columnHeight = total > 0 ? Math.max(2, (total / peak) * height) : 0;
            return (
              <Pressable
                key={point.key}
                accessibilityRole="button"
                accessibilityLabel={`${point.label} ${format(total)}`}
                onPress={() => setSelected(selected === index ? null : index)}
                style={{ flex: 1, height, justifyContent: "flex-end", alignItems: "center", opacity: selected !== null && selected !== index ? 0.45 : 1 }}
              >
                {columnHeight > 0 ? (
                  <View style={{ width: "72%", height: columnHeight, flexDirection: "column-reverse", borderRadius: 1, overflow: "hidden" }}>
                    {point.parts.map((part, partIndex) =>
                      part > 0 ? <View key={partIndex} style={{ height: (part / peak) * height, backgroundColor: colors[partIndex] ?? colors[0] }} /> : null,
                    )}
                  </View>
                ) : (
                  <View style={{ width: "72%", height: 1, backgroundColor: theme.colors.border }} />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ flexDirection: "row", marginLeft: 40, gap }}>
        {points.map((point, index) => (
          <View key={point.key} style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[axis(theme), { textAlign: "center", color: index === shown ? theme.colors.foreground : theme.colors.foregroundMuted }]}>
              {index % labelEvery === 0 || index === points.length - 1 ? point.label : ""}
            </Text>
          </View>
        ))}
      </View>
      {active ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>{active.detail ?? active.label}</Text>
          <Text style={[num(theme), { fontSize: 11, fontWeight: "700" }]}>{format(totals[shown] ?? 0)}</Text>
          {active.parts.map((part, index) =>
            part > 0 ? (
              <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: colors[index] }} />
                <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{names[index]} {format(part)}</Text>
              </View>
            ) : null,
          )}
        </View>
      ) : null}
    </View>
  );
}

function Segment({ x1, y1, x2, y2, color, width = 2, dashed = false }: { x1: number; y1: number; x2: number; y2: number; color: string; width?: number; dashed?: boolean }) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  if (dashed) {
    const dots = Math.max(1, Math.floor(length / 7));
    return (
      <>
        {Array.from({ length: dots }, (_, index) => {
          const ratio = (index + 0.5) / dots;
          return (
            <View
              key={index}
              pointerEvents="none"
              style={{ position: "absolute", left: x1 + (x2 - x1) * ratio - 1.5, top: y1 + (y2 - y1) * ratio - 1.5, width: 3, height: 3, borderRadius: 1.5, backgroundColor: color }}
            />
          );
        })}
      </>
    );
  }
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x1 + (x2 - x1) / 2 - length / 2,
        top: y1 + (y2 - y1) / 2 - width / 2,
        width: length,
        height: width,
        borderRadius: width / 2,
        backgroundColor: color,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

export interface TrendPoint {
  label: string;
  value: number;
  detail?: string;
}

export function TrendChart({
  theme,
  points,
  color,
  format,
  height = 160,
  mode = "bars",
  average = true,
  forecast = [],
  compact = false,
  target,
  targetLabel,
  secondary = [],
  secondaryFormat,
  secondaryColor,
  secondaryLabel,
}: {
  theme: Theme;
  points: readonly TrendPoint[];
  color: string;
  format: (value: number) => string;
  height?: number;
  mode?: "bars" | "line";
  average?: boolean;
  forecast?: readonly TrendPoint[];
  compact?: boolean;
  target?: number;
  targetLabel?: string;
  secondary?: readonly TrendPoint[];
  secondaryFormat?: (value: number) => string;
  secondaryColor?: string;
  secondaryLabel?: string;
}) {
  const { width, onLayout } = useWidth();
  const [selected, setSelected] = useState<number | null>(null);
  const all = [...points, ...forecast];
  const peak = Math.max(1, ...all.map((point) => point.value), ...points.map((point) => point.value), target ?? 0);
  const padTop = 10;
  const padBottom = 20;
  const axisWidth = 38;
  const plotWidth = Math.max(1, width - axisWidth);
  const plotHeight = height - padTop - padBottom;
  const column = all.length > 0 ? plotWidth / all.length : 0;
  const x = (index: number) => axisWidth + column * index + column / 2;
  const y = (value: number) => padTop + plotHeight - (value / peak) * plotHeight;
  const averages = useMemo(
    () => points.map((_, index) => {
      const window = points.slice(Math.max(0, index - 6), index + 1);
      return window.reduce((sum, point) => sum + point.value, 0) / Math.max(1, window.length);
    }),
    [points],
  );
  const secondaryPeak = Math.max(1, ...secondary.map((point) => point.value));
  const ySecondary = (value: number) => padTop + plotHeight - (value / secondaryPeak) * plotHeight;
  const shown = selected !== null && selected < points.length ? selected : points.length - 1;
  const active = points[shown];
  const labelEvery = Math.max(1, Math.ceil(all.length / (compact ? 5 : 9)));
  return (
    <View style={{ gap: 6 }}>
      <View onLayout={onLayout} style={{ height }}>
        {[0, 0.5, 1].map((step) => (
          <View key={step} style={{ position: "absolute", left: axisWidth, right: 0, top: y(peak * step), height: HAIRLINE, backgroundColor: theme.colors.border, opacity: step === 0 ? 1 : 0.55 }} />
        ))}
        {[0.5, 1].map((step) => (
          <Text key={step} style={[axis(theme), { position: "absolute", left: 0, width: axisWidth - 5, textAlign: "right", top: y(peak * step) - 6 }]}>
            {format(peak * step)}
          </Text>
        ))}
        {width > 0
          ? all.map((point, index) => {
              const future = index >= points.length;
              const barHeight = point.value > 0 ? Math.max(2, (point.value / peak) * plotHeight) : 0;
              return (
                <Pressable
                  key={`${point.label}-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${point.label} ${format(point.value)}`}
                  onPress={() => setSelected(index < points.length ? index : null)}
                  style={{
                    position: "absolute",
                    left: axisWidth + column * index,
                    width: Math.max(2, column),
                    top: padTop,
                    height: plotHeight,
                    alignItems: "center",
                    justifyContent: "flex-end",
                    backgroundColor: index === shown ? theme.colors.surface2 : "transparent",
                  }}
                >
                  {mode === "bars" && barHeight > 0 ? (
                    <View
                      style={{
                        width: Math.max(2, Math.min(18, column * 0.62)),
                        height: barHeight,
                        backgroundColor: future ? "transparent" : color,
                        borderColor: future ? color : "transparent",
                        borderWidth: future ? 1 : 0,
                        borderStyle: future ? "dashed" : "solid",
                        borderRadius: 1,
                        opacity: future ? 0.55 : 0.9,
                      }}
                    />
                  ) : null}
                </Pressable>
              );
            })
          : null}
        {width > 0 && mode === "line"
          ? points.slice(1).map((point, index) => (
              <Segment key={`line-${index}`} x1={x(index)} y1={y(points[index]?.value ?? 0)} x2={x(index + 1)} y2={y(point.value)} color={color} width={2} />
            ))
          : null}
        {width > 0 && secondary.length > 0 && secondaryColor
          ? secondary.slice(1).map((point, index) => (
              <Segment key={`secondary-${index}`} x1={x(index)} y1={ySecondary(secondary[index]?.value ?? 0)} x2={x(index + 1)} y2={ySecondary(point.value)} color={secondaryColor} width={1.5} />
            ))
          : null}
        {width > 0 && secondary.length > 0 && secondaryFormat ? (
          <>
            <Text style={[axis(theme), { position: "absolute", right: 0, top: padTop - 4, textAlign: "right", fontSize: 8 }]}>{secondaryFormat(secondaryPeak)}</Text>
            <Text style={[axis(theme), { position: "absolute", right: 0, top: padTop + plotHeight - 10, textAlign: "right", fontSize: 8 }]}>0</Text>
          </>
        ) : null}
        {width > 0 && target !== undefined && target > 0 ? (
          <>
            <Segment x1={axisWidth} y1={y(target)} x2={axisWidth + plotWidth} y2={y(target)} color={theme.colors.statusWarning} width={1} dashed />
            <Text style={[axis(theme), { position: "absolute", right: 0, top: y(target) - 12, color: theme.colors.statusWarning }]}>{targetLabel ?? format(target)}</Text>
          </>
        ) : null}
        {width > 0 && average && points.length > 1
          ? averages.slice(1).map((value, index) => (
              <Segment key={`avg-${index}`} x1={x(index)} y1={y(averages[index] ?? 0)} x2={x(index + 1)} y2={y(value)} color={theme.colors.foregroundMuted} width={1} dashed />
            ))
          : null}
        {width > 0 && forecast.length > 0
          ? forecast.map((point, index) => {
              const from = index === 0 ? { x: x(points.length - 1), y: y(points[points.length - 1]?.value ?? 0) } : { x: x(points.length + index - 1), y: y(forecast[index - 1]?.value ?? 0) };
              return <Segment key={`forecast-${index}`} x1={from.x} y1={from.y} x2={x(points.length + index)} y2={y(point.value)} color={color} width={1} dashed />;
            })
          : null}
        {width > 0 && mode === "line" && selected !== null
          ? <View pointerEvents="none" style={{ position: "absolute", left: x(selected) - 3.5, top: y(points[selected]?.value ?? 0) - 3.5, width: 7, height: 7, borderRadius: 4, backgroundColor: color, borderWidth: 2, borderColor: theme.colors.surface1 }} />
          : null}
        {width > 0
          ? all.map((point, index) =>
              index % labelEvery === 0 || index === all.length - 1 ? (
                <Text key={`label-${index}`} numberOfLines={1} style={[axis(theme), { position: "absolute", top: padTop + plotHeight + 4, left: x(index) - 24, width: 48, textAlign: "center", color: index === shown ? theme.colors.foreground : theme.colors.foregroundMuted }]}>
                  {point.label}
                </Text>
              ) : null,
            )
          : null}
      </View>
      {active ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <View style={{ width: 8, height: 2, backgroundColor: color }} />
          <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>{active.label}</Text>
          <Text style={[num(theme), { fontSize: 11, fontWeight: "700" }]}>{format(active.value)}</Text>
          {active.detail ? <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{active.detail}</Text> : null}
          {secondary[shown] && secondaryFormat && secondaryColor ? (
            <Text style={{ fontSize: 10, color: secondaryColor }}>
              {secondaryLabel ? `${secondaryLabel} ` : ""}{secondaryFormat(secondary[shown]?.value ?? 0)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Donut({ size, stroke, segments, track, gap = 2, children }: { size: number; stroke: number; segments: ReadonlyArray<{ value: number; color: string }>; track: string; gap?: number; children?: ReactNode }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const arcs: Array<{ start: number; sweep: number; color: string }> = [];
  let angle = 0;
  for (const segment of segments) {
    const sweep = total > 0 ? (Math.max(0, segment.value) / total) * 360 : 0;
    const visible = Math.max(0, sweep - (segments.length > 1 ? gap : 0));
    for (let offset = 0; offset < visible - 0.01; offset += 180) {
      arcs.push({ start: angle + offset, sweep: Math.min(180, visible - offset), color: segment.color });
    }
    angle += sweep;
  }
  const ring: ViewStyle = { position: "absolute", left: 0, top: 0, width: size, height: size, borderRadius: size / 2, borderWidth: stroke };
  return (
    <View style={{ width: size, height: size }}>
      <View style={[ring, { borderColor: track }]} />
      {arcs.map((arc, index) => (
        <View key={index} style={{ position: "absolute", left: 0, top: 0, width: size, height: size, transform: [{ rotate: `${arc.start}deg` }] }}>
          <View style={{ position: "absolute", left: size / 2, top: 0, width: size / 2, height: size, overflow: "hidden" }}>
            <View
              style={[
                ring,
                {
                  left: -size / 2,
                  borderTopColor: arc.color,
                  borderRightColor: arc.color,
                  borderBottomColor: "transparent",
                  borderLeftColor: "transparent",
                  transform: [{ rotate: `${45 + arc.sweep - 180}deg` }],
                },
              ]}
            />
          </View>
        </View>
      ))}
      {children ? <View style={{ position: "absolute", left: 0, top: 0, width: size, height: size, alignItems: "center", justifyContent: "center" }}>{children}</View> : null}
    </View>
  );
}

export function Dial({ theme, size = 132, stroke = 14, segments, center }: { theme: Theme; size?: number; stroke?: number; segments: ReadonlyArray<{ value: number; color: string }>; center?: ReactNode }) {
  return (
    <Donut size={size} stroke={stroke} segments={segments} track={theme.colors.surface2} gap={2}>
      {center}
    </Donut>
  );
}

export interface RankRow {
  key: string;
  label: string;
  sub?: string;
  value: number;
  color?: string;
  extra?: string;
}

export function RankedRows({
  theme,
  rows,
  format,
  limit = 6,
  compact = false,
  emptyText,
  onExpand,
  locale,
}: {
  theme: Theme;
  rows: readonly RankRow[];
  format: (value: number) => string;
  limit?: number;
  compact?: boolean;
  emptyText: string;
  onExpand?: (expanded: boolean) => void;
  locale: "zh" | "en";
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return <Empty theme={theme} text={emptyText} />;
  const max = Math.max(1, ...rows.map((row) => row.value));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const shown = expanded ? rows : rows.slice(0, limit);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    onExpand?.(next);
  };
  return (
    <View>
      {shown.map((row, index) => (
        <View key={row.key} style={{ paddingVertical: 7, gap: 4, borderTopWidth: index === 0 ? 0 : HAIRLINE, borderTopColor: theme.colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Text style={{ width: 18, textAlign: "right", fontSize: 10, color: index < 3 ? theme.colors.foreground : theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{index + 1}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>{row.label}</Text>
              {row.sub ? <Text numberOfLines={1} style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{row.sub}</Text> : null}
            </View>
            {row.extra ? <Text numberOfLines={1} style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{row.extra}</Text> : null}
            <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{format(row.value)}</Text>
            <Text style={{ width: 36, textAlign: "right", fontSize: 9, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{total > 0 ? `${Math.round((row.value / total) * 100)}%` : "—"}</Text>
          </View>
          <View style={{ marginLeft: 25 }}>
            <InlineBar theme={theme} value={row.value} max={max} color={row.color ?? theme.colors.foregroundMuted} height={4} />
          </View>
        </View>
      ))}
      {rows.length > limit ? (
        <Pressable accessibilityRole="button" onPress={toggle} style={{ paddingTop: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{expanded ? (locale === "zh" ? "收起" : "Collapse") : locale === "zh" ? `展开全部 ${rows.length}` : `Show all ${rows.length}`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Histogram({
  theme,
  buckets,
  format,
  color,
  height = 100,
}: {
  theme: Theme;
  buckets: readonly UsageHistogramBucket[];
  format: (from: number, to: number | null) => string;
  color: string;
  height?: number;
}) {
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height }}>
        {buckets.map((bucket, index) => (
          <View key={index} style={{ flex: 1, height, justifyContent: "flex-end", alignItems: "center", gap: 3 }}>
            <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{bucket.count > 0 ? bucket.count : ""}</Text>
            <View
              style={{
                width: "76%",
                height: bucket.count > 0 ? Math.max(2, (bucket.count / peak) * (height - 18)) : 1,
                backgroundColor: bucket.count > 0 ? color : theme.colors.border,
                borderRadius: 1,
                opacity: 0.9,
              }}
            />
            <Text numberOfLines={1} style={{ fontSize: 8, color: theme.colors.foregroundMuted }}>{format(bucket.from, bucket.to)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface ScatterPoint {
  key: string;
  x: number;
  y: number;
  color?: string;
  label?: string;
  size?: number;
}

export function ScatterPlot({
  theme,
  points,
  xLabel,
  yLabel,
  formatX,
  formatY,
  height = 180,
  logX = false,
  logY = false,
}: {
  theme: Theme;
  points: readonly ScatterPoint[];
  xLabel: string;
  yLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  height?: number;
  logX?: boolean;
  logY?: boolean;
}) {
  const { width, onLayout } = useWidth();
  const padLeft = 42;
  const padBottom = 24;
  const padTop = 8;
  const plotWidth = Math.max(1, width - padLeft - 8);
  const plotHeight = height - padBottom - padTop;
  const tx = (value: number) => (logX ? Math.log1p(Math.max(0, value)) : value);
  const ty = (value: number) => (logY ? Math.log1p(Math.max(0, value)) : value);
  const rawMinX = Math.min(...points.map((point) => point.x), 0);
  const rawMaxX = Math.max(...points.map((point) => point.x), 1);
  const rawMinY = Math.min(...points.map((point) => point.y), 0);
  const rawMaxY = Math.max(...points.map((point) => point.y), 1);
  const minX = tx(rawMinX);
  const maxX = tx(rawMaxX);
  const minY = ty(rawMinY);
  const maxY = ty(rawMaxY);
  const px = (value: number) => padLeft + ((tx(value) - minX) / Math.max(1e-9, maxX - minX)) * plotWidth;
  const py = (value: number) => padTop + plotHeight - ((ty(value) - minY) / Math.max(1e-9, maxY - minY)) * plotHeight;
  return (
    <View style={{ gap: 4 }}>
      <View onLayout={onLayout} style={{ height }}>
        <View style={{ position: "absolute", left: padLeft, right: 0, bottom: padBottom, height: HAIRLINE, backgroundColor: theme.colors.border }} />
        <View style={{ position: "absolute", left: padLeft, top: padTop, bottom: padBottom, width: HAIRLINE, backgroundColor: theme.colors.border }} />
        {width > 0
          ? points.map((point) => (
              <View
                key={point.key}
                style={{
                  position: "absolute",
                  left: px(point.x) - (point.size ?? 3),
                  top: py(point.y) - (point.size ?? 3),
                  width: (point.size ?? 3) * 2,
                  height: (point.size ?? 3) * 2,
                  borderRadius: point.size ?? 3,
                  backgroundColor: point.color ?? theme.colors.foreground,
                  opacity: 0.75,
                  borderWidth: 1,
                  borderColor: theme.colors.surface1,
                }}
              />
            ))
          : null}
        <Text style={[axis(theme), { position: "absolute", left: 0, bottom: padBottom - 3, width: padLeft - 4, textAlign: "right" }]}>{formatY(rawMinY)}</Text>
        <Text style={[axis(theme), { position: "absolute", left: 0, top: padTop - 3, width: padLeft - 4, textAlign: "right" }]}>{formatY(rawMaxY)}</Text>
        <Text style={[axis(theme), { position: "absolute", left: padLeft, bottom: 2 }]}>{formatX(rawMinX)}</Text>
        <Text style={[axis(theme), { position: "absolute", right: 0, bottom: 2 }]}>{formatX(rawMaxX)}</Text>
        <Text style={[axis(theme), { position: "absolute", left: padLeft, top: 0 }]}>{yLabel}</Text>
        <Text style={[axis(theme), { position: "absolute", right: 0, bottom: padBottom, fontSize: 9 }]}>{xLabel}</Text>
      </View>
    </View>
  );
}

function tierOpacity(value: number, peak: number): number {
  if (value <= 0) return 0;
  return 0.2 + Math.min(1, value / Math.max(1, peak)) * 0.8;
}

export function CalendarDots({
  theme,
  calendar,
  values,
  color,
  compact = false,
  locale = "zh",
  formatValue = (value) => String(value),
}: {
  theme: Theme;
  calendar: UsageCalendarStats;
  values: readonly number[];
  color: string;
  compact?: boolean;
  locale?: "zh" | "en";
  formatValue?: (value: number) => string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const dates = useMemo(() => calendarDates(calendar), [calendar]);
  const weeks = Math.ceil(dates.length / 7);
  const cell = compact ? 7 : 9;
  const gap = 2;
  const peak = Math.max(1, ...values);
  const monthCells: Array<{ week: number; label: string }> = [];
  let lastMonth = -1;
  for (let week = 0; week < weeks; week += 1) {
    const date = dates[week * 7];
    if (!date) continue;
    const month = Number(date.slice(5, 7));
    if (month !== lastMonth) {
      monthCells.push({ week, label: String(month) });
      lastMonth = month;
    }
  }
  const active = selected !== null ? selected : values.length - 1;
  return (
    <View style={{ gap: 5 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 2 }}>
        <View style={{ gap: 3 }}>
          <View style={{ height: 12, marginLeft: 18, width: weeks * (cell + gap) }}>
            {monthCells.map((item) => (
              <Text key={`${item.week}-${item.label}`} style={{ position: "absolute", left: item.week * (cell + gap), fontSize: 8, color: theme.colors.foregroundMuted }}>{item.label}</Text>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap }}>
            <View style={{ width: 16, gap }}>
              {(locale === "zh" ? ["一", "二", "三", "四", "五", "六", "日"] : ["M", "T", "W", "T", "F", "S", "S"]).map((label, index) => (
                <Text key={index} style={{ height: cell, lineHeight: cell, fontSize: 7, color: theme.colors.foregroundMuted, opacity: index % 2 === 0 ? 1 : 0 }}>{label}</Text>
              ))}
            </View>
            {Array.from({ length: weeks }, (_, week) => (
              <View key={week} style={{ gap }}>
                {Array.from({ length: 7 }, (_, weekday) => {
                  const index = week * 7 + weekday;
                  const value = values[index] ?? 0;
                  const date = dates[index];
                  if (!date) return <View key={weekday} style={{ width: cell, height: cell }} />;
                  return (
                    <Pressable
                      key={weekday}
                      accessibilityRole="button"
                      accessibilityLabel={`${date} ${formatValue(value)}`}
                      onPress={() => setSelected(index)}
                      style={{
                        width: cell,
                        height: cell,
                        borderRadius: cell / 2,
                        backgroundColor: value > 0 ? color : theme.colors.surface2,
                        opacity: value > 0 ? tierOpacity(value, peak) : 0.55,
                        borderWidth: index === active ? 1 : 0,
                        borderColor: theme.colors.foreground,
                      }}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {dates[active] ? `${dates[active]} · ${formatValue(values[active] ?? 0)}` : "—"}
      </Text>
    </View>
  );
}

export function Punchcard({ theme, matrix, values, color, compact = false, locale = "zh", formatValue = (value) => String(value) }: { theme: Theme; matrix: UsageTimeMatrix; values: readonly number[]; color: string; compact?: boolean; locale?: "zh" | "en"; formatValue?: (value: number) => string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const cell = compact ? 6 : 10;
  const gap = 2;
  const peak = Math.max(1, ...values);
  const peakIndex = values.reduce((best, value, index) => (value > (values[best] ?? 0) ? index : best), 0);
  const active = selected !== null ? selected : peakIndex;
  return (
    <View style={{ gap: 5 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap }}>
        <View style={{ gap }}>
          {(locale === "zh" ? ["一", "二", "三", "四", "五", "六", "日"] : ["M", "T", "W", "T", "F", "S", "S"]).map((label, weekday) => (
            <View key={weekday} style={{ flexDirection: "row", alignItems: "center", gap }}>
              <Text style={{ width: 14, fontSize: 8, color: theme.colors.foregroundMuted }}>{label}</Text>
              {Array.from({ length: 24 }, (_, hour) => {
                const index = weekday * 24 + hour;
                const value = values[index] ?? 0;
                return (
                  <Pressable
                    key={hour}
                    accessibilityRole="button"
                    accessibilityLabel={`${label} ${hour}:00 ${formatValue(value)}`}
                    onPress={() => setSelected(index)}
                    style={{
                      width: cell,
                      height: cell,
                      borderRadius: cell / 2,
                      backgroundColor: value > 0 ? color : theme.colors.surface2,
                      opacity: value > 0 ? tierOpacity(value, peak) : 0.55,
                      borderWidth: index === active && value > 0 ? 1 : 0,
                      borderColor: theme.colors.foreground,
                    }}
                  />
                );
              })}
            </View>
          ))}
          <View style={{ flexDirection: "row", marginLeft: 14 + gap, height: 12 }}>
            {[0, 6, 12, 18].map((hour) => (
              <Text key={hour} style={{ position: "absolute", left: hour * (cell + gap), fontSize: 8, color: theme.colors.foregroundMuted }}>{String(hour).padStart(2, "0")}</Text>
            ))}
          </View>
        </View>
      </ScrollView>
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {`${String(active % 24).padStart(2, "0")}:00 · ${formatValue(values[active] ?? 0)}`}
      </Text>
    </View>
  );
}

export function MatrixHeatmap({
  theme,
  rows,
  cols,
  values,
  color,
  format,
  rowLabel,
  colLabel,
  compact = false,
  locale,
}: {
  theme: Theme;
  rows: readonly string[];
  cols: readonly string[];
  values: readonly (readonly number[])[];
  color: string;
  format: (value: number) => string;
  rowLabel: (key: string) => string;
  colLabel: (key: string) => string;
  compact?: boolean;
  locale: "zh" | "en";
}) {
  const max = Math.max(1, ...values.flat());
  if (rows.length === 0 || cols.length === 0) return <Empty theme={theme} text={locale === "zh" ? "当前范围没有可对比的数据。" : "Nothing to compare in this range."} />;
  const cell = compact ? 16 : 22;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ gap: 3 }}>
        <View style={{ flexDirection: "row", marginLeft: 54, gap: 2 }}>
          {cols.map((col) => (
            <Text key={col} numberOfLines={1} style={{ width: cell, fontSize: 8, color: theme.colors.foregroundMuted, textAlign: "center" }}>{colLabel(col).slice(0, compact ? 3 : 6)}</Text>
          ))}
        </View>
        {rows.map((row, rowIndex) => (
          <View key={row} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Text numberOfLines={1} style={{ width: 50, fontSize: 9, color: theme.colors.foregroundMuted }}>{rowLabel(row)}</Text>
            {cols.map((col, colIndex) => {
              const value = values[rowIndex]?.[colIndex] ?? 0;
              return (
                <View
                  key={col}
                  accessibilityLabel={`${rowLabel(row)} ${colLabel(col)} ${format(value)}`}
                  style={{
                    width: cell,
                    height: cell,
                    borderRadius: 2,
                    backgroundColor: value > 0 ? color : theme.colors.surface2,
                    opacity: value > 0 ? 0.2 + Math.min(1, value / max) * 0.8 : 0.55,
                  }}
                />
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function Swimlane({ theme, sessions, compact = false, locale }: { theme: Theme; sessions: readonly UsageSessionScatterPoint[]; compact?: boolean; locale: "zh" | "en" }) {
  const sorted = useMemo(() => [...sessions].sort((a, b) => a.start - b.start), [sessions]);
  if (sorted.length === 0) return <Empty theme={theme} text={locale === "zh" ? "当前范围没有会话。" : "No sessions in this range."} />;
  const min = Math.min(...sorted.map((session) => session.start));
  const max = Math.max(...sorted.map((session) => session.start + session.durationMs));
  const span = Math.max(1, max - min);
  const agents = [...new Set(sorted.map((session) => session.agent))].sort();
  const rowHeight = compact ? 16 : 20;
  return (
    <View style={{ gap: 5 }}>
      <View style={{ marginLeft: 52, height: 14 }}>
        {[0, 0.5, 1].map((ratio) => (
          <Text key={ratio} style={{ position: "absolute", left: `${ratio * 100}%`, transform: [{ translateX: ratio === 0 ? 0 : -16 }], fontSize: 8, color: theme.colors.foregroundMuted }}>
            {span > 2 * 86_400_000
              ? new Date(min + span * ratio).toLocaleDateString([], { month: "2-digit", day: "2-digit" })
              : new Date(min + span * ratio).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        ))}
      </View>
      {agents.map((agent) => {
        const items = sorted.filter((session) => session.agent === agent);
        return (
          <View key={agent} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ width: 48, fontSize: 9, color: theme.colors.foregroundMuted }}>{agent}</Text>
            <View style={{ flex: 1, height: rowHeight, backgroundColor: theme.colors.surface2, borderRadius: 2, overflow: "hidden" }}>
              {items.map((session) => {
                const left = ((session.start - min) / span) * 100;
                const width = Math.max(0.6, (session.durationMs / span) * 100);
                return (
                  <View
                    key={session.id}
                    accessibilityLabel={`${session.project} ${formatDuration(session.durationMs)} ${session.tokens}`}
                    style={{
                      position: "absolute",
                      left: `${left}%`,
                      width: `${Math.min(100 - left, width)}%`,
                      top: 5,
                      bottom: 5,
                      backgroundColor: agentColor(agent),
                      borderRadius: 1,
                      opacity: 0.75,
                    }}
                  />
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export interface TreemapItem {
  key: string;
  label: string;
  value: number;
  parts?: ReadonlyArray<{ key: string; value: number; color: string }>;
}

export function Treemap({ theme, items, compact = false, locale }: { theme: Theme; items: readonly TreemapItem[]; compact?: boolean; locale: "zh" | "en" }) {
  const visible = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const total = visible.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return <Empty theme={theme} text={locale === "zh" ? "当前范围没有可展示的占比。" : "Nothing to show in this range."} />;
  const height = compact ? 90 : 120;
  return (
    <View style={{ flexDirection: "row", height, gap: 1, borderRadius: 2, overflow: "hidden", backgroundColor: theme.colors.surface2 }}>
      {visible.map((item) => {
        const width = (item.value / total) * 100;
        return (
          <View key={item.key} style={{ width: `${width}%`, height, overflow: "hidden", backgroundColor: theme.colors.surface2 }}>
            <View style={{ flexDirection: "row", flex: 1 }}>
              {item.parts?.filter((part) => part.value > 0).map((part) => (
                <View key={part.key} style={{ flexGrow: part.value, flexBasis: 0, backgroundColor: part.color, opacity: 0.85 }} />
              )) ?? <View style={{ flex: 1, backgroundColor: theme.colors.foregroundMuted, opacity: 0.35 }} />}
            </View>
            {width > 7 ? (
              <View style={{ position: "absolute", left: 4, right: 4, top: 4, gap: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 9, fontWeight: "600", color: "#ffffff" }}>{item.label}</Text>
                {!compact && width > 12 ? <Text numberOfLines={1} style={{ fontSize: 8, color: "rgba(255,255,255,0.8)" }}>{Math.round(width)}%</Text> : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function BudgetBar({ theme, ratio, color }: { theme: Theme; ratio: number; color: string }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <View style={{ height: 8, borderRadius: 2, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
      <View style={{ height: 8, width: `${clamped * 100}%`, backgroundColor: ratio > 1 ? theme.colors.statusDanger : color, borderRadius: 2 }} />
    </View>
  );
}

type Point = { x: number; y: number };

function Triangle({ a, b, c, color }: { a: Point; b: Point; c: Point; color: string }) {
  const sides: Array<[Point, Point, Point]> = [[a, b, c], [b, c, a], [c, a, b]];
  let [p, q, apex] = sides.reduce((best, side) => (Math.hypot(side[1].x - side[0].x, side[1].y - side[0].y) > Math.hypot(best[1].x - best[0].x, best[1].y - best[0].y) ? side : best));
  let angle = Math.atan2(q.y - p.y, q.x - p.x);
  if ((apex.x - p.x) * Math.sin(angle) - (apex.y - p.y) * Math.cos(angle) < 0) {
    [p, q] = [q, p];
    angle = Math.atan2(q.y - p.y, q.x - p.x);
  }
  const base = Math.hypot(q.x - p.x, q.y - p.y);
  if (base < 0.5) return null;
  const along = ((apex.x - p.x) * (q.x - p.x) + (apex.y - p.y) * (q.y - p.y)) / base;
  const height = Math.abs(((q.x - p.x) * (apex.y - p.y) - (q.y - p.y) * (apex.x - p.x)) / base);
  if (height < 0.5) return null;
  return (
    <View
      style={{
        position: "absolute",
        left: p.x,
        top: p.y - height,
        width: 0,
        height: 0,
        borderStyle: "solid",
        borderLeftWidth: Math.max(0, along),
        borderRightWidth: Math.max(0, base - along),
        borderBottomWidth: height,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: color,
        transformOrigin: "0% 100%",
        transform: [{ rotate: `${(angle * 180) / Math.PI}deg` }],
      } as ViewStyle}
    />
  );
}

export function Radar({
  theme,
  axes,
  series,
  size = 240,
}: {
  theme: Theme;
  axes: readonly string[];
  series: ReadonlyArray<{ key: string; color: string; values: readonly number[] }>;
  size?: number;
}) {
  const count = axes.length;
  const pad = 34;
  const radius = size / 2 - pad;
  const center = { x: size / 2, y: size / 2 };
  const at = (index: number, value: number): Point => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, count);
    const r = radius * Math.min(1, Math.max(0, value));
    return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
  };
  const grid = theme.colors.border;
  return (
    <View accessibilityElementsHidden style={{ width: size, height: size }}>
      {[0.25, 0.5, 0.75, 1].map((level) =>
        axes.map((_, index) => {
          const from = at(index, level);
          const to = at((index + 1) % count, level);
          return <Segment key={`${level}:${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} color={grid} width={1} />;
        }),
      )}
      {series.map((item) =>
        item.values.map((value, index) => (
          <Triangle key={`${item.key}:fill:${index}`} a={center} b={at(index, value)} c={at((index + 1) % count, item.values[(index + 1) % count] ?? 0)} color={`${item.color}33`} />
        )),
      )}
      {axes.map((_, index) => {
        const end = at(index, 1);
        return <Segment key={`spoke:${index}`} x1={center.x} y1={center.y} x2={end.x} y2={end.y} color={grid} width={1} />;
      })}
      {series.map((item) =>
        item.values.map((value, index) => {
          const from = at(index, value);
          const to = at((index + 1) % count, item.values[(index + 1) % count] ?? 0);
          return <Segment key={`${item.key}:edge:${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} color={item.color} width={2} />;
        }),
      )}
      {series.map((item) =>
        item.values.map((value, index) => {
          const point = at(index, value);
          return <View key={`${item.key}:dot:${index}`} style={{ position: "absolute", left: point.x - 3, top: point.y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: item.color }} />;
        }),
      )}
      {axes.map((label, index) => {
        const point = at(index, 1);
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, count);
        const x = point.x + Math.cos(angle) * 16;
        const y = point.y + Math.sin(angle) * 12;
        return (
          <Text key={`label:${index}`} numberOfLines={1} style={{ position: "absolute", left: x - 32, top: y - 7, width: 64, textAlign: "center", color: theme.colors.foreground, fontSize: 9 }}>
            {label}
          </Text>
        );
      })}
    </View>
  );
}
