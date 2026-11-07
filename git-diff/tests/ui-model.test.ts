import { expect, it } from "vitest";
import { buildChangeRows, entryKey, folderKey } from "../client/changes-model";
import { repositorySchema } from "../shared/contracts";

function repository(id: string, paths: { path: string; oldPath?: string }[]) {
  return repositorySchema.parse({
    id,
    directory: `/workspace/${id}`,
    relativePath: id === "." ? "" : id,
    parentId: id === "." ? null : ".",
    head: "abc",
    recordedHead: null,
    indexedHead: null,
    state: "ready",
    error: null,
    files: paths.map((file) => ({
      ...file,
      status: file.oldPath ? "renamed" : "modified",
      additions: 1,
      deletions: 1,
      binary: false,
      staged: false,
      unstaged: true,
      version: "v1",
    })),
  });
}

it("keeps identical paths in different repositories independently selectable and collapsible", () => {
  const repos = [
    repository(".", [{ path: "src/index.ts" }]),
    repository("packages/client", [{ path: "src/index.ts" }]),
  ];
  const rows = buildChangeRows(repos, "", true, new Set([folderKey(".", "src")]));
  expect(rows.filter((row) => row.kind === "file").map((row) => row.key)).toEqual([
    entryKey("packages/client", "src/index.ts"),
  ]);
  expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
});

it("reveals filtered descendants of collapsed repositories and folders, including rename origins", () => {
  const repo = repository(".", [
    { path: "src/new.ts", oldPath: "src/old.ts" },
    { path: "docs/readme.md" },
  ]);
  const collapsed = new Set(["repo:.", folderKey(".", "src")]);
  const rows = buildChangeRows([repo], "  OLD.ts  ", true, collapsed);
  expect(rows.filter((row) => row.kind === "file").map((row) => row.file.path)).toEqual([
    "src/new.ts",
  ]);
  expect(rows[0]).toMatchObject({ count: 1 });
  expect(collapsed.size).toBe(2);
});

it("keeps an explicit clean or unavailable repository state and never invents file rows", () => {
  const clean = repository(".", []);
  const unavailable = { ...repository("child", []), state: "uninitialized" as const };
  expect(
    buildChangeRows([clean, unavailable], "", false, new Set()).map((row) => row.kind),
  ).toEqual(["repository", "notice", "repository", "notice"]);
  expect(buildChangeRows([clean, unavailable], "missing", false, new Set())).toEqual([]);
});
