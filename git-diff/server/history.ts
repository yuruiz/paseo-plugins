import type { FileDiff } from "../shared/contracts";
import type {
  CommitDetails,
  GitCommit,
  GitHistory,
  GitRef,
  HistoryInput,
} from "../shared/history-contracts";
import { DIFF_OPTIONS, GitError, git } from "./git";
import { parseHunks, parseNameStatus, parseNumstat } from "./parsers";
import { digest, MAX_FILE_BYTES } from "./repositories";

function parseCommits(output: string): GitCommit[] {
  const fields = output.split("\0");
  const commits: GitCommit[] = [];
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const [oid, parents, author, email, date, subject] = fields.slice(i, i + 6);
    commits.push({ oid, parents: parents ? parents.split(" ") : [], author, email, date, subject });
  }
  return commits;
}
const commitFormat = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%s";

export async function readHistory(directory: string, input: HistoryInput): Promise<GitHistory> {
  const [headOutput, branchOutput, refOutput] = await Promise.all([
    git(directory, ["rev-parse", "--verify", "--quiet", "HEAD"], { acceptDifference: true }),
    git(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"], { acceptDifference: true }),
    git(directory, [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(objecttype)%00%(*objecttype)%00%(symref)",
      "refs/heads/",
      "refs/remotes/",
      "refs/tags/",
    ]),
  ]);
  const head = headOutput.trim() || null;
  const branch = branchOutput.trim() || null;
  const refs: GitRef[] = [];
  for (const record of refOutput.trimEnd().split("\n")) {
    if (!record) continue;
    const [fullName, object, peeled, type, peeledType, symbolic] = record.split("\0");
    if (symbolic || (type !== "commit" && peeledType !== "commit")) continue;
    const kind = fullName.startsWith("refs/heads/")
      ? "branch"
      : fullName.startsWith("refs/remotes/")
        ? "remote"
        : "tag";
    const name = fullName.replace(/^refs\/(heads|remotes|tags)\//, "");
    refs.push({
      fullName,
      name,
      kind,
      oid: peeled || object,
      current: kind === "branch" && name === branch,
    });
  }
  const selected = refs.find((ref) => ref.fullName === input.ref);
  if (!["all", "head"].includes(input.ref) && !selected)
    throw new Error("分支或标签已不存在，请刷新提交图。");
  const tips = [
    ...new Set(
      input.ref === "all"
        ? [...refs.map((ref) => ref.oid), ...(head ? [head] : [])]
        : selected
          ? [selected.oid]
          : head
            ? [head]
            : [],
    ),
  ].sort();
  const revision = digest([tips, head, branch, refs, input.ref, input.firstParent]);
  if (input.offset && input.revision !== revision)
    throw new Error("提交历史已变化，请刷新后继续加载。");
  if (!tips.length) return { commits: [], refs, head, branch, revision, hasMore: false };
  // Use the captured object ids so a moving ref cannot change this page midway through a read.
  const output = await git(directory, [
    "log",
    "--topo-order",
    ...(input.firstParent ? ["--first-parent"] : []),
    "--no-show-signature",
    "--no-decorate",
    "--no-notes",
    "-z",
    `--format=${commitFormat}`,
    `--skip=${input.offset}`,
    `--max-count=${input.limit + 1}`,
    ...tips,
    "--",
  ]);
  const commits = parseCommits(output);
  return {
    commits: commits.slice(0, input.limit),
    refs,
    head,
    branch,
    revision,
    hasMore: commits.length > input.limit,
  };
}

export async function readCommit(directory: string, oid: string): Promise<CommitDetails> {
  const [output, raw] = await Promise.all([
    git(directory, [
      "show",
      "--no-patch",
      "--no-show-signature",
      "--no-notes",
      `--format=${commitFormat}%x00%cn%x00%ce%x00%cI%x00%B`,
      oid,
      "--",
    ]),
    git(directory, ["cat-file", "commit", oid]),
  ]);
  const fields = output.split("\0");
  const [commit] = parseCommits(fields.slice(0, 6).join("\0"));
  if (!commit || commit.oid !== oid) throw new Error("提交不存在，请刷新提交图。");
  // Pretty formats hide parents at shallow boundaries. Read the actual header
  // so a missing parent never makes an ordinary commit look like a root diff.
  commit.parents = [
    ...raw.slice(0, raw.indexOf("\n\n")).matchAll(/^parent ([\da-f]{40,64})$/gm),
  ].map((match) => match[1]);
  const details: CommitDetails = {
    ...commit,
    committer: fields[6],
    committerEmail: fields[7],
    committedDate: fields[8],
    message: fields.slice(9).join("\0").trimEnd(),
    files: [],
    diffMessage: null,
  };
  const parent = commit.parents[0];
  if (parent) {
    try {
      await git(directory, ["cat-file", "-e", `${parent}^{commit}`]);
    } catch {
      return {
        ...details,
        diffMessage: "父提交尚未在本地可用（可能是浅克隆），无法读取本次提交的文件差异。",
      };
    }
  }
  const revisions = parent ? [parent, oid] : ["--root", oid];
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
  details.files = parseNameStatus(names).map((file) => ({
    ...file,
    ...(stats.get(file.path) ?? { additions: 0, deletions: 0, binary: false }),
    staged: false,
    unstaged: false,
    version: oid,
  }));
  return details;
}

export async function readCommitDiff(
  directory: string,
  commit: Pick<CommitDetails, "oid" | "parents" | "files">,
  path: string,
  context: number,
  ignoreWhitespace: boolean,
): Promise<FileDiff> {
  const file = commit.files.find((file) => file.path === path);
  if (!file) throw new Error("文件不在该提交的变更列表中。");
  const result: FileDiff = {
    path,
    ...(file.oldPath ? { oldPath: file.oldPath } : {}),
    state: "empty",
    patch: "",
    hunks: [],
    message: null,
  };
  const parent = commit.parents[0];
  const trees = [[commit.oid, path], ...(parent ? [[parent, file.oldPath ?? path]] : [])];
  const sizes = await Promise.all(
    trees.map(([revision, filePath]) =>
      git(directory, ["ls-tree", "-l", "-z", revision, "--", filePath]),
    ),
  );
  if (
    sizes.some(
      (tree) => Number(tree.slice(0, tree.indexOf("\t")).trim().split(/\s+/)[3]) > MAX_FILE_BYTES,
    )
  )
    return {
      ...result,
      state: "too_large",
      message: "历史文件超过 1 MiB，请在本地 Git 工具中查看完整内容。",
    };
  const paths = file.oldPath ? [file.oldPath, path] : [path];
  let patch: string;
  try {
    patch = await git(
      directory,
      [
        "diff-tree",
        "--no-commit-id",
        "-r",
        "-p",
        ...DIFF_OPTIONS,
        `--unified=${context}`,
        ...(ignoreWhitespace ? ["--ignore-all-space"] : []),
        ...(parent ? [parent, commit.oid] : ["--root", commit.oid]),
        "--",
        ...paths,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    );
  } catch (error) {
    if (error instanceof GitError && error.tooLarge)
      return {
        ...result,
        state: "too_large",
        message: "补丁超过 2 MiB，请在本地 Git 工具中查看完整内容。",
      };
    throw error;
  }
  if (file.binary || /^Binary files .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch))
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
        ? "仅文件名、类型、子模块指针或权限等元数据发生变化。"
        : "当前选项下没有文本差异。",
  };
}
