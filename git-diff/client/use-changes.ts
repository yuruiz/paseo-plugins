import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { type CompareResult, compareFileDiffRpc } from "../shared/compare-contracts";
import {
  type ChangesSnapshot,
  type Comparison,
  changesRpc,
  type FileDiff,
  fileDiffRpc,
} from "../shared/contracts";
import { DiffCache } from "../shared/diff-cache";

export function useChanges(
  directory: string,
  comparison: Comparison,
  automatic = true,
  refreshInterval = 2000,
) {
  const call = useRpc(changesRpc);
  const refresh = useRef<(() => void) | null>(null);
  const policyChanged = useRef<(() => void) | null>(null);
  const automaticRef = useRef(automatic);
  automaticRef.current = automatic;
  const intervalRef = useRef(refreshInterval);
  intervalRef.current = refreshInterval;
  const key = JSON.stringify([directory, comparison]);
  const [state, setState] = useState<{
    key: string;
    data: ChangesSnapshot | null;
    error: string | null;
    loading: boolean;
    refreshing: boolean;
  }>({ key, data: null, error: null, loading: true, refreshing: true });
  useEffect(() => {
    let stopped = false;
    let fetching = false;
    let failures = 0;
    let active = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    let timer: ReturnType<typeof setTimeout> | undefined;
    function cancelTimer() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    }
    function schedule() {
      cancelTimer();
      if (!stopped && automaticRef.current && active)
        timer = setTimeout(
          () => {
            void load();
          },
          Math.min(30000, intervalRef.current * 2 ** failures),
        );
    }
    async function load(manual = false) {
      if (fetching || stopped || (!active && !manual)) return;
      fetching = true;
      cancelTimer();
      if (manual) setState((previous) => ({ ...previous, refreshing: true }));
      try {
        const snapshot = await call({ directory, comparison, force: manual });
        failures = 0;
        if (!stopped)
          setState((previous) => {
            // An unchanged poll must not rebuild thousands of rows or reset editor scrolling.
            const same = previous.key === key && previous.data?.version === snapshot.version;
            if (same && !previous.error && !previous.loading && !previous.refreshing)
              return previous;
            return {
              key,
              data: same ? previous.data : snapshot,
              error: null,
              loading: false,
              refreshing: false,
            };
          });
      } catch (error) {
        failures++;
        if (!stopped)
          setState((previous) => ({
            key,
            data: previous.key === key ? previous.data : null,
            error: error instanceof Error ? error.message : String(error),
            loading: false,
            refreshing: false,
          }));
      } finally {
        fetching = false;
        schedule();
      }
    }
    refresh.current = () => {
      void load(true);
    };
    policyChanged.current = () => {
      cancelTimer();
      if (automaticRef.current && active) void load();
    };
    const subscription = AppState.addEventListener("change", (next) => {
      active = next === "active";
      cancelTimer();
      if (active && automaticRef.current) void load();
    });
    // A panel opened while the host is inactive still needs its first snapshot,
    // including one-shot readers with automatic refresh disabled.
    void load(true);
    return () => {
      stopped = true;
      refresh.current = null;
      policyChanged.current = null;
      cancelTimer();
      subscription.remove();
    };
  }, [call, directory, comparison, key]);
  useEffect(() => {
    if (automatic !== undefined && refreshInterval) policyChanged.current?.();
  }, [automatic, refreshInterval]);
  const refreshNow = useCallback(() => refresh.current?.(), []);
  const current =
    state.key === key ? state : { data: null, error: null, loading: true, refreshing: true };
  return { ...current, refresh: refreshNow };
}

export function useFileDiff(
  input: {
    directory: string;
    repositoryId: string;
    path: string;
    version: string;
    revision?: Pick<CompareResult, "baseOid" | "targetOid">;
    comparison: Comparison;
    context: number;
    ignoreWhitespace: boolean;
  } | null,
) {
  const call = useRpc(fileDiffRpc);
  const compareFile = useRpc(compareFileDiffRpc);
  // Each retained Tab owns one current patch. Evicting its pane releases the cache.
  const [cache] = useState(() => new DiffCache(4 * 1024 * 1024, 1));
  const pending = useRef(new Map<string, Promise<FileDiff>>());
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify(input);
  const directory = input?.directory;
  const repositoryId = input?.repositoryId;
  const path = input?.path;
  const comparison = input?.comparison ?? "head";
  const baseOid = input?.revision?.baseOid;
  const targetOid = input?.revision?.targetOid;
  const context = input?.context ?? 3;
  const ignoreWhitespace = input?.ignoreWhitespace ?? false;
  const [state, setState] = useState<{ key: string; data: FileDiff | null; error: string | null }>({
    key,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!directory || !repositoryId || !path) return;
    let stopped = false;
    const cached = cache.get(key);
    if (cached) {
      setState({ key, data: cached, error: null });
      return;
    }
    setState({ key, data: null, error: null });
    const pendingKey = JSON.stringify([key, attempt]);
    let request = pending.current.get(pendingKey);
    if (!request) {
      request = targetOid
        ? compareFile({
            directory,
            repositoryId,
            path,
            baseOid: baseOid ?? null,
            targetOid,
            context,
            ignoreWhitespace,
          })
        : call({ directory, repositoryId, path, comparison, context, ignoreWhitespace });
      pending.current.set(pendingKey, request);
      void request.then(
        (data) => {
          cache.set(key, data);
          pending.current.delete(pendingKey);
        },
        () => {
          pending.current.delete(pendingKey);
        },
      );
    }
    void request.then(
      (data) => {
        if (!stopped) setState({ key, data, error: null });
      },
      (error: unknown) => {
        if (!stopped)
          setState({
            key,
            data: null,
            error: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      stopped = true;
    };
  }, [
    call,
    compareFile,
    baseOid,
    targetOid,
    key,
    directory,
    repositoryId,
    path,
    comparison,
    context,
    ignoreWhitespace,
    cache,
    attempt,
  ]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...(state.key === key ? state : { data: cache.get(key) ?? null, error: null }), retry };
}
