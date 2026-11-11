import { useCallback, useSyncExternalStore } from "react";
import type { TabsState } from "./editor-model";
import type { ReviewSelection } from "./use-review";

type Session = {
  review: ReviewSelection | null;
  repositoryId: string;
  tabs: TabsState;
  reviewed: Set<string>;
};
const sessions = new Map<string, { value: Session; listeners: Set<() => void> }>();
function session(key: string) {
  let entry = sessions.get(key);
  if (!entry) {
    entry = {
      value: {
        review: null,
        repositoryId: ".",
        tabs: { tabs: [], active: null },
        reviewed: new Set(),
      },
      listeners: new Set(),
    };
    sessions.set(key, entry);
  }
  return entry;
}
type Update<T> = T | ((previous: T) => T);
export function useReviewSession(key: string) {
  const store = session(key);
  const state = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        store.listeners.add(listener);
        return () => {
          store.listeners.delete(listener);
        };
      },
      [store],
    ),
    () => store.value,
    () => store.value,
  );
  const update = useCallback(
    <K extends keyof Session>(field: K, value: Update<Session[K]>) => {
      const next =
        typeof value === "function"
          ? (value as (previous: Session[K]) => Session[K])(store.value[field])
          : value;
      if (Object.is(next, store.value[field])) return;
      store.value = { ...store.value, [field]: next };
      store.listeners.forEach((listener) => {
        listener();
      });
    },
    [store],
  );
  return {
    key,
    ...state,
    setReview: useCallback((value: ReviewSelection | null) => update("review", value), [update]),
    setRepositoryId: useCallback((value: string) => update("repositoryId", value), [update]),
    setTabs: useCallback((value: Update<TabsState>) => update("tabs", value), [update]),
    setReviewed: useCallback((value: Update<Set<string>>) => update("reviewed", value), [update]),
  };
}
