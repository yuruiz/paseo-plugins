import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BranchFork, GitRef } from "../shared/history-contracts";
import { git } from "./git";

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

export async function branchFork(
  directory: string,
  head: string,
  branch: string | null,
  refs: GitRef[],
  requested: string,
): Promise<BranchFork> {
  let baseRef = requested;
  try {
    if (baseRef === "auto") baseRef = await defaultBase(directory);
    const base = refs.find((ref) => ref.fullName === baseRef);
    if (!base) throw new Error("基准分支已不存在，请重新选择。");
    const sameBranch =
      base.fullName === `refs/heads/${branch}` || base.fullName === `refs/remotes/origin/${branch}`;
    if (sameBranch) return { baseRef, oid: null, commitCount: null, message: "当前为基准分支" };
    const output = (
      await git(directory, [
        "rev-list",
        "--first-parent",
        "--topo-order",
        "--boundary",
        head,
        `^${base.oid}`,
        "--",
      ])
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    const boundaries = output.filter((oid) => oid.startsWith("-"));
    const unique = output.filter((oid) => !oid.startsWith("-"));
    if (!unique.length) return { baseRef, oid: head, commitCount: 0, message: null };
    const oldest = unique.at(-1);
    const raw = await git(directory, ["cat-file", "commit", oldest ?? head]);
    const oid = /^parent ([\da-f]{40,64})$/m.exec(raw.slice(0, raw.indexOf("\n\n")))?.[1];
    if (!oid || !boundaries.includes(`-${oid}`))
      return {
        baseRef,
        oid: null,
        commitCount: null,
        message: "未找到分叉点，请选择其他基准分支或补全历史。",
      };
    if ((await git(directory, ["rev-parse", "--is-shallow-repository"])).trim() === "true") {
      const shallow = (await git(directory, ["rev-parse", "--git-path", "shallow"])).trim();
      // A shallow boundary can be an artificial root; do not infer branch ownership from it.
      if ((await readFile(resolve(directory, shallow), "utf8")).split("\n").includes(oid))
        return {
          baseRef,
          oid: null,
          commitCount: null,
          message: "分叉点位于浅克隆边界，请先补全历史。",
        };
    }
    return { baseRef, oid, oldestOid: oldest ?? null, commitCount: unique.length, message: null };
  } catch (error) {
    return {
      baseRef,
      oid: null,
      commitCount: null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
