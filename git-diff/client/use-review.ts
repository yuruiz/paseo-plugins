import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type CompareInput, compareRpc } from "../shared/compare-contracts";
import type { ChangesSnapshot } from "../shared/contracts";
import { reviewSnapshot } from "./review-model";

export type ReviewSelection = Omit<CompareInput, "directory">;

export function useReview(
  directory: string,
  selection: ReviewSelection | null,
  snapshot: ChangesSnapshot | null,
) {
  const call = useRpc(compareRpc);
  const query = useQuery({
    queryKey: ["git-review", directory, selection],
    queryFn: () => {
      if (!selection) throw new Error("请选择比较范围。");
      return call({ directory, ...selection });
    },
    enabled: Boolean(selection),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const data = useMemo(
    () => reviewSnapshot(snapshot, selection?.repositoryId ?? ".", query.data),
    [snapshot, selection?.repositoryId, query.data],
  );
  return {
    result: selection ? query.data : undefined,
    changes: {
      data,
      loading: Boolean(selection && query.isPending),
      refreshing: Boolean(selection && query.isFetching),
      error: selection ? (query.error?.message ?? null) : null,
      refresh: () => {
        void query.refetch();
      },
    },
  };
}
