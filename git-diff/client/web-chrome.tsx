import type { PluginTheme } from "@getpaseo/plugin";
import { createElement, useEffect, useRef, useState } from "react";
import { PanResponder, Platform, View } from "react-native";
import { setWebTitle } from "./controls";
import { mixColor, panelTokens } from "./theme";

// Pointer capture keeps dragging stable while the separator itself moves and
// React rerenders. RN Web's responder can otherwise terminate after the first move.
export function useWebDrag(
  start: () => void,
  move: (dx: number) => void,
  end: () => void,
  reset: () => void,
  axis: "x" | "y" = "x",
) {
  const ref = useRef<View>(null);
  const callbacks = useRef({ start, move, end, reset });
  callbacks.current = { start, move, end, reset };
  useEffect(() => {
    if (Platform.OS !== "web") return;
    type Pointer = {
      pointerId: number;
      clientX: number;
      clientY: number;
      button: number;
      preventDefault(): void;
    };
    const node = ref.current as unknown as {
      addEventListener(type: string, callback: (event: Pointer) => void): void;
      removeEventListener(type: string, callback: (event: Pointer) => void): void;
      setPointerCapture(id: number): void;
      releasePointerCapture(id: number): void;
      focus(): void;
    } | null;
    if (!node) return;
    let pointer: number | null = null;
    let origin = 0;
    const down = (event: Pointer) => {
      if (event.button !== 0 || pointer !== null) return;
      event.preventDefault();
      node.focus();
      pointer = event.pointerId;
      origin = axis === "x" ? event.clientX : event.clientY;
      node.setPointerCapture(pointer);
      callbacks.current.start();
    };
    const drag = (event: Pointer) => {
      if (pointer === event.pointerId)
        callbacks.current.move((axis === "x" ? event.clientX : event.clientY) - origin);
    };
    const up = (event: Pointer) => {
      if (pointer !== event.pointerId) return;
      pointer = null;
      callbacks.current.end();
    };
    const handlers = {
      pointerdown: down,
      pointermove: drag,
      pointerup: up,
      pointercancel: up,
      lostpointercapture: up,
      dblclick: (event: Pointer) => {
        event.preventDefault();
        callbacks.current.reset();
      },
    };
    for (const [type, handler] of Object.entries(handlers)) node.addEventListener(type, handler);
    return () => {
      for (const [type, handler] of Object.entries(handlers))
        node.removeEventListener(type, handler);
      if (pointer !== null) {
        node.releasePointerCapture(pointer);
        callbacks.current.end();
      }
    };
  }, [axis]);
  return ref;
}

export function ScrollbarStyle({ theme, thin }: { theme: PluginTheme; thin: boolean }) {
  if (Platform.OS !== "web") return null;
  const c = panelTokens(theme);
  const thumb = mixColor(c.foregroundMuted, c.surface0, 0.4);
  const hover = mixColor(c.foregroundMuted, c.surface0, 0.65);
  const panels =
    ':is([data-testid="git-changes-panel"],[data-testid="git-history-panel"],[data-testid="git-settings-panel"])';
  // Scope styles to this plugin; never restyle Paseo's own panels or scrollbars.
  return createElement(
    "style",
    null,
    `
    ${panels} { --git-scroll-thumb: ${thumb}; --git-scroll-hover: ${hover}; }
    ${panels} :is([dir],input):not([data-git-code]):not([data-git-code] *) { font-family: ${c.ui}; }
    [data-git-code="true"], [data-git-code="true"] * { user-select: none; -webkit-user-select: none; }
    [data-git-code="true"] [data-diff-line], [data-git-code="true"] [data-diff-line] * { user-select: text; -webkit-user-select: text; }
    [data-selection-side="old"] [data-diff-side="new"], [data-selection-side="old"] [data-diff-side="new"] *,
    [data-selection-side="new"] [data-diff-side="old"], [data-selection-side="new"] [data-diff-side="old"] * { user-select: none !important; -webkit-user-select: none !important; }
    ${panels} [data-git-field] input { outline: none; box-shadow: none; }
    ${panels} * { scrollbar-width: ${thin ? "thin" : "auto"}; scrollbar-color: var(--git-scroll-thumb) transparent; }
    ${panels} *::-webkit-scrollbar { width: ${thin ? 7 : 12}px; height: ${thin ? 7 : 12}px; }
    ${panels} *::-webkit-scrollbar-track { background: transparent; }
    ${panels} *::-webkit-scrollbar-thumb { background: var(--git-scroll-thumb); border: 2px solid transparent; background-clip: padding-box; border-radius: 8px; }
    ${panels} *::-webkit-scrollbar-thumb:hover { background-color: var(--git-scroll-hover); }
    ${panels} *::-webkit-scrollbar-corner { background: transparent; }
    :is([data-testid="git-sidebar-resizer"],[data-testid="git-diff-resizer"]) { cursor: col-resize; touch-action: none; }
    [data-testid="git-history-panel"] :is([data-testid="review-range-top"],[data-testid="review-range-bottom"]) { cursor: ns-resize; touch-action: none; user-select: none; outline: none; }
    [data-testid="git-history-resizer"] { cursor: row-resize; touch-action: none; user-select: none; outline: none; }
  `,
  );
}

export function HistoryResizer({
  height,
  min,
  max,
  onChange,
  onCommit,
  onReset,
  theme,
}: {
  height: number;
  min: number;
  max: number;
  onChange(height: number): void;
  onCommit(): void;
  onReset(): void;
  theme: PluginTheme;
}) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const origin = useRef(height);
  const current = useRef({ height, min, max, onChange, onCommit, onReset });
  current.current = { height, min, max, onChange, onCommit, onReset };
  function change(value: number) {
    current.current.onChange(Math.max(current.current.min, Math.min(current.current.max, value)));
  }
  function start() {
    origin.current = current.current.height;
    setDragging(true);
  }
  function end() {
    setDragging(false);
    current.current.onCommit();
  }
  const webRef = useWebDrag(
    start,
    (dy) => change(origin.current + dy),
    end,
    () => current.current.onReset(),
    "y",
  );
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: start,
      onPanResponderMove: (_, gesture) => change(origin.current + gesture.dy),
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    }),
  ).current;
  const label = "调整提交图高度，上下方向键调整，Home 或双击恢复默认";
  const active = hovered || dragging || focused;
  return (
    <View
      ref={(node) => {
        webRef.current = node;
        setWebTitle(node, label);
      }}
      testID="git-history-resizer"
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: Math.round(min), max: Math.round(max), now: Math.round(height) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (["increment", "decrement"].includes(event.nativeEvent.actionName)) {
          change(
            current.current.height + (event.nativeEvent.actionName === "increment" ? 10 : -10),
          );
          current.current.onCommit();
        }
      }}
      {...(Platform.OS === "web" ? {} : responder.panHandlers)}
      {...(Platform.OS === "web"
        ? {
            role: "separator",
            "aria-orientation": "horizontal",
            "aria-valuemin": Math.round(min),
            "aria-valuemax": Math.round(max),
            "aria-valuenow": Math.round(height),
            tabIndex: 0,
            onKeyDown: (event: {
              key: string;
              preventDefault(): void;
              stopPropagation(): void;
            }) => {
              if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Home") current.current.onReset();
                else {
                  change(
                    event.key === "End"
                      ? current.current.max
                      : current.current.height + (event.key === "ArrowUp" ? -10 : 10),
                  );
                  current.current.onCommit();
                }
              }
            },
          }
        : {})}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        position: "absolute",
        top: -4,
        left: 0,
        right: 0,
        height: 9,
        zIndex: 4,
        justifyContent: "center",
        backgroundColor: active
          ? mixColor(theme.colors.accent, theme.colors.surface0, 0.12)
          : "transparent",
      }}
    >
      <View
        style={{
          height: active ? 2 : 1,
          backgroundColor: active ? theme.colors.accent : theme.colors.border,
        }}
      />
    </View>
  );
}

export function SidebarResizer({
  width,
  onChange,
  onCommit,
  theme,
}: {
  width: number;
  onChange(width: number): void;
  onCommit(): void;
  theme: PluginTheme;
}) {
  const [active, setActive] = useState(false);
  const origin = useRef(width);
  const change = useRef(onChange);
  const current = useRef(width);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  current.current = width;
  change.current = onChange;
  const webRef = useWebDrag(
    () => {
      origin.current = current.current;
      setActive(true);
    },
    (dx) => change.current(origin.current + dx),
    () => {
      setActive(false);
      commit.current();
    },
    () => {
      change.current(240);
      commit.current();
    },
  );
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        origin.current = current.current;
        setActive(true);
      },
      onPanResponderMove: (_, gesture) => change.current(origin.current + gesture.dx),
      onPanResponderRelease: () => {
        setActive(false);
        commit.current();
      },
      onPanResponderTerminate: () => {
        setActive(false);
        commit.current();
      },
    }),
  ).current;
  return (
    <View
      ref={webRef}
      testID="git-sidebar-resizer"
      accessibilityRole="adjustable"
      accessibilityLabel="调整侧栏宽度，方向键每次 10 像素"
      accessibilityValue={{ min: 180, max: 600, now: Math.round(width) }}
      {...(Platform.OS === "web" ? {} : responder.panHandlers)}
      {...(Platform.OS === "web"
        ? {
            role: "separator",
            "aria-orientation": "vertical",
            "aria-valuemin": 180,
            "aria-valuemax": 600,
            "aria-valuenow": Math.round(width),
            tabIndex: 0,
            onKeyDown: (event: { key: string; preventDefault(): void }) => {
              if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) {
                event.preventDefault();
                onChange(
                  event.key === "Home" ? 240 : width + (event.key === "ArrowLeft" ? -10 : 10),
                );
                onCommit();
              }
            },
          }
        : {})}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      style={{
        width: 5,
        marginLeft: -2,
        marginRight: -2,
        zIndex: 2,
        backgroundColor: active ? theme.colors.accent : "transparent",
      }}
    />
  );
}

export function DiffResizer({
  ratio,
  width,
  onChange,
  onCommit,
  theme,
}: {
  ratio: number;
  width: number;
  onChange(ratio: number): void;
  onCommit(): void;
  theme: PluginTheme;
}) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const origin = useRef(ratio);
  const dragWidth = useRef(width);
  const current = useRef({ ratio, width, onChange, onCommit });
  current.current = { ratio, width, onChange, onCommit };
  function change(value: number) {
    current.current.onChange(Math.max(0.2, Math.min(0.8, value)));
  }
  const webRef = useWebDrag(
    () => {
      origin.current = current.current.ratio;
      dragWidth.current = current.current.width;
      setDragging(true);
    },
    (dx) => change(origin.current + dx / Math.max(1, dragWidth.current)),
    () => {
      setDragging(false);
      current.current.onCommit();
    },
    () => {
      change(0.5);
      current.current.onCommit();
    },
  );
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        origin.current = current.current.ratio;
        setDragging(true);
      },
      onPanResponderMove: (_, gesture) =>
        change(origin.current + gesture.dx / Math.max(1, current.current.width)),
      onPanResponderRelease: () => {
        setDragging(false);
        current.current.onCommit();
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        current.current.onCommit();
      },
    }),
  ).current;
  return (
    <View
      ref={webRef}
      testID="git-diff-resizer"
      accessibilityRole="adjustable"
      accessibilityLabel="调整左右对比宽度，方向键调整，Home 或双击恢复均分"
      accessibilityValue={{ min: 20, max: 80, now: Math.round(ratio * 100) }}
      {...(Platform.OS === "web" ? {} : responder.panHandlers)}
      {...(Platform.OS === "web"
        ? {
            role: "separator",
            "aria-orientation": "vertical",
            "aria-valuemin": 20,
            "aria-valuemax": 80,
            "aria-valuenow": Math.round(ratio * 100),
            tabIndex: 0,
            onKeyDown: (event: { key: string; preventDefault(): void }) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                change(
                  event.key === "Home"
                    ? 0.5
                    : event.key === "End"
                      ? 0.8
                      : ratio + (event.key === "ArrowLeft" ? -0.02 : 0.02),
                );
                onCommit();
              }
            },
          }
        : {})}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: `${ratio * 100}%`,
        width: 7,
        marginLeft: -3,
        zIndex: 4,
        alignItems: "center",
        backgroundColor:
          dragging || hovered || focused
            ? mixColor(theme.colors.accent, theme.colors.surface0, 0.2)
            : "transparent",
      }}
    >
      <View
        style={{
          width: dragging || hovered || focused ? 2 : 1,
          flex: 1,
          backgroundColor:
            dragging || hovered || focused ? theme.colors.accent : theme.colors.border,
        }}
      />
    </View>
  );
}
