import type { CompareInput, CompareResult } from "../shared/compare-contracts";
import type { ChangesSnapshot } from "../shared/contracts";

// Adapt pinned revisions to the existing file-tree/tab model without carrying
// working-tree files, staged flags or live submodule pointer warnings into review.
export function reviewSnapshot(
  snapshot: ChangesSnapshot | null,
  repositoryId: string,
  result: CompareResult | undefined,
): ChangesSnapshot | null {
  const repository = snapshot?.repositories.find((item) => item.id === repositoryId);
  if (!snapshot || !repository || !result) return null;
  return {
    ...snapshot,
    comparison: "head",
    version: result.revision,
    repositories: [
      {
        ...repository,
        branch: result.branch,
        head: result.targetOid,
        recordedHead: null,
        indexedHead: null,
        files: result.files,
      },
    ],
  };
}

export function reviewFileKey(repositoryId: string, revision: string, path: string) {
  return JSON.stringify([repositoryId, revision, path]);
}

export function defaultBranchReview(
  history: Pick<import("../shared/history-contracts").GitHistory, "head" | "fork" | "commits">,
  repositoryId: string,
): Omit<CompareInput, "directory"> | null {
  const count = history.fork?.commitCount;
  if (!history.head || !count || count < 0 || !history.fork?.oid) return null;
  const oldest = history.fork.oldestOid ?? history.commits[count - 1]?.oid;
  return oldest
    ? {
        repositoryId,
        selection: { mode: "range", oldest, newest: history.head, workingTree: true },
      }
    : null;
}
