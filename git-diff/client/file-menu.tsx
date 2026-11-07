import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Icon, type IconName } from "./icons";
import { panelTokens } from "./theme";

export type FileMenuTarget = {
  repositoryId: string;
  path: string;
  x: number;
  y: number;
  tabKey?: string;
};
export type FileMenuItem = {
  key: string;
  label: string;
  icon: IconName;
  disabled?: boolean;
  separator?: boolean;
  onPress(): void;
};
export function FileMenu({
  target,
  theme,
  items,
  onClose,
}: {
  target: FileMenuTarget;
  theme: PluginTheme;
  items: FileMenuItem[];
  onClose(): void;
}) {
  const c = panelTokens(theme);
  const { width, height } = useWindowDimensions();
  const nodes = useRef(new Map<string, View>());
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const enabled = items.filter((item) => !item.disabled);
  const first = enabled[0]?.key;
  useEffect(() => {
    if (first) nodes.current.get(first)?.focus();
  }, [first]);
  const menuWidth = Math.min(252, width - 16);
  const menuHeight = Math.min(
    height - 16,
    38 + items.length * 32 + items.filter((item) => item.separator).length * 9,
  );
  return (
    <Modal transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Pressable
          accessibilityLabel="关闭文件菜单"
          onPress={onClose}
          style={{ position: "absolute", inset: 0 }}
        />
        <View
          accessibilityRole="menu"
          accessibilityLabel={`${target.path} 文件操作`}
          {...(Platform.OS === "web"
            ? {
                onKeyDown: (event: {
                  key: string;
                  preventDefault(): void;
                  stopPropagation(): void;
                }) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                  } else if (
                    ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) &&
                    enabled.length
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const index = enabled.findIndex((item) => item.key === focused);
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? enabled.length - 1
                          : (index + (event.key === "ArrowUp" ? -1 : 1) + enabled.length) %
                            enabled.length;
                    nodes.current.get(enabled[next].key)?.focus();
                  }
                },
              }
            : {})}
          style={{
            position: "absolute",
            left: Math.max(8, Math.min(target.x, width - menuWidth - 8)),
            top: Math.max(8, Math.min(target.y, height - menuHeight - 8)),
            width: menuWidth,
            maxHeight: height - 16,
            padding: 4,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
            boxShadow: "0 4px 18px #00000044",
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: c.foregroundMuted,
              fontSize: 10,
              paddingHorizontal: 8,
              paddingVertical: 6,
            }}
          >
            {target.path}
          </Text>
          <ScrollView style={{ flexGrow: 0, maxHeight: Math.max(32, menuHeight - 30) }}>
            {items.map((item) => (
              <View key={item.key}>
                {item.separator ? (
                  <View
                    {...(Platform.OS === "web" ? { role: "separator" } : {})}
                    style={{ height: 1, backgroundColor: c.border, marginVertical: 4 }}
                  />
                ) : null}
                <Pressable
                  ref={(node) => {
                    if (node) nodes.current.set(item.key, node);
                    else nodes.current.delete(item.key);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityLabel={item.label}
                  disabled={item.disabled}
                  accessibilityState={{ disabled: Boolean(item.disabled) }}
                  {...(Platform.OS === "web"
                    ? { tabIndex: item.key === (focused ?? first) ? 0 : -1 }
                    : {})}
                  onPress={() => {
                    onClose();
                    item.onPress();
                  }}
                  onHoverIn={() => setHovered(item.key)}
                  onHoverOut={() => setHovered(null)}
                  onFocus={() => setFocused(item.key)}
                  onBlur={() => setFocused(null)}
                  style={{
                    minHeight: 32,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 9,
                    paddingHorizontal: 8,
                    borderRadius: 3,
                    opacity: item.disabled ? 0.45 : 1,
                    backgroundColor:
                      hovered === item.key || focused === item.key ? c.selection : "transparent",
                  }}
                >
                  <Icon name={item.icon} color={c.foregroundMuted} size={15} />
                  <Text style={{ color: c.foreground, fontSize: 12 }}>{item.label}</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
