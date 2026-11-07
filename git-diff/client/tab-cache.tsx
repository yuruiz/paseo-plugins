import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { retainedTabs, type TabStats } from "../shared/tab-cache";

// Store committed element props, so hidden panes stay mounted without updating
// or fetching on every repository poll. React retains each pane's own state/DOM.
export function TabCache({
  active,
  open,
  limit,
  stats,
  children,
}: {
  active: string | null;
  open: string[];
  limit: number;
  stats: Record<string, TabStats>;
  children: ReactNode;
}) {
  const cache = useRef(new Map<string, ReactNode>());
  const retained = retainedTabs([...cache.current.keys()], open, active, limit, stats);
  useLayoutEffect(() => {
    if (active && retained.includes(active)) {
      cache.current.delete(active);
      cache.current.set(active, children);
    }
    for (const key of cache.current.keys()) if (!retained.includes(key)) cache.current.delete(key);
  });
  return (
    <View testID="git-tab-cache" style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
      {!active ? children : null}
      {/* Keep DOM order independent of recency: moving an iframe reloads its document. */}
      {open
        .filter((key) => retained.includes(key))
        .map((key) => (
          <View
            key={key}
            ref={(node) => {
              if (Platform.OS !== "web" || !node) return;
              const element = node as unknown as { style: { visibility: string }; inert: boolean };
              element.style.visibility = key === active ? "visible" : "hidden";
              element.inert = key !== active;
            }}
            testID="git-tab-pane"
            pointerEvents={key === active ? "auto" : "none"}
            accessibilityElementsHidden={key !== active}
            importantForAccessibility={key === active ? "auto" : "no-hide-descendants"}
            {...(Platform.OS === "web"
              ? {
                  "aria-hidden": key !== active,
                  dataSet: { tabKey: key, active: String(key === active) },
                }
              : {})}
            style={{
              position: "absolute",
              inset: 0,
              minHeight: 0,
              minWidth: 0,
              opacity: key === active ? 1 : 0,
            }}
          >
            {key === active ? children : cache.current.get(key)}
          </View>
        ))}
    </View>
  );
}
