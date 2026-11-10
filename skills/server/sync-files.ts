import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseFrontmatter } from "./resolve/frontmatter";

export type SyncFile = {
  path: string;
  mode: "100644" | "100755";
  sha: string;
  size: number;
  content?: Buffer;
};
export const MAX_FILES = 500;
export const MAX_BYTES = 10 * 1024 * 1024;
const EXCLUDED = new Set([".git", "node_modules", "__pycache__", ".ds_store"]);

export function validName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) && !name.endsWith(".");
}

export function safePath(value: string): boolean {
  return value
    .split("/")
    .every(
      (part) =>
        part.length > 0 &&
        part !== "." &&
        part !== ".." &&
        !/[\\<>:"|?*]/.test(part) &&
        ![...part].some((char) => char.charCodeAt(0) < 32) &&
        !/[. ]$/.test(part) &&
        !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part) &&
        !EXCLUDED.has(part.toLowerCase()),
    );
}

export function blobHash(content: Buffer): string {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

export function fingerprint(files: SyncFile[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...files]
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
          .map(({ path, mode, sha }) => [path, mode, sha]),
      ),
    )
    .digest("hex");
}

export function validateFiles(files: SyncFile[]) {
  if (files.length > MAX_FILES || files.reduce((size, file) => size + file.size, 0) > MAX_BYTES)
    throw new Error("Skill exceeds 500 files or 10 MiB.");
  const names = new Set<string>();
  const spellings = new Map<string, string>();
  for (const file of files) {
    const normalized = file.path.normalize("NFC").toLowerCase();
    if (!safePath(file.path) || names.has(normalized))
      throw new Error(`Unsafe or duplicate file path: ${file.path}`);
    if (file.mode !== "100644" && file.mode !== "100755")
      throw new Error(`Only regular files can sync: ${file.path}`);
    names.add(normalized);
    const parts = file.path.split("/");
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join("/");
      const key = prefix.normalize("NFC").toLowerCase();
      const existing = spellings.get(key);
      if (existing && existing !== prefix)
        throw new Error(`Colliding file paths: ${existing}, ${prefix}`);
      spellings.set(key, prefix);
    }
  }
  for (const file of files) {
    const parts = file.path.normalize("NFC").toLowerCase().split("/");
    while (parts.length > 1) {
      parts.pop();
      if (names.has(parts.join("/"))) throw new Error("File and directory paths overlap.");
    }
  }
  if (!files.some((file) => file.path === "SKILL.md")) throw new Error("Missing SKILL.md.");
}

export function validateSkill(files: SyncFile[], name: string) {
  validateFiles(files);
  const raw = files.find((file) => file.path === "SKILL.md")?.content;
  if (!raw) throw new Error("Missing SKILL.md content.");
  const { frontmatter } = parseFrontmatter(raw.toString("utf8"));
  if (frontmatter.name !== name || !frontmatter.description?.trim())
    throw new Error("SKILL.md name must match its sync name and have a description.");
}

export async function readDirectory(directory: string): Promise<SyncFile[]> {
  const root = await realpath(directory);
  const files: SyncFile[] = [];
  let bytes = 0;
  let entries = 0;
  async function walk(relative: string) {
    if (relative.split("/").length > 32)
      throw new Error("Skill directory nesting exceeds 32 levels.");
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (EXCLUDED.has(entry.name.toLowerCase())) continue;
      if (++entries > 2000) throw new Error("Skill exceeds 2,000 directory entries.");
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!safePath(name)) throw new Error(`Unsupported file path: ${name}`);
      const fullPath = path.join(root, name);
      const stat = await lstat(fullPath);
      if (stat.isSymbolicLink()) throw new Error(`Nested symlinks cannot sync: ${name}`);
      if (stat.isDirectory()) {
        await walk(name);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Not a regular file: ${name}`);
      bytes += stat.size;
      if (files.length >= MAX_FILES || bytes > MAX_BYTES)
        throw new Error("Skill exceeds 500 files or 10 MiB.");
      const content = await readFile(fullPath);
      files.push({
        path: name,
        mode: stat.mode & 0o111 ? "100755" : "100644",
        sha: blobHash(content),
        size: content.length,
        content,
      });
    }
  }
  await walk("");
  validateFiles(files);
  return files;
}

export async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function resolvedTarget(target: string): Promise<string> {
  if (await exists(target)) return realpath(target);
  const parent = path.dirname(target);
  if (parent === target) throw new Error("Cannot resolve sync destination.");
  return path.join(await resolvedTarget(parent), path.basename(target));
}

export async function installDirectory(
  destination: string,
  files: SyncFile[],
  expectedHash: string | null,
  expectedTarget: string,
): Promise<string | null> {
  if ((await resolvedTarget(destination)) !== expectedTarget)
    throw new Error("Download destination moved. Compare again.");
  await mkdir(path.dirname(destination), { recursive: true });
  const parent = await realpath(path.dirname(destination));
  const target = path.join(parent, path.basename(destination));
  const container = path.join(parent, ".paseo-sync");
  const work = path.join(container, "versions");
  for (const dir of [container, work])
    if ((await exists(dir)) && (await lstat(dir)).isSymbolicLink())
      throw new Error("Sync backup directory cannot be a symlink.");
  await mkdir(work, { recursive: true, mode: 0o700 });
  const staging = path.join(work, `staging-${randomUUID()}`);
  const backup = path.join(work, `backup-${path.basename(destination)}-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const file of files) {
      const filePath = path.join(staging, file.path);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content!, {
        flag: "wx",
        mode: file.mode === "100755" ? 0o755 : 0o644,
      });
    }
    if ((await resolvedTarget(destination)) !== expectedTarget)
      throw new Error("Download destination moved. Compare again.");
    const present = await exists(target);
    if (present && (await lstat(target)).isSymbolicLink())
      throw new Error("Download cannot replace a symlinked skill. Update its source instead.");
    if (
      present !== (expectedHash !== null) ||
      (present && fingerprint(await readDirectory(target)) !== expectedHash)
    )
      throw new Error("Local skill changed. Compare again before downloading.");
    if (present) await rename(target, backup);
    try {
      await rename(staging, target);
    } catch (error) {
      if (present) {
        try {
          await rename(backup, target);
        } catch {
          throw new Error(
            `Installation and restoration failed. The original skill is preserved at ${backup}.`,
          );
        }
      }
      throw error;
    }
    return present ? backup : null;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
