import type { PluginTheme } from "@getpaseo/plugin";
import { StyleSheet } from "react-native";

export function createStyles(
  theme: PluginTheme,
  compact: boolean,
  frame: "screen" | "popover" = "screen",
) {
  const colors = theme.colors;
  const screenPadding = compact ? 16 : 24;
  const contentPadding = frame === "popover" ? 0 : screenPadding;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface0 },
    columns: { flex: 1, flexDirection: compact ? "column" : "row" },
    list: {
      flex: compact ? 1 : undefined,
      width: compact ? "100%" : 300,
      backgroundColor: colors.surface1,
    },
    toolbar: { padding: 16, gap: 12 },
    row: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
    selected: { backgroundColor: colors.surface2 },
    text: { color: colors.foreground, fontSize: 14 },
    title: { color: colors.foreground, fontSize: 16, fontWeight: "500" },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    error: { color: colors.statusDanger, fontSize: 14 },
    warning: { color: colors.statusWarning, fontSize: 12 },
    success: { color: colors.statusSuccess, fontSize: 14 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      padding: 10,
      color: colors.foreground,
      backgroundColor: colors.surface0,
      fontSize: 14,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
    button: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 6,
      backgroundColor: colors.surface2,
    },
    primary: { backgroundColor: colors.accent },
    primaryText: { color: colors.accentForeground, fontSize: 14 },
    disabled: { opacity: 0.5 },
    detail: { flex: 1, minWidth: 0 },
    content: {
      padding: contentPadding,
      gap: 16,
      maxWidth: 760,
      width: "100%",
      alignSelf: "center",
    },
    empty: { padding: 24 },
    gap: { gap: 8 },
  });
}
export type Styles = ReturnType<typeof createStyles>;
