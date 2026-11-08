import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Pressable, Text, View } from "react-native";
import { useI18n } from "./i18n";

type Theme = PluginSurfaceProps["theme"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

const WEEK_LABELS: Record<"zh" | "en", string[]> = {
  zh: ["一", "二", "三", "四", "五", "六", "日"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
};

export function DateRangePicker({
  theme,
  compact,
  from,
  to,
  onChange,
}: {
  theme: Theme;
  compact: boolean;
  from: string;
  to: string;
  onChange(next: { from: string; to: string }): void;
}) {
  const [month, setMonth] = useState(() => {
    const anchor = parseKey(from) ?? new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });
  const styles = useMemo(
    () =>
      ({
        section: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 8 },
        header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
        navButton: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, backgroundColor: theme.colors.surface0 },
        navText: { fontSize: 14, color: theme.colors.foreground },
        monthText: { fontSize: 13, fontWeight: "600", color: theme.colors.foreground },
        weekRow: { flexDirection: "row" },
        weekLabel: { flex: 1, textAlign: "center", fontSize: 10, color: theme.colors.foregroundMuted },
        row: { flexDirection: "row" },
        cell: { flex: 1, alignItems: "center", paddingVertical: 3 },
        cellInner: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
        cellInRange: { backgroundColor: theme.colors.surface0 },
        cellSelected: { backgroundColor: theme.colors.accent },
        cellText: { fontSize: 12, color: theme.colors.foreground },
        cellTextMuted: { color: theme.colors.foregroundMuted, opacity: 0.45 },
        cellTextSelected: { color: theme.colors.accentForeground, fontWeight: "600" },
        cellTextToday: { color: theme.colors.accent, fontWeight: "600" },
        footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
        rangeText: { fontSize: 11, color: theme.colors.foregroundMuted },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme, compact],
  );

  const weeks = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = addDays(first, -offset);
    const rows: Array<Array<{ key: string; day: number; inMonth: boolean }>> = [];
    for (let row = 0; row < 6; row += 1) {
      const cells: Array<{ key: string; day: number; inMonth: boolean }> = [];
      for (let column = 0; column < 7; column += 1) {
        const date = addDays(start, row * 7 + column);
        cells.push({ key: dateKeyOf(date), day: date.getDate(), inMonth: date.getMonth() === month.getMonth() });
      }
      rows.push(cells);
    }
    return rows;
  }, [month]);

  const { locale, t } = useI18n();
  const weekLabels = WEEK_LABELS[locale];
  const todayKey = dateKeyOf(new Date());

  const pick = (key: string) => {
    if (!parseKey(key)) return;
    if (!from || (from && to)) {
      onChange({ from: key, to: "" });
      return;
    }
    if (key < from) {
      onChange({ from: key, to: "" });
      return;
    }
    onChange({ from, to: key });
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Pressable style={styles.navButton} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.monthText}>{t("date.ym", { year: month.getFullYear(), month: month.getMonth() + 1 })}</Text>
        <Pressable style={styles.navButton} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>
      <View style={styles.weekRow}>
        {weekLabels.map((label) => (
          <Text key={label} style={styles.weekLabel}>
            {label}
          </Text>
        ))}
      </View>
      {weeks.map((week, index) => (
        <View key={index} style={styles.row}>
          {week.map((cell) => {
            const isStart = cell.key === from;
            const isEnd = cell.key === to;
            const inRange = Boolean(from && to && cell.key >= from && cell.key <= to);
            const selected = isStart || isEnd;
            const isToday = cell.key === todayKey;
            return (
              <Pressable key={cell.key} style={styles.cell} onPress={() => pick(cell.key)}>
                <View style={[styles.cellInner, inRange && styles.cellInRange, selected && styles.cellSelected]}>
                  <Text
                    style={[
                      styles.cellText,
                      !cell.inMonth && styles.cellTextMuted,
                      isToday && !selected && styles.cellTextToday,
                      selected && styles.cellTextSelected,
                    ]}
                  >
                    {cell.day}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={styles.footerRow}>
        <Text style={styles.rangeText}>
          {from ? (to ? `${from} ~ ${to}` : t("date.pickEnd", { from })) : t("date.pickStart")}
        </Text>
        {from || to ? (
          <Pressable style={styles.navButton} onPress={() => onChange({ from: "", to: "" })}>
            <Text style={styles.navText}>{t("date.clear")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
