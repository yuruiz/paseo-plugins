import { expect, it } from "vitest";
import { defaultBranchReview, reviewFileKey, reviewSnapshot } from "../client/review-model";
import { compareRpc } from "../shared/compare-contracts";
import { snapshotSchema } from "../shared/contracts";

const oid = "a".repeat(40);
const target = "b".repeat(40);
const working = snapshotSchema.parse({
  directory: "/workspace",
  comparison: "staged",
  version: "working",
  scannedAt: "now",
  repositories: [".", "modules/lib"].map((id) => ({
    id,
    directory: `/workspace/${id}`,
    relativePath: id === "." ? "" : id,
    parentId: id === "." ? null : ".",
    head: oid,
    branch: "live-branch",
    recordedHead: oid,
    indexedHead: oid,
    state: "ready",
    error: null,
    files: [
      {
        path: "working-only.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        binary: false,
        staged: true,
        unstaged: true,
        version: "dirty",
      },
    ],
  })),
});
const comparison = compareRpc.output.parse({
  baseOid: oid,
  targetOid: target,
  baseRef: "main",
  branch: "captured-branch",
  title: "main → captured-branch",
  commitCount: 2,
  revision: "pinned",
  files: [
    {
      path: "historical.ts",
      status: "deleted",
      additions: 0,
      deletions: 2,
      binary: false,
      staged: false,
      unstaged: false,
      version: "pinned",
    },
  ],
});

it("feeds the original file tree only captured history, never dirty files or live gitlink warnings", () => {
  const result = reviewSnapshot(working, "modules/lib", comparison);
  expect(result?.repositories).toHaveLength(1);
  expect(result?.repositories[0]).toMatchObject({
    id: "modules/lib",
    branch: "captured-branch",
    head: target,
    recordedHead: null,
    indexedHead: null,
    files: [expect.objectContaining({ path: "historical.ts", staged: false, unstaged: false })],
  });
  expect(result).toMatchObject({ comparison: "head", version: "pinned" });
  expect(working.repositories[1].files[0].path).toBe("working-only.ts");
  expect(working.repositories[1].recordedHead).toBe(oid);
});

it("does not fall back to a working snapshot during loading, errors or a missing repository", () => {
  expect(reviewSnapshot(working, ".", undefined)).toBeNull();
  expect(reviewSnapshot(null, ".", comparison)).toBeNull();
  expect(reviewSnapshot(working, "missing", comparison)).toBeNull();
});

it("isolates viewed state across repositories and commit pairs even for identical paths", () => {
  const keys = [
    reviewFileKey(".", "base1:tip1", "src/index.ts"),
    reviewFileKey("modules/lib", "base1:tip1", "src/index.ts"),
    reviewFileKey(".", "base1:tip2", "src/index.ts"),
    reviewFileKey(".", "base1:tip1", "src/other.ts"),
  ];
  expect(new Set(keys).size).toBe(4);
});

it("selects every branch commit and working changes even when the oldest commit is not loaded", () => {
  const oldest = "c".repeat(40);
  const result = defaultBranchReview(
    {
      head: target,
      commits: [],
      fork: { baseRef: "main", oid, oldestOid: oldest, commitCount: 201, message: null },
    },
    "modules/lib",
  );
  expect(result).toEqual({
    repositoryId: "modules/lib",
    selection: { mode: "range", oldest, newest: target, workingTree: true },
  });
});
it("defaults to working changes when there are no branch-exclusive commits or no known fork", () => {
  expect(
    defaultBranchReview(
      {
        head: target,
        commits: [],
        fork: { baseRef: "main", oid: target, commitCount: 0, message: null },
      },
      ".",
    ),
  ).toBeNull();
  expect(
    defaultBranchReview(
      {
        head: target,
        commits: [],
        fork: { baseRef: "main", oid: null, commitCount: null, message: "当前为基准分支" },
      },
      ".",
    ),
  ).toBeNull();
  expect(defaultBranchReview({ head: null, commits: [] }, ".")).toBeNull();
});
