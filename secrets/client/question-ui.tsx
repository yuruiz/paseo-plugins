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
}

export function QuestionButton({
  theme,
  label,
  onPress,
  disabled = false,
  primary = false,
  icon,
}: QuestionButtonProps) {
  const color = primary ? theme.colors.accentForeground : theme.colors.foreground;
  const opacity = disabled ? 0.5 : 1;
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => ({
      flexDirection: "row" as const,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      gap: 8,
      borderRadius: 6,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderColor: primary ? theme.colors.accent : theme.colors.border,
      backgroundColor: primary ? theme.colors.accent : theme.colors.surface1,
      opacity: pressed && !disabled ? 0.9 : opacity,
    }),
    [theme, primary, disabled, opacity],
  );
  const accessibilityState = useMemo(() => ({ disabled }), [disabled]);
  const textStyle = useMemo(() => ({ color, fontSize: 14 }), [color]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={onPress}
      style={style}
    >
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}
