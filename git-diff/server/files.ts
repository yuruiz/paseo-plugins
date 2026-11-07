import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, extname, relative, sep } from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import type { Comparison, FileContent, RepositorySnapshot } from "../shared/contracts";
import { GitError, git } from "./git";
import { MAX_FILE_BYTES, resolveFile } from "./repositories";

const imageTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
};
function contentResult(path: string, comparison: Comparison): FileContent {
  return {
    path,
    source: comparison === "staged" ? "index" : "working",
    state: "text",
    content: "",
    message: null,
  };
}
export async function readContent(
  repository: RepositorySnapshot,
  path: string,
  comparison: Comparison,
): Promise<FileContent> {
  const result = contentResult(path, comparison);
  let bytes: Buffer;
  try {
    if (comparison === "staged") {
      // Use the actual index blob, never the working file for staged previews.
      const file = repository.files.find((file) => file.path === path);
      if (file?.status === "deleted")
        return { ...result, state: "missing", message: "此文件已从暂存区删除。" };
      const size = Number(
        (await git(repository.directory, ["cat-file", "-s", `:0:${path}`])).trim(),
      );
      if (size > MAX_FILE_BYTES)
        return { ...result, state: "too_large", message: "文件超过 1 MiB，无法预览。" };
      bytes = Buffer.from(
        await git(repository.directory, ["show", `:0:${path}`], {
          maxBuffer: MAX_FILE_BYTES + 1,
          encoding: "base64",
        }),
        "base64",
      );
    } else {
      const absolute = resolveFile(repository.directory, path);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink() || !stat.isFile())
        return { ...result, state: "unsupported", message: "符号链接和目录不支持文件预览。" };
      const canonical = await realpath(absolute);
      const delta = relative(repository.directory, canonical);
      if (delta === ".." || delta.startsWith(`..${sep}`))
        throw new Error("预览文件必须位于所属仓库内。");
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if ((await handle.stat()).size > MAX_FILE_BYTES)
          return { ...result, state: "too_large", message: "文件超过 1 MiB，无法预览。" };
        const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const chunk = await handle.read(buffer, offset, buffer.length - offset, null);
          if (!chunk.bytesRead) break;
          offset += chunk.bytesRead;
        }
        bytes = buffer.subarray(0, offset);
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { ...result, state: "missing", message: "文件已删除，请切换差异查看原始内容。" };
    if (error instanceof GitError && error.tooLarge)
      return { ...result, state: "too_large", message: "文件超过 1 MiB，无法预览。" };
    throw error;
  }
  if (bytes.length > MAX_FILE_BYTES)
    return { ...result, state: "too_large", message: "文件超过 1 MiB，无法预览。" };
  const mime = imageTypes[extname(path).toLowerCase()];
  if (mime)
    return {
      ...result,
      state: "image",
      content: `data:${mime};base64,${bytes.toString("base64")}`,
    };
  if (bytes.includes(0))
    return { ...result, state: "binary", message: "此文件是二进制文件，无法显示文本预览。" };
  return { ...result, content: bytes.toString("utf8") };
}

export function fileCapabilities() {
  return {
    reveal: ["darwin", "win32", "linux"].includes(process.platform),
    label:
      process.platform === "darwin"
        ? "在 Finder 中显示"
        : process.platform === "win32"
          ? "在文件资源管理器中显示"
          : "打开所在文件夹",
    platform: process.platform,
  };
}
export async function revealTarget(repository: RepositorySnapshot, path: string) {
  let target = path === "." ? repository.directory : resolveFile(repository.directory, path);
  let directory = path === ".";
  while (true) {
    try {
      directory = (await lstat(target)).isDirectory();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || target === repository.directory)
        throw error;
      target = dirname(target);
      directory = true;
    }
  }
  return { target, directory };
}
export async function revealInFileManager(repository: RepositorySnapshot, path: string) {
  const { target, directory } = await revealTarget(repository, path);
  if (process.platform === "darwin")
    await execCommand("/usr/bin/open", ["-R", target], { shell: false, timeout: 5000 });
  else if (process.platform === "win32")
    await execCommand("explorer.exe", ["/select,", target], { shell: false, timeout: 5000 });
  else if (process.platform === "linux")
    await execCommand("xdg-open", [directory ? target : dirname(target)], {
      shell: false,
      timeout: 5000,
    });
  else throw new Error("当前主机不支持打开文件管理器。");
  return { revealed: true, directory };
}
