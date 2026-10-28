import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo } from "react";
import { Pressable, type PressableStateCallbackType, StyleSheet, Text } from "react-native";

// Match QuestionFormCard's spacing and type scale using the plugin's host theme.
// That permission-bound component is not part of the public plugin UI module.
export function useQuestionStyles(theme: PluginTheme, compact = false) {
  return useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          gap: 12,
        },
        body: { gap: 12 },
        field: { gap: 8 },
        text: { color: theme.colors.foreground, fontSize: 14, lineHeight: 22 },
        muted: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
        error: { color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 },
        input: {
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          fontSize: 14,
          minWidth: 0,
        },
        tabs: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
        row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
        actions: { flexDirection: compact ? "column" : "row", gap: 8 },
        image: {
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          padding: 16,
          gap: 8,
          alignItems: "center",
        },
        output: { minHeight: 120, maxHeight: 300 },
      }),
    [theme, compact],
  );
}

interface QuestionButtonProps {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  icon?: string;
  compact?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "success" | "tonal";
  iconOnly?: boolean;
}

export function QuestionButton({
  theme,
  label,
  onPress,
  disabled = false,
  primary = false,
  icon,
  compact = false,
  variant,
  iconOnly = false,
}: QuestionButtonProps) {
  const appearance = variant ?? (primary ? "primary" : "secondary");
  const palette = useMemo(() => {
    if (appearance === "primary")
      return {
        color: theme.colors.accentForeground,
        background: theme.colors.accent,
        border: theme.colors.accent,
      };
    if (appearance === "success")
      return {
        color: theme.colors.foregroundMuted,
        background: theme.colors.surface1,
        border: theme.colors.border,
      };
    if (appearance === "tonal")
      return {
        color: theme.colors.foreground,
        background: theme.colors.surface2,
        border: theme.colors.border,
      };
    if (appearance === "ghost")
      return {
        color: theme.colors.foregroundMuted,
        background: "transparent",
        border: "transparent",
      };
    return {
      color: theme.colors.foreground,
      background: theme.colors.surface1,
      border: theme.colors.border,
    };
  }, [appearance, theme]);
  const { color } = palette;
  let iconColor = color;
  if (appearance === "tonal") iconColor = theme.colors.accent;
  if (appearance === "success") iconColor = theme.colors.statusSuccess;
  const opacity = disabled && appearance !== "success" ? 0.5 : 1;
  const style = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => ({
      flexDirection: "row" as const,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      gap: compact ? 6 : 8,
      borderRadius: 6,
      borderWidth: 1,
      paddingHorizontal: compact ? 8 : 12,
      paddingVertical: compact ? 5 : 8,
      borderColor: palette.border,
      backgroundColor:
        appearance === "ghost" && (hovered || pressed) ? theme.colors.surface2 : palette.background,
      opacity: pressed && !disabled ? 0.9 : opacity,
    }),
    [theme, appearance, palette, disabled, opacity, compact],
  );
  const accessibilityState = useMemo(() => ({ disabled }), [disabled]);
  const textStyle = useMemo(
    () => ({
      color,
      fontSize: compact ? 12 : 14,
      fontWeight: appearance === "primary" ? ("600" as const) : ("400" as const),
    }),
    [color, compact, appearance],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={onPress}
      style={style}
    >
      {icon ? <Icon name={icon} size={14} color={iconColor} /> : null}
      {!iconOnly ? <Text style={textStyle}>{label}</Text> : null}
    </Pressable>
  );
}
