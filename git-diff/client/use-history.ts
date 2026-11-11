import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileDiff } from "../shared/contracts";
import {
  type CommitDetails,
  commitFileDiffRpc,
  commitRpc,
  type GitHistory,
  historyRpc,
} from "../shared/history-contracts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useHistory(
  directory: string,
  repositoryId: string,
  ref: string,
  firstParent = false,
  baseRef = "auto",
) {
  const call = useRpc(historyRpc);
  const key = JSON.stringify([directory, repositoryId, ref, firstParent, baseRef]);
  const generation = useRef(0);
  const fetchingMore = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    attempt: number;
    data: GitHistory | null;
    error: string | null;
    loading: boolean;
    loadingMore: boolean;
  }>({ key, attempt, data: null, error: null, loading: true, loadingMore: false });
  const current = useRef(state);
  current.current = state;
  useEffect(() => {
    const request = ++generation.current;
    fetchingMore.current = false;
    setState((previous) => ({
      key,
      attempt,
      data: previous.key === key ? previous.data : null,
      error: null,
      loading: true,
      loadingMore: false,
    }));
    void call({ directory, repositoryId, ref, firstParent, baseRef }).then(
      (data) => {
        if (generation.current === request)
          setState({ key, attempt, data, error: null, loading: false, loadingMore: false });
      },
      (error: unknown) => {
        if (generation.current === request)
          setState((previous) => ({ ...previous, key, error: message(error), loading: false }));
      },
    );
    return () => {
      generation.current++;
    };
  }, [call, directory, repositoryId, ref, firstParent, baseRef, key, attempt]);
  const loadMore = useCallback(async () => {
    const state = current.current;
    if (
      state.key !== key ||
      state.attempt !== attempt ||
      state.loading ||
      fetchingMore.current ||
      !state.data?.hasMore
    )
      return;
    const request = generation.current;
    fetchingMore.current = true;
    setState((previous) => ({ ...previous, loadingMore: true, error: null }));
    try {
      const next = await call({
        directory,
        repositoryId,
        ref,
        firstParent,
        baseRef,
        offset: state.data.commits.length,
        revision: state.data.revision,
      });
      if (generation.current !== request) return;
      setState((previous) => ({
        ...previous,
        data: { ...next, commits: [...(previous.data?.commits ?? []), ...next.commits] },
        loadingMore: false,
      }));
    } catch (error) {
      if (generation.current === request)
        setState((previous) => ({ ...previous, error: message(error), loadingMore: false }));
    } finally {
      if (generation.current === request) fetchingMore.current = false;
    }
  }, [call, directory, repositoryId, ref, firstParent, baseRef, key, attempt]);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    ...(state.key === key ? state : { data: null, error: null, loading: true, loadingMore: false }),
    refresh,
    loadMore,
    loading: state.key !== key || state.attempt !== attempt || state.loading,
  };
}

function useRead<T>(key: string | null, read: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = key ? JSON.stringify([key, attempt]) : null;
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!requestKey) return;
    let stopped = false;
    setState({ key: requestKey, data: null, error: null });
    void read().then(
      (data) => {
        if (!stopped) setState({ key: requestKey, data, error: null });
      },
      (error: unknown) => {
        if (!stopped) setState({ key: requestKey, data: null, error: message(error) });
      },
    );
    return () => {
      stopped = true;
    };
  }, [requestKey, read]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...(state.key === requestKey ? state : { data: null, error: null }), retry };
}

export function useCommit(directory: string, repositoryId: string, oid: string | null) {
  const call = useRpc(commitRpc);
  const read = useCallback(
    () => call({ directory, repositoryId, oid: oid ?? "" }),
    [call, directory, repositoryId, oid],
  );
  return useRead<CommitDetails>(oid ? JSON.stringify([directory, repositoryId, oid]) : null, read);
}

export function useCommitDiff(
  directory: string,
  repositoryId: string,
  oid: string,
  path: string,
  context: number,
  ignoreWhitespace: boolean,
) {
  const call = useRpc(commitFileDiffRpc);
  const read = useCallback(
    () => call({ directory, repositoryId, oid, path, context, ignoreWhitespace }),
    [call, directory, repositoryId, oid, path, context, ignoreWhitespace],
  );
  const patch = useRead<FileDiff>(
    JSON.stringify([directory, repositoryId, oid, path, context, ignoreWhitespace]),
    read,
  );
  const loadFullContext = useCallback(
    () => call({ directory, repositoryId, oid, path, context: 1000000, ignoreWhitespace }),
    [call, directory, repositoryId, oid, path, ignoreWhitespace],
  );
  return { ...patch, loadFullContext };
}
