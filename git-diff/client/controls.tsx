import type { PluginTheme } from "@getpaseo/plugin";
import { type ReactNode, type Ref, useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  type StyleProp,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName } from "./icons";
import { panelTokens } from "./theme";

// RN Web filters the HTML title prop. Apply it to the resolved native element so
// icon tooltips remain available without portals, clipping, or layout changes.
export function setWebTitle(node: unknown, title: string) {
  if (Platform.OS === "web")
    (node as { setAttribute?(name: string, value: string): void } | null)?.setAttribute?.(
      "title",
      title,
    );
}

export function InputField({
  theme,
  icon,
  inputRef,
  children,
  containerStyle,
  style,
  onFocus,
  onBlur,
  onKeyPress,
  onSubmitEditing,
  onNavigateMatch,
  ...props
}: TextInputProps & {
  theme: PluginTheme;
  icon?: IconName;
  inputRef?: Ref<TextInput>;
  children?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  onNavigateMatch?(direction: -1 | 1): void;
}) {
  const c = panelTokens(theme);
  const [focused, setFocused] = useState(false);
  return (
    <View
      {...(Platform.OS === "web" ? { dataSet: { gitField: "true" } } : {})}
      style={[
        {
          minHeight: 32,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 9,
          paddingRight: children ? 2 : 9,
          gap: 6,
          borderWidth: 1,
          borderRadius: 4,
          borderColor: focused ? c.fieldFocusBorder : c.border,
          backgroundColor: focused ? c.fieldFocusBackground : c.surface0,
        },
        containerStyle,
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={focused ? c.accent : c.foregroundMuted} /> : null}
      <TextInput
        {...props}
        ref={inputRef}
        placeholderTextColor={props.placeholderTextColor ?? c.foregroundMuted}
        selectionColor={c.accent}
        underlineColorAndroid="transparent"
        {...(onNavigateMatch
          ? Platform.OS === "web"
            ? { blurOnSubmit: false }
            : { submitBehavior: "submit" as const }
          : {})}
        onKeyPress={(event) => {
          onKeyPress?.(event);
          if (Platform.OS !== "web" || !onNavigateMatch || event.isDefaultPrevented()) return;
          const key = event.nativeEvent as {
            key: string;
            shiftKey?: boolean;
            isComposing?: boolean;
            keyCode?: number;
          };
          if (key.key === "Enter" && !key.isComposing && key.keyCode !== 229) {
            event.preventDefault();
            onNavigateMatch(key.shiftKey ? -1 : 1);
          }
        }}
        onSubmitEditing={
          onNavigateMatch
            ? () => {
                if (Platform.OS !== "web") onNavigateMatch(1);
              }
            : onSubmitEditing
        }
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          {
            flex: 1,
            minWidth: 0,
            minHeight: 30,
            paddingVertical: 5,
            paddingHorizontal: 0,
            borderWidth: 0,
            backgroundColor: "transparent",
            color: c.foreground,
            fontFamily: c.ui,
            fontSize: 12,
          },
          style,
        ]}
      />
      {children}
    </View>
  );
}

export function ToolButton({
  label,
  icon,
  onPress,
  theme,
  active,
  disabled = false,
  busy = false,
  text,
}: {
  label: string;
  icon?: IconName;
  onPress(): void;
  theme: PluginTheme;
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  text?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const colors = panelTokens(theme);
  const color = active ? colors.accent : colors.foregroundMuted;
  const buttonRef = useRef<View | null>(null);
  const titleRef = useCallback(
    (node: View | null) => {
      buttonRef.current = node;
      setWebTitle(node, label);
    },
    [label],
  );
  return (
    <Pressable
      ref={titleRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={label}
      accessibilityState={{
        ...(Platform.OS !== "web" && active !== undefined ? { selected: active } : {}),
        disabled: disabled || busy,
        busy,
      }}
      {...(Platform.OS === "web"
        ? { title: label, ...(active !== undefined ? { "aria-pressed": active } : {}) }
        : {})}
      disabled={disabled || busy}
      onPress={() => {
        if (Platform.OS === "web") buttonRef.current?.focus();
        onPress();
      }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        minWidth: 28,
        minHeight: 28,
        paddingHorizontal: text ? 7 : 5,
        flexDirection: "row",
        gap: 5,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 3,
        borderWidth: 1,
        borderColor: focused ? colors.accent : "transparent",
        backgroundColor: active ? colors.selection : hovered ? colors.surface2 : "transparent",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator size={14} color={color} />
      ) : icon ? (
        <Icon name={icon} color={color} size={16} />
      ) : null}
      {text ? (
        <Text numberOfLines={1} style={{ color: active ? colors.foreground : color, fontSize: 11 }}>
          {text}
        </Text>
      ) : null}
    </Pressable>
  );
}
