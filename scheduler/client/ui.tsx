import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";

type Theme = PluginSurfaceProps["theme"];
const UiContext = createContext<{ theme: Theme; compact: boolean } | null>(null);
export function UiProvider({
  theme,
  compact,
  children,
}: {
  theme: Theme;
  compact: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ theme, compact }), [theme, compact]);
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}
export function useUi() {
  const context = useContext(UiContext);
  if (!context) throw new Error("Missing scheduler theme");
  const { theme, compact } = context;
  return useMemo(
    () => ({
      theme,
      compact,
      text: {
        color: theme.colors.foreground,
        fontSize: compact ? 16 : 13,
        lineHeight: compact ? 22 : 18,
      },
      muted: {
        color: theme.colors.foregroundMuted,
        fontSize: compact ? 14 : 12,
        lineHeight: compact ? 20 : 17,
      },
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        borderRadius: 8,
        padding: 12,
        minWidth: 0,
        gap: 8,
      },
    }),
    [theme, compact],
  );
}
export function Copy({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const ui = useUi();
  return (
    <Text selectable style={muted ? ui.muted : ui.text}>
      {children}
    </Text>
  );
}
export function Title({ children }: { children: ReactNode }) {
  const ui = useUi();
  return <Text style={{ ...ui.text, fontSize: 16, fontWeight: "600" }}>{children}</Text>;
}
export function Card({ children }: { children: ReactNode }) {
  const ui = useUi();
  return <View style={ui.card}>{children}</View>;
}
export function Row({ children }: { children: ReactNode }) {
  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", minWidth: 0 }}
    >
      {children}
    </View>
  );
}
export function Action({
  label,
  onPress,
  disabled = false,
  primary = false,
  ghost = false,
  selected,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  ghost?: boolean;
  selected?: boolean;
}) {
  const { theme, compact } = useUi();
  let backgroundColor = theme.colors.surface2;
  if (primary) backgroundColor = theme.colors.accent;
  else if ((ghost || selected !== undefined) && !selected) backgroundColor = "transparent";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: compact ? 44 : 32,
        alignSelf: "flex-start",
        maxWidth: "100%",
        flexShrink: 1,
        justifyContent: "center",
        paddingHorizontal: 12,
        paddingVertical: compact ? 8 : 6,
        borderRadius: 6,
        opacity: disabled ? 0.5 : 1,
        backgroundColor,
      }}
    >
      <Text
        style={{
          color: primary ? theme.colors.accentForeground : theme.colors.foreground,
          fontSize: compact ? 16 : 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export interface Choice<Value extends string> {
  value: Value;
  label: string;
}
export function Select<Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: Value;
  options: readonly Choice<Value>[];
  onChange: (value: Value) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <View style={{ minWidth: 0 }}>
      <SettingsSelect
        label={label}
        value={value}
        options={options}
        onValueChange={onChange}
        disabled={disabled}
        hint={hint}
      />
    </View>
  );
}

function Help({
  label,
  expanded,
  onPress,
}: {
  label: string;
  expanded: boolean;
  onPress: () => void;
}) {
  const { theme, compact } = useUi();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Help: ${label}`}
      accessibilityState={{ expanded }}
      onPress={onPress}
      hitSlop={6}
      style={{
        minWidth: compact ? 44 : 20,
        minHeight: compact ? 44 : 20,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>?</Text>
    </Pressable>
  );
}
export function Grid({ children }: { children: ReactNode }) {
  const { compact } = useUi();
  const items = Children.toArray(children);
  if (items.length === 0) return null;
  return (
    <View
      style={{
        flexDirection: compact ? "column" : "row",
        flexWrap: compact ? "nowrap" : "wrap",
        gap: 8,
        minWidth: 0,
      }}
    >
      {items.map((child, index) => (
        <View
          key={isValidElement(child) ? child.key : index}
          style={{
            flexGrow: compact ? 0 : 1,
            flexShrink: 1,
            flexBasis: compact ? "auto" : "48%",
            minWidth: 0,
            maxWidth: "100%",
          }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: open ? 8 : 0 }}>
      <Action
        ghost
        label={`${open ? "▾" : "▸"} ${title}`}
        onPress={() => setOpen((value) => !value)}
      />
      {open ? children : null}
    </View>
  );
}
export function Choices<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: Value;
  options: readonly Choice<Value>[];
  onChange: (value: Value) => void;
}) {
  return (
    <View style={{ gap: 4 }}>
      {label ? <Copy muted>{label}</Copy> : null}
      <Row>
        {options.map((option) => (
          <Action
            key={option.value}
            label={option.label}
            ghost
            selected={value === option.value}
            onPress={() => onChange(option.value)}
          />
        ))}
      </Row>
    </View>
  );
}
export function Field({
  label,
  value,
  onChange,
  multiline = false,
  hint,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  hint?: string;
  onBlur?: () => void;
}) {
  const { theme, compact } = useUi();
  const [help, setHelp] = useState(false);
  const controlHeight = compact ? 44 : 32;
  return (
    <View style={{ gap: 4 }}>
      <Row>
        <Copy>{label}</Copy>
        {hint ? (
          <Help label={label} expanded={help} onPress={() => setHelp((value) => !value)} />
        ) : null}
      </Row>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: compact ? 12 : 6,
          fontSize: compact ? 16 : 13,
          lineHeight: 18,
          minHeight: multiline ? 84 : controlHeight,
          textAlignVertical: "top",
        }}
      />
      {hint && help ? <Copy muted>{hint}</Copy> : null}
    </View>
  );
}
export function Notice({
  message,
  error = false,
}: {
  message: string | null | undefined;
  error?: boolean;
}) {
  const { theme } = useUi();
  if (!message) return null;
  return (
    <Text
      selectable
      accessibilityRole="alert"
      style={{
        color: error ? theme.colors.statusDanger : theme.colors.foregroundMuted,
        fontSize: 14,
      }}
    >
      {message}
    </Text>
  );
}
