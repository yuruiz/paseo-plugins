import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useMemo } from "react";
import { useFleet } from "./fleet";
import { footerTotals } from "../shared/fleet";
import { useI18n } from "./i18n";
import { formatCompactTokens } from "./format";

export function UsageSidebarItem({ openScreen, theme }: PluginSidebarItemProps) {
  const { fleet } = useFleet();
  const { t } = useI18n();
  const totals = useMemo(() => footerTotals(fleet.state), [fleet]);
  const ranges = ["24h", "7d", "30d"] as const;
  const labels = ["fleet.day", "fleet.week", "fleet.month"] as const;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ranges.map((range, index) => `${t(labels[index])} ${fleet.hasData ? totals[range] : "—"}`).join(", ")}
      onPress={() => openScreen({ screenId: "usage" })}
      style={({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => ({
        width: "100%", minHeight: 28, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
        backgroundColor: hovered || pressed ? theme.colors.surface1 : "transparent",
        flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8,
      })}
    >
      {ranges.map((range) => (
        <View key={range} style={{ flexDirection: "row", alignItems: "baseline", gap: 5, minWidth: 0 }}>
          <Text numberOfLines={1}
            style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18, fontWeight: "500", fontVariant: ["tabular-nums"] }}>
            {fleet.hasData ? formatCompactTokens(totals[range]) : "—"}
          </Text>
          <Text numberOfLines={1}
            style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 18 }}>
            {range}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}
