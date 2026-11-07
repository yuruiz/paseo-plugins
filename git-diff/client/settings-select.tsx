import type { PluginTheme } from "@getpaseo/plugin";
import { createElement, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { ToolButton } from "./controls";
import { Icon } from "./icons";
import { panelTokens } from "./theme";

export type SelectOption = { value: string; label: string };

export function SettingsSelect({
  label,
  value,
  options,
  onChange,
  theme,
  disabled = false,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  theme: PluginTheme;
  disabled?: boolean;
}) {
  const c = panelTokens(theme);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const selected = options.find((option) => option.value === value);
  const field = {
    minHeight: 32,
    borderWidth: 1,
    borderColor: focused ? c.fieldFocusBorder : c.border,
    borderRadius: 4,
    backgroundColor: focused ? c.fieldFocusBackground : c.surface0,
  };
  const caret = (
    <View pointerEvents="none" style={{ position: "absolute", right: 10, top: 9 }}>
      <Icon name="chevronDown" color={c.foregroundMuted} size={14} />
    </View>
  );
  if (Platform.OS === "web")
    return (
      <View style={{ minWidth: 0, opacity: disabled ? 0.5 : 1 }}>
        {createElement(
          "select",
          {
            "aria-label": label,
            value,
            disabled,
            onFocus: () => setFocused(true),
            onBlur: () => setFocused(false),
            onChange: (event: { target: { value: string } }) => onChange(event.target.value),
            style: {
              width: "100%",
              height: 32,
              padding: "0 30px 0 10px",
              border: `1px solid ${field.borderColor}`,
              borderRadius: field.borderRadius,
              backgroundColor: field.backgroundColor,
              outline: "none",
              boxShadow: "none",
              color: c.foreground,
              fontFamily: c.ui,
              fontSize: 12,
              appearance: "none",
              colorScheme: "inherit",
              cursor: disabled ? "default" : "pointer",
            },
          },
          options.map((option) =>
            createElement("option", { key: option.value, value: option.value }, option.label),
          ),
        )}
        {caret}
      </View>
    );
  return (
    <>
      <Pressable
        accessibilityRole="combobox"
        accessibilityLabel={`${label}：${selected?.label ?? value}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          field,
          {
            justifyContent: "center",
            paddingLeft: 10,
            paddingRight: 30,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12 }}>
          {selected?.label ?? value}
        </Text>
        {caret}
      </Pressable>
      {open ? (
        <Modal transparent animationType="none" onRequestClose={() => setOpen(false)}>
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" }}>
            <Pressable
              accessibilityLabel={`关闭${label}选择`}
              onPress={() => setOpen(false)}
              style={{ flex: 1 }}
            />
            <View style={{ maxHeight: "65%", backgroundColor: c.surface1, padding: 16, gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ flex: 1, color: c.foreground, fontSize: 14, fontWeight: "600" }}>
                  {label}
                </Text>
                <ToolButton
                  theme={theme}
                  icon="close"
                  label={`关闭${label}选择`}
                  onPress={() => setOpen(false)}
                />
              </View>
              <ScrollView>
                {options.map((option) => (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ checked: value === option.value }}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    style={{
                      minHeight: 44,
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: 10,
                      backgroundColor: value === option.value ? c.selection : "transparent",
                    }}
                  >
                    <Text style={{ flex: 1, color: c.foreground, fontSize: 13 }}>
                      {option.label}
                    </Text>
                    {value === option.value ? <Icon name="check" color={c.accent} /> : null}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}
