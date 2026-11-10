import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  blobHash,
  fingerprint,
  installDirectory,
  readDirectory,
  validateFiles,
  type SyncFile,
} from "./sync-files";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});
let directory: string | undefined;
afterEach(async () => {
  vi.mocked(rename).mockClear();
  if (directory) await rm(directory, { recursive: true, force: true });
});

function file(name: string, contents = "content"): SyncFile {
  const content = Buffer.from(contents);
  return { path: name, content, size: content.length, mode: "100644", sha: blobHash(content) };
}

test("restores the original directory when installing the staged replacement fails", async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "skills-rollback-"));
  const target = path.join(directory, "skill");
  await mkdir(target);
  await writeFile(path.join(target, "SKILL.md"), "original");
  const original = await readDirectory(target);
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(rename)
    .mockImplementationOnce(actual.rename)
    .mockRejectedValueOnce(new Error("install failed"));
  await expect(
    installDirectory(target, [file("SKILL.md", "replacement")], fingerprint(original), target),
  ).rejects.toThrow("install failed");
  expect(await readFile(path.join(target, "SKILL.md"), "utf8")).toBe("original");
  expect(rename).toHaveBeenCalledTimes(3);
});

test.each([
  ["Folder/a", "folder/b"],
  ["same", "same/nested"],
  ["asset", "ASSET"],
  ["é", "e\u0301"],
])("rejects paths that cannot round-trip on another filesystem: %j", (a, b) => {
  expect(() => validateFiles([file("SKILL.md"), file(a), file(b)])).toThrow(
    /Colliding|overlap|duplicate/,
  );
});

test("comparison is independent of file enumeration order", () => {
  const files = [file("SKILL.md"), file("scripts/a"), file("assets/é")];
  expect(fingerprint(files)).toBe(fingerprint([...files].reverse()));
});
