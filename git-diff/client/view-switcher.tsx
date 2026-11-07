import type { PluginTheme } from "@getpaseo/plugin";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { setWebTitle } from "./controls";
import { Icon } from "./icons";
import { panelTokens } from "./theme";

const views = [
  { value: "changes", label: "更改", icon: "source" },
  { value: "history", label: "提交图", icon: "branch" },
] as const;
export type WorkspaceView = (typeof views)[number]["value"];

export function ViewSwitcher({
  value,
  onChange,
  buttonRef,
  theme,
}: {
  value: WorkspaceView;
  onChange(value: WorkspaceView): void;
  buttonRef: RefObject<View | null>;
  theme: PluginTheme;
}) {
  const c = panelTokens(theme);
  const { width, height } = useWindowDimensions();
  const selected = views.find((item) => item.value === value) ?? views[0];
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState<WorkspaceView | "trigger" | null>(null);
  const [focused, setFocused] = useState<WorkspaceView | "trigger" | null>(null);
  const items = useRef(new Map<WorkspaceView, View>());
  const label = `切换 Git 视图，当前：${selected.label}`;
  const triggerRef = useCallback(
    (node: View | null) => {
      buttonRef.current = node;
      setWebTitle(node, label);
    },
    [buttonRef, label],
  );
  const focusSelection = useCallback(() => items.current.get(value)?.focus(), [value]);
  useEffect(() => {
    if (anchor) focusSelection();
  }, [anchor, focusSelection]);
  function open() {
    buttonRef.current?.measureInWindow((x, y, _width, triggerHeight) =>
      setAnchor({ x, y: y + triggerHeight + 4 }),
    );
  }
  function close() {
    setAnchor(null);
    buttonRef.current?.focus();
  }
  const menuWidth = Math.min(176, width - 16);
  return (
    <>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: Boolean(anchor) }}
        {...(Platform.OS === "web"
          ? {
              "aria-haspopup": "menu",
              "aria-expanded": Boolean(anchor),
              onKeyDown: (event: { key: string; preventDefault(): void }) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  open();
                }
              },
            }
          : {})}
        onPress={open}
        onHoverIn={() => setHovered("trigger")}
        onHoverOut={() => setHovered(null)}
        onFocus={() => setFocused("trigger")}
        onBlur={() => setFocused(null)}
        style={{
          minWidth: 36,
          height: 28,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: focused === "trigger" ? c.fieldFocusBorder : "transparent",
          backgroundColor: anchor || hovered === "trigger" ? c.surface2 : "transparent",
        }}
      >
        <Icon name={selected.icon} color={c.foregroundMuted} size={16} />
        <Icon name="chevronDown" color={c.foregroundMuted} size={11} />
      </Pressable>
      {anchor ? (
        <Modal transparent animationType="none" onRequestClose={close} onShow={focusSelection}>
          <View style={{ flex: 1 }}>
            <Pressable
              accessible={false}
              {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
              onPress={close}
              style={{ position: "absolute", inset: 0 }}
            />
            <View
              accessibilityRole="menu"
              accessibilityLabel="Git 视图"
              {...(Platform.OS === "web"
                ? {
                    onKeyDown: (event: {
                      key: string;
                      preventDefault(): void;
                      stopPropagation(): void;
                    }) => {
                      if (event.key === "Escape" || event.key === "Tab") {
                        if (event.key === "Escape") event.preventDefault();
                        event.stopPropagation();
                        close();
                      } else if (event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        const item = views.find((item) => item.value === focused);
                        if (item) {
                          close();
                          onChange(item.value);
                        }
                      } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                        event.preventDefault();
                        event.stopPropagation();
                        const index = views.findIndex((item) => item.value === focused);
                        const next =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? views.length - 1
                              : (index + (event.key === "ArrowUp" ? -1 : 1) + views.length) %
                                views.length;
                        items.current.get(views[next].value)?.focus();
                      }
                    },
                  }
                : {})}
              style={{
                position: "absolute",
                left: Math.max(8, Math.min(anchor.x, width - menuWidth - 8)),
                top: Math.max(8, Math.min(anchor.y, height - 80)),
                width: menuWidth,
                padding: 4,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 5,
                backgroundColor: c.surface1,
                boxShadow: "0 4px 16px #00000033",
              }}
            >
              {views.map((item) => (
                <Pressable
                  key={item.value}
                  ref={(node) => {
                    if (node) items.current.set(item.value, node);
                    else items.current.delete(item.value);
                    // RN's role union omits menuitemradio; expose the full role on Web.
                    if (Platform.OS === "web")
                      (
                        node as { setAttribute?(name: string, value: string): void } | null
                      )?.setAttribute?.("role", "menuitemradio");
                  }}
                  accessibilityRole="menuitem"
                  accessibilityLabel={item.label}
                  accessibilityState={{ checked: item.value === value }}
                  {...(Platform.OS === "web"
                    ? {
                        "aria-checked": item.value === value,
                        tabIndex: item.value === focused ? 0 : -1,
                      }
                    : {})}
                  onPress={() => {
                    close();
                    onChange(item.value);
                  }}
                  onHoverIn={() => setHovered(item.value)}
                  onHoverOut={() => setHovered(null)}
                  onFocus={() => setFocused(item.value)}
                  onBlur={() => setFocused(null)}
                  style={{
                    minHeight: 32,
                    paddingHorizontal: 8,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    borderRadius: 3,
                    backgroundColor:
                      hovered === item.value || focused === item.value
                        ? c.selection
                        : "transparent",
                  }}
                >
                  <Icon name={item.icon} size={15} color={c.foregroundMuted} />
                  <Text style={{ flex: 1, color: c.foreground, fontFamily: c.ui, fontSize: 12 }}>
                    {item.label}
                  </Text>
                  {item.value === value ? <Icon name="check" size={14} color={c.accent} /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}
