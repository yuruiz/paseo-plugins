import { devNull } from "node:os";
import type { CompareInput, CompareResult } from "../shared/compare-contracts";
import type { FileChange } from "../shared/contracts";
import { DIFF_OPTIONS, git } from "./git";
import { readCommitDiff } from "./history";
import { parseNameStatus, parseNumstat } from "./parsers";
import { digest } from "./repositories";

async function resolveCommit(directory: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith("-") || [...ref].some((character) => character.charCodeAt(0) <= 32))
    throw new Error("无效的 Git 引用。");
  try {
    return (
      await git(directory, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
    ).trim();
  } catch {
    throw new Error(`本地没有可用的提交：${ref}。请刷新；远端提交需先自行 fetch。`);
  }
}

export async function defaultBase(directory: string): Promise<string> {
  const remoteHead = (
    await git(directory, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], {
      acceptDifference: true,
    })
  ).trim();
  const refs = (
    await git(directory, ["for-each-ref", "--format=%(refname)", "refs/heads/", "refs/remotes/"])
  )
    .trim()
    .split("\n");
  for (const candidate of [
    remoteHead,
    "refs/heads/main",
    "refs/heads/master",
    "refs/remotes/origin/main",
    "refs/remotes/origin/master",
  ])
    if (candidate && refs.includes(candidate)) return candidate;
  throw new Error("未找到默认分支，请手动选择基准分支。");
}

async function comparisonFiles(
  directory: string,
  base: string,
  target: string,
): Promise<FileChange[]> {
  const revisions = [base, target];
  const [names, numbers] = await Promise.all([
    git(directory, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      ...DIFF_OPTIONS,
      "--name-status",
      "-z",
      ...revisions,
      "--",
    ]),
    git(directory, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      ...DIFF_OPTIONS,
      "--numstat",
      "-z",
      ...revisions,
      "--",
    ]),
  ]);
  const stats = parseNumstat(numbers);
  return parseNameStatus(names).map((file) => ({
    ...file,
    ...(stats.get(file.path) ?? { additions: 0, deletions: 0, binary: false }),
    staged: false,
    unstaged: false,
    version: digest([base, target]),
  }));
}

// A null base means the empty tree, even when target is not itself a root commit.
async function emptyTree(directory: string): Promise<string> {
  // hash-object without -w does not write an object or run external filters.
  return (await git(directory, ["hash-object", "-t", "tree", devNull])).trim();
}

export async function readComparison(
  directory: string,
  input: CompareInput,
): Promise<CompareResult> {
  const branch =
    (
      await git(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
        acceptDifference: true,
      })
    ).trim() || null;
  let baseOid: string | null;
  let targetOid: string;
  let baseRef: string;
  let title: string;
  let commitCount: number;
  if (input.selection.mode === "branch") {
    const { selection } = input;
    baseRef = selection.baseRef === "auto" ? await defaultBase(directory) : selection.baseRef;
    const baseTip = await resolveCommit(directory, baseRef);
    targetOid = await resolveCommit(directory, "HEAD");
    if (selection.strategy === "merge-base") {
      const bases = (
        await git(directory, ["merge-base", "--all", baseTip, targetOid], {
          acceptDifference: true,
        })
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      if (bases.length !== 1)
        throw new Error(
          bases.length
            ? "存在多个共同祖先，请选择直接比较分支端点。"
            : "未找到共同祖先（可能是无关历史或浅克隆），请选择直接比较或补全历史。",
        );
      baseOid = bases[0];
    } else baseOid = baseTip;
    commitCount = Number(
      (await git(directory, ["rev-list", "--count", `${baseTip}..${targetOid}`, "--"])).trim(),
    );
    title = `${baseRef.replace(/^refs\/(heads|remotes)\//, "")} → ${branch ?? targetOid.slice(0, 8)}${selection.strategy === "merge-base" ? " · 分支引入的改动" : " · 端点比较"}`;
  } else {
    const oldest = await resolveCommit(directory, input.selection.oldest);
    targetOid = await resolveCommit(directory, input.selection.newest);
    const chain = (
      await git(directory, ["rev-list", "--first-parent", "--max-count=10001", targetOid, "--"])
    )
      .trim()
      .split("\n");
    const index = chain.indexOf(oldest);
    if (index < 0)
      throw new Error(
        "起点必须在终点的第一父提交链上，且区间不能超过 10000 个提交。请重新选择连续区间。",
      );
    if (index >= 10000) throw new Error("区间不能超过 10000 个提交。");
    const raw = await git(directory, ["cat-file", "commit", oldest]);
    const parent = /^parent ([\da-f]{40,64})$/m.exec(raw.slice(0, raw.indexOf("\n\n")))?.[1];
    baseOid = parent ? await resolveCommit(directory, parent) : null;
    baseRef = oldest;
    commitCount = index + 1;
    title = `${oldest.slice(0, 8)} … ${targetOid.slice(0, 8)} · ${commitCount} 个提交（含首尾）`;
  }
  const files = await comparisonFiles(
    directory,
    baseOid ?? (await emptyTree(directory)),
    targetOid,
  );
  return {
    baseOid,
    targetOid,
    baseRef,
    branch,
    title,
    commitCount,
    files,
    revision: digest([baseOid, targetOid]),
  };
}

export async function readComparisonDiff(
  directory: string,
  baseOid: string | null,
  targetOid: string,
  path: string,
  context: number,
  ignoreWhitespace: boolean,
) {
  // Resolve/validate immutable object IDs again because the repository may have been pruned.
  const target = await resolveCommit(directory, targetOid);
  const base = baseOid ? await resolveCommit(directory, baseOid) : await emptyTree(directory);
  const files = await comparisonFiles(directory, base, target);
  return readCommitDiff(
    directory,
    { oid: target, parents: [base], files },
    path,
    context,
    ignoreWhitespace,
  );
}
