import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useMemo, useRef } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { setWebTitle, ToolButton } from "./controls";
import type { EditorTab } from "./editor-model";
import type { FileMenuTarget } from "./file-menu";
import { fileAppearance, Icon } from "./icons";
import { panelTokens } from "./theme";

export function EditorTabs({
  tabs,
  active,
  onSelect,
  onClose,
  onContextMenu,
  theme,
  compact,
  sidebarVisible,
  onToggleSidebar,
  onSettings,
  settingsError,
}: {
  tabs: EditorTab[];
  active: string | null;
  onSelect(key: string): void;
  onClose(key: string): void;
  onContextMenu(target: FileMenuTarget): void;
  theme: PluginTheme;
  compact: boolean;
  sidebarVisible: boolean;
  onToggleSidebar(): void;
  onSettings(): void;
  settingsError: boolean;
}) {
  const c = panelTokens(theme);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const viewport = useRef(0);
  const positions = useRef(new Map<string, { x: number; width: number }>());
  const duplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of tabs) counts.set(tab.label, (counts.get(tab.label) ?? 0) + 1);
    return counts;
  }, [tabs]);
  useEffect(() => {
    const keys = new Set(tabs.map((tab) => tab.key));
    for (const key of positions.current.keys()) if (!keys.has(key)) positions.current.delete(key);
  }, [tabs]);
  function reveal() {
    const bounds = active ? positions.current.get(active) : undefined;
    if (!bounds) return;
    if (bounds.x < offset.current) scroll.current?.scrollTo({ x: bounds.x, animated: false });
    else if (bounds.x + bounds.width > offset.current + viewport.current)
      scroll.current?.scrollTo({ x: bounds.x + bounds.width - viewport.current, animated: false });
  }
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useEffect(() => {
    if (active) revealRef.current();
  }, [active]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    type Wheel = { deltaX: number; deltaY: number; preventDefault(): void };
    const node = scroll.current?.getScrollableNode() as {
      scrollLeft: number;
      addEventListener(
        type: string,
        handler: (event: Wheel) => void,
        options: { passive: boolean },
      ): void;
      removeEventListener(type: string, handler: (event: Wheel) => void): void;
    } | null;
    if (!node) return;
    const wheel = (event: Wheel) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        node.scrollLeft += event.deltaY;
      }
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  return (
    <View testID="editor-tabbar" style={{ flex: 1, minWidth: 0, flexDirection: "row", height: 36 }}>
      <ScrollView
        ref={scroll}
        horizontal
        testID="editor-tabs"
        style={{ flex: 1, minWidth: 0, height: 36, maxHeight: 36 }}
        contentContainerStyle={{ flexDirection: "row", alignItems: "stretch" }}
        onLayout={(event) => {
          viewport.current = event.nativeEvent.layout.width;
          reveal();
        }}
        onContentSizeChange={reveal}
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
      >
        <View
          accessibilityRole="tablist"
          accessibilityLabel="打开的文件，支持滚轮与触控板横向滚动"
          style={{ flexDirection: "row", minHeight: 30 }}
        >
          {tabs.map((tab) => {
            const appearance = fileAppearance(tab.path, c.foregroundMuted);
            const selected = active === tab.key;
            const duplicate = (duplicates.get(tab.label) ?? 0) > 1;
            return (
              <View
                key={tab.key}
                {...(Platform.OS === "web"
                  ? {
                      onContextMenu: (event: {
                        clientX: number;
                        clientY: number;
                        preventDefault(): void;
                      }) => {
                        event.preventDefault();
                        onContextMenu({
                          repositoryId: tab.repositoryId,
                          path: tab.path,
                          tabKey: tab.key,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      },
                    }
                  : {})}
                onLayout={(event) => {
                  positions.current.set(tab.key, event.nativeEvent.layout);
                  if (selected) reveal();
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingLeft: 10,
                  paddingRight: 3,
                  gap: 4,
                  borderRightWidth: 1,
                  borderRightColor: c.border,
                  borderTopWidth: 1,
                  borderTopColor: selected ? c.accent : "transparent",
                  backgroundColor: selected ? c.surface0 : c.surface1,
                  maxWidth: 240,
                }}
              >
                <Pressable
                  ref={(node) => setWebTitle(node, `${tab.repositoryId} / ${tab.path}`)}
                  accessibilityRole="tab"
                  accessibilityLabel={`打开标签 ${tab.path}（${tab.repositoryId}）`}
                  accessibilityState={{ selected }}
                  {...(Platform.OS === "web"
                    ? { title: `${tab.repositoryId} / ${tab.path}`, "aria-selected": selected }
                    : {})}
                  onPress={() => onSelect(tab.key)}
                  onLongPress={(event) =>
                    onContextMenu({
                      repositoryId: tab.repositoryId,
                      path: tab.path,
                      tabKey: tab.key,
                      x: event.nativeEvent.pageX,
                      y: event.nativeEvent.pageY,
                    })
                  }
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    minHeight: 28,
                    paddingRight: 4,
                    flexShrink: 1,
                  }}
                >
                  <Icon name={appearance.icon} color={appearance.color} size={15} />
                  <Text
                    numberOfLines={1}
                    style={{
                      color: selected ? c.foreground : c.foregroundMuted,
                      fontSize: 12,
                      maxWidth: duplicate ? 100 : 160,
                    }}
                  >
                    {tab.label}
                  </Text>
                  {duplicate ? (
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 10, maxWidth: 70, color: c.foregroundMuted }}
                    >
                      {tab.repositoryId === "."
                        ? tab.path.split("/").slice(0, -1).join("/") || "."
                        : tab.repositoryId}
                    </Text>
                  ) : null}
                </Pressable>
                <ToolButton
                  theme={theme}
                  label={`关闭标签 ${tab.path}（${tab.repositoryId}）`}
                  icon="close"
                  onPress={() => onClose(tab.key)}
                />
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View
        testID="editor-tab-actions"
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexShrink: 0,
          paddingHorizontal: 3,
          borderLeftWidth: 1,
          borderLeftColor: c.border,
          backgroundColor: c.surface1,
        }}
      >
        <ToolButton
          theme={theme}
          icon={compact ? "back" : "sidebar"}
          label={compact ? "返回变更列表" : sidebarVisible ? "隐藏文件侧栏" : "显示文件侧栏"}
          active={!compact && sidebarVisible}
          onPress={onToggleSidebar}
        />
        <ToolButton
          theme={theme}
          label={settingsError ? "Git 设置 · 保存失败" : "Git 设置"}
          icon="settings"
          onPress={onSettings}
        />
      </View>
    </View>
  );
}
