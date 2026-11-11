import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef, useState } from "react";
import { PanResponder, Platform, View } from "react-native";
import { COMMIT_ROW_HEIGHT } from "./commit-graph";
import { moveReviewBoundary, type ReviewBoundary, type ReviewBounds } from "./review-range-model";
import { panelTokens } from "./theme";
import { useWebDrag } from "./web-chrome";

export function ReviewRangeHandles(props: {
  bounds: ReviewBounds;
  last: number;
  offset: number;
  height: number;
  onScroll(offset: number): void;
  onChange(bounds: ReviewBounds): void;
  onCommit(bounds: ReviewBounds): void;
  theme: PluginTheme;
}) {
  return (
    <>
      <RangeHandle {...props} boundary="top" />
      <RangeHandle {...props} boundary="bottom" />
    </>
  );
}

function RangeHandle({
  boundary,
  ...props
}: Parameters<typeof ReviewRangeHandles>[0] & { boundary: ReviewBoundary }) {
  const c = panelTokens(props.theme);
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const current = useRef(props);
  current.current = props;
  const drag = useRef<{
    bounds: ReviewBounds;
    offset: number;
    edge: number;
    dy: number;
    scroll: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbacks = useRef({ start, move, end });
  callbacks.current = { start, move, end };
  function stopTimer() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );
  function update() {
    const state = drag.current;
    if (!state) return;
    const position =
      (state.edge + state.dy + state.scroll - state.offset) / COMMIT_ROW_HEIGHT -
      (boundary === "bottom" ? 1 : 0);
    current.current.onChange(
      moveReviewBoundary(state.bounds, boundary, position, current.current.last),
    );
  }
  function start() {
    const p = current.current;
    drag.current = {
      bounds: p.bounds,
      offset: p.offset,
      edge: (p.bounds[boundary] + (boundary === "bottom" ? 1 : 0)) * COMMIT_ROW_HEIGHT,
      dy: 0,
      scroll: p.offset,
    };
    setActive(true);
    stopTimer();
    timer.current = setInterval(() => {
      const state = drag.current;
      if (!state) return;
      const p = current.current;
      const y = state.edge - state.offset + state.dy;
      const speed = y < 28 ? -17 : y > p.height - 28 ? 17 : 0;
      if (!speed) return;
      const next = Math.max(
        0,
        Math.min(Math.max(0, (p.last + 1) * COMMIT_ROW_HEIGHT - p.height), state.scroll + speed),
      );
      if (next === state.scroll) return;
      state.scroll = next;
      p.onScroll(next);
      update();
    }, 50);
  }
  function move(dy: number) {
    if (drag.current) {
      drag.current.dy = dy;
      update();
    }
  }
  function end() {
    const state = drag.current;
    if (!state) return;
    const position =
      (state.edge + state.dy + state.scroll - state.offset) / COMMIT_ROW_HEIGHT -
      (boundary === "bottom" ? 1 : 0);
    const bounds = moveReviewBoundary(state.bounds, boundary, position, current.current.last);
    drag.current = null;
    stopTimer();
    setActive(false);
    current.current.onCommit(bounds);
  }
  function step(position: number) {
    const p = current.current;
    p.onCommit(moveReviewBoundary(p.bounds, boundary, position, p.last));
  }
  const webRef = useWebDrag(start, move, end, () => {}, "y");
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => callbacks.current.start(),
      onPanResponderMove: (_, gesture) => callbacks.current.move(gesture.dy),
      onPanResponderRelease: () => callbacks.current.end(),
      onPanResponderTerminate: () => callbacks.current.end(),
    }),
  ).current;
  const y =
    (props.bounds[boundary] + (boundary === "bottom" ? 1 : 0)) * COMMIT_ROW_HEIGHT - props.offset;
  const visible = active || (y >= 0 && y <= props.height);
  const edgeY = Math.max(0, Math.min(props.height, y));
  const hitTop = edgeY - 10;
  const edgeWithinHitArea = edgeY - hitTop;
  const gripHeight = active || focused ? 7 : 5;
  const label = boundary === "top" ? "Review 范围上边界" : "Review 范围下边界";
  return (
    <View
      ref={webRef}
      testID={`review-range-${boundary}`}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: props.last, now: props.bounds[boundary] }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) =>
        step(props.bounds[boundary] + (event.nativeEvent.actionName === "increment" ? 1 : -1))
      }
      {...(Platform.OS === "web"
        ? {
            role: "slider",
            "aria-orientation": "vertical",
            "aria-valuemin": 0,
            "aria-valuemax": props.last,
            "aria-valuenow": props.bounds[boundary],
            tabIndex: visible ? 0 : -1,
            onKeyDown: (event: {
              key: string;
              preventDefault(): void;
              stopPropagation(): void;
            }) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              step(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? props.last
                    : props.bounds[boundary] + (event.key === "ArrowUp" ? -1 : 1),
              );
            },
          }
        : responder.panHandlers)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      pointerEvents={visible ? "auto" : "none"}
      style={{
        position: "absolute",
        top: hitTop,
        left: 0,
        right: 0,
        height: 20,
        zIndex: active ? 11 : 10,
        alignItems: "center",
        justifyContent: "center",
        opacity: visible ? 1 : 0,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: edgeWithinHitArea - 0.5,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: active ? "#a190e3" : c.border,
        }}
      />
      <View
        pointerEvents="none"
        testID={`review-range-${boundary}-grip`}
        style={{
          position: "absolute",
          top: edgeWithinHitArea - gripHeight / 2,
          width: 76,
          height: gripHeight,
          borderRadius: 4,
          borderWidth: focused ? 1 : 0,
          borderColor: "#dcd6f5",
          backgroundColor: "#a190e3",
        }}
      />
    </View>
  );
}
