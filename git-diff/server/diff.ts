import { lstat } from "node:fs/promises";
import type { Comparison, FileDiff, RepositorySnapshot } from "../shared/contracts";
import { DIFF_OPTIONS, GitError, git } from "./git";
import { parseHunks } from "./parsers";
import { comparisonArgs, MAX_FILE_BYTES, resolveFile } from "./repositories";

export async function readFileDiff(
  repository: RepositorySnapshot,
  path: string,
  comparison: Comparison,
  context = 3,
  ignoreWhitespace = false,
): Promise<FileDiff> {
  const change = repository.files.find((file) => file.path === path);
  if (!change) throw new Error("该文件已不在当前变更列表中，请刷新后重试。");
  const result: FileDiff = {
    path,
    ...(change.oldPath ? { oldPath: change.oldPath } : {}),
    state: "empty",
    patch: "",
    hunks: [],
    message: null,
  };
  if (change.status === "conflicted" && comparison !== "head") {
    return {
      ...result,
      message: "文件存在未解决的合并冲突，请切换全部未提交查看工作目录中的冲突标记。",
    };
  }
  const absolute = resolveFile(repository.directory, path);
  try {
    const stat = await lstat(absolute);
    if (stat.isDirectory())
      return { ...result, message: "这是未注册的嵌套仓库目录，请单独打开该仓库。" };
    if (comparison !== "staged" && stat.size > MAX_FILE_BYTES)
      return {
        ...result,
        state: "too_large",
        message: "文件超过 1 MiB，保留变更状态和统计；请在本地 Git 工具中查看完整内容。",
      };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const options = [
    ...DIFF_OPTIONS,
    `--unified=${context}`,
    ...(ignoreWhitespace ? ["--ignore-all-space"] : []),
  ];
  let patch: string;
  try {
    if (change.status === "untracked" || (!repository.head && comparison === "head")) {
      patch = await git(
        repository.directory,
        ["diff", ...options, "--no-index", "--", "/dev/null", path],
        { acceptDifference: true, maxBuffer: 2 * 1024 * 1024 },
      );
    } else {
      const paths = change.oldPath ? [change.oldPath, path] : [path];
      patch = await git(
        repository.directory,
        [
          "diff",
          ...options,
          ...comparisonArgs(comparison, Boolean(repository.head)),
          "--",
          ...paths,
        ],
        { maxBuffer: 2 * 1024 * 1024 },
      );
    }
  } catch (error) {
    if (error instanceof GitError && error.tooLarge)
      return {
        ...result,
        state: "too_large",
        message: "补丁超过 2 MiB，请在本地 Git 工具中查看完整内容。",
      };
    throw error;
  }
  const binary =
    change.binary || /^Binary files .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch);
  if (binary)
    return { ...result, state: "binary", patch, message: "二进制文件已变化，无法显示文本行差异。" };
  const hunks = parseHunks(patch);
  return {
    ...result,
    patch,
    hunks,
    state: hunks.length ? "text" : "empty",
    message: hunks.length
      ? null
      : patch
        ? "仅文件名、类型或权限等元数据发生变化。"
        : ignoreWhitespace
          ? "忽略空白后没有文本差异。"
          : "当前没有文本差异。",
  };
}
