import { entryKey } from "./changes-model";

export type EditorTab = { key: string; repositoryId: string; path: string; label: string };
export type TabsState = { tabs: EditorTab[]; active: string | null };
export type CloseTabs = "close" | "others" | "right" | "left" | "all";
export function openTab(
  state: TabsState,
  entry: { repository: { id: string }; file: { path: string } },
): TabsState {
  const key = entryKey(entry.repository.id, entry.file.path);
  if (state.active === key) return state;
  const exists = state.tabs.some((tab) => tab.key === key);
  return {
    tabs: exists
      ? state.tabs
      : [
          ...state.tabs,
          {
            key,
            repositoryId: entry.repository.id,
            path: entry.file.path,
            label: entry.file.path.split("/").at(-1) || entry.file.path,
          },
        ],
    active: key,
  };
}
export function closeTab(state: TabsState, key: string): TabsState {
  return closeTabs(state, key, "close");
}
export function closeTabs(state: TabsState, key: string, action: CloseTabs): TabsState {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index < 0 && action !== "all") return state;
  const tabs = state.tabs.filter((tab, position) =>
    action === "close"
      ? tab.key !== key
      : action === "others"
        ? tab.key === key
        : action === "left"
          ? position >= index
          : action === "right"
            ? position <= index
            : false,
  );
  if (tabs.length === state.tabs.length) return state;
  const activeIndex = state.tabs.findIndex((tab) => tab.key === state.active);
  return {
    tabs,
    active: tabs.some((tab) => tab.key === state.active)
      ? state.active
      : action === "others"
        ? key
        : (state.tabs.slice(Math.max(0, activeIndex)).find((tab) => tabs.includes(tab))?.key ??
          tabs.at(-1)?.key ??
          null),
  };
}
