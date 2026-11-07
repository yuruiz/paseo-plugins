import type { CompareResult } from "../shared/compare-contracts";
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
