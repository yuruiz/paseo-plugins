import { symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { revealTarget } from "../server/files";
import { GitChangesService } from "../server/service";
import { addModule, command, commit, fixture, put } from "./fixtures";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const f = await fixture();
  cleanups.push(f.close);
  const directory = await f.repo("preview");
  const service = new GitChangesService();
  cleanups.push(() => service.close());
  return { ...f, directory, service };
}
it("previews the actual index separately from working content including staged image bytes", async () => {
  const { directory, service } = await setup();
  await put(directory, "readme.md", "# Original\n");
  await commit(directory);
  await put(directory, "readme.md", "# Index\n");
  const image = Buffer.from([137, 80, 78, 71, 0, 255, 128]);
  await put(directory, "image.png", image);
  await command(directory, "add", "readme.md", "image.png");
  await put(directory, "readme.md", "# Working\n");
  const input = { directory, repositoryId: ".", path: "readme.md" };
  expect(await service.content({ ...input, comparison: "staged" })).toMatchObject({
    state: "text",
    source: "index",
    content: "# Index\n",
  });
  expect(await service.content({ ...input, comparison: "head" })).toMatchObject({
    state: "text",
    source: "working",
    content: "# Working\n",
  });
  expect(
    (await service.content({ ...input, path: "image.png", comparison: "staged" })).content,
  ).toBe(`data:image/png;base64,${image.toString("base64")}`);
});
it("returns deliberate states for deleted, binary and large files", async () => {
  const { directory, service } = await setup();
  await put(directory, "deleted.html", "before");
  await commit(directory);
  await unlink(join(directory, "deleted.html"));
  await put(directory, "binary.dat", Buffer.from([0, 1, 2]));
  await put(directory, "large.html", "x".repeat(1024 * 1024 + 1));
  const input = { directory, repositoryId: ".", comparison: "head" as const };
  expect((await service.content({ ...input, path: "deleted.html" })).state).toBe("missing");
  expect((await service.content({ ...input, path: "binary.dat" })).state).toBe("binary");
  expect((await service.content({ ...input, path: "large.html" })).state).toBe("too_large");
});
it("rejects unknown files, repository escape paths and worktree symlinks", async () => {
  const { directory, service, base } = await setup();
  await put(directory, "known.md", "known");
  await commit(directory);
  await put(base, "private.md", "outside");
  await symlink(join(base, "private.md"), join(directory, "linked.md"));
  const input = { directory, repositoryId: ".", comparison: "head" as const };
  await expect(service.content({ ...input, path: "../private.md" })).rejects.toThrow();
  await expect(service.content({ ...input, path: "known.md" })).rejects.toThrow();
  expect((await service.content({ ...input, path: "linked.md" })).state).toBe("unsupported");
});
it("reveals deleted files at their nearest existing parent without shell interpretation", async () => {
  const { directory, service } = await setup();
  await put(directory, "folder/$(touch danger).md", "old");
  await commit(directory);
  await unlink(join(directory, "folder/$(touch danger).md"));
  const snapshot = await service.snapshot({ directory, comparison: "head" });
  expect(await revealTarget(snapshot.repositories[0], "folder/$(touch danger).md")).toEqual({
    target: join(snapshot.repositories[0].directory, "folder"),
    directory: true,
  });
  await expect(revealTarget(snapshot.repositories[0], "../outside")).rejects.toThrow();
});
it("opens unchanged linked files, root-relative paths, encoded names and nested submodule targets", async () => {
  const { directory, service, repo } = await setup();
  await put(directory, "docs/source.md", "# Source");
  await put(directory, "docs/target file.md", "# Destination");
  await put(directory, "README.md", "# Root");
  const child = await repo("child");
  await put(child, "guide.md", "# Child");
  await commit(child);
  await addModule(directory, child, "modules/child");
  await commit(directory);
  const source = { directory, repositoryId: ".", path: "docs/source.md" };
  const target = await service.resolveLink({ ...source, href: "target%20file.md#destination" });
  expect(target).toMatchObject({
    repositoryId: ".",
    path: "docs/target file.md",
    kind: "file",
    fragment: "destination",
  });
  await expect(
    service.content({
      directory,
      repositoryId: target.repositoryId,
      path: target.path,
      comparison: "head",
    }),
  ).rejects.toThrow("变更列表");
  expect(
    await service.content({
      directory,
      repositoryId: target.repositoryId,
      path: target.path,
      comparison: "head",
      scope: "workspace",
    }),
  ).toMatchObject({ content: "# Destination", source: "working" });
  expect(await service.resolveLink({ ...source, href: "/README.md" })).toMatchObject({
    repositoryId: ".",
    path: "README.md",
  });
  expect(await service.resolveLink({ ...source, href: "../modules/child/guide.md" })).toMatchObject(
    { repositoryId: "modules/child", path: "guide.md" },
  );
  expect(
    await service.resolveLink({
      directory,
      repositoryId: "modules/child",
      path: "guide.md",
      href: "../../README.md",
    }),
  ).toMatchObject({ repositoryId: ".", path: "README.md" });
  expect(
    await service.resolveLink({
      ...source,
      href: pathToFileURL(join(directory, "README.md")).href,
    }),
  ).toMatchObject({ path: "README.md" });
  expect(await service.resolveLink({ ...source, href: "../" })).toMatchObject({
    path: ".",
    kind: "directory",
  });
  expect(await service.resolveLink({ ...source, href: "./" })).toMatchObject({
    path: "docs",
    kind: "directory",
  });
});
it("confines linked and directly requested workspace files including symlink aliases", async () => {
  const { directory, service, base } = await setup();
  await put(directory, "docs/source.md", "source");
  await put(directory, "clean.md", "clean");
  await commit(directory);
  await put(base, "outside.md", "private");
  await symlink(join(base, "outside.md"), join(directory, "outside-link.md"));
  await symlink(join(directory, ".git/config"), join(directory, "internal-link.md"));
  await put(directory, "large.txt", "x".repeat(1024 * 1024 + 1));
  const source = { directory, repositoryId: ".", path: "docs/source.md" };
  for (const href of [
    "../../outside.md",
    pathToFileURL(join(base, "outside.md")).href,
    "../outside-link.md",
    "../.git/config",
    "../internal-link.md",
    "missing.md",
    "javascript:bad",
  ]) {
    await expect(service.resolveLink({ ...source, href })).rejects.toThrow();
  }
  for (const path of ["../outside.md", "outside-link.md", ".git/config", "internal-link.md"]) {
    await expect(
      service.content({
        directory,
        repositoryId: ".",
        path,
        comparison: "head",
        scope: "workspace",
      }),
    ).rejects.toThrow();
  }
  expect(
    (
      await service.content({
        directory,
        repositoryId: ".",
        path: "large.txt",
        comparison: "head",
        scope: "workspace",
      })
    ).state,
  ).toBe("too_large");
});
