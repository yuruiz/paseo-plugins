import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CompareDiffInput, CompareInput } from "../shared/compare-contracts";
import type { ChangesSnapshot, Comparison, FileDiff } from "../shared/contracts";
import { DiffCache } from "../shared/diff-cache";
import type {
  CommitDetails,
  CommitDiffInput,
  CommitInput,
  HistoryInput,
} from "../shared/history-contracts";
import { parsePreviewLink } from "../shared/preview-links";
import { readComparison, readComparisonDiff } from "./compare";
import { readFileDiff } from "./diff";
import { readContent, revealInFileManager } from "./files";
import { readCommit, readCommitDiff, readHistory } from "./history";
import { RepositoryScanCache, resolveFile, scanWorkspace } from "./repositories";

export class GitChangesService {
  private readonly commits = new Map<string, Promise<CommitDetails>>();

  private async historyRepository(
    input: { directory: string; repositoryId: string },
    force = false,
  ) {
    const snapshot = await this.snapshot({ directory: input.directory, comparison: "head", force });
    const repository = snapshot.repositories.find((repo) => repo.id === input.repositoryId);
    if (repository?.state !== "ready") throw new Error("所属仓库不可用，请刷新后重试。");
    return repository;
  }

  async compare(input: CompareInput) {
    const repository = await this.historyRepository(
      input,
      input.selection.mode === "range" && Boolean(input.selection.workingTree),
    );
    return readComparison(repository.directory, input, repository);
  }

  async compareDiff(input: CompareDiffInput) {
    const repository = await this.historyRepository(input, Boolean(input.workingTree));
    const key = JSON.stringify(["compare", repository.directory, input]);
    const cached = this.patches.get(key);
    if (cached && !input.workingTree) return cached;
    const diff = await readComparisonDiff(
      repository.directory,
      input.baseOid,
      input.targetOid,
      input.path,
      input.context,
      input.ignoreWhitespace,
      input.workingTree,
      repository,
    );
    if (!input.workingTree) this.patches.set(key, diff);
    return diff;
  }

  async history(input: HistoryInput) {
    const repository = await this.historyRepository(input);
    return readHistory(repository.directory, input);
  }

  private cachedCommit(directory: string, oid: string) {
    const key = JSON.stringify([directory, oid]);
    const existing = this.commits.get(key);
    if (existing) return existing;
    const promise = readCommit(directory, oid);
    this.commits.set(key, promise);
    void promise.then(
      (commit) => {
        if (commit.diffMessage && this.commits.get(key) === promise) this.commits.delete(key);
      },
      () => {},
    );
    void promise.catch(() => {
      if (this.commits.get(key) === promise) this.commits.delete(key);
    });
    while (this.commits.size > 32) {
      const first = this.commits.keys().next().value;
      if (first !== undefined) this.commits.delete(first);
    }
    return promise;
  }

  async commit(input: CommitInput) {
    const repository = await this.historyRepository(input);
    return this.cachedCommit(repository.directory, input.oid);
  }

  async commitDiff(input: CommitDiffInput): Promise<FileDiff> {
    const repository = await this.historyRepository(input);
    const key = JSON.stringify([
      "commit",
      repository.directory,
      input.oid,
      input.path,
      input.context,
      input.ignoreWhitespace,
    ]);
    const existing = this.patches.get(key);
    if (existing) return existing;
    const pending = this.pendingPatches.get(key);
    if (pending) return pending;
    const promise = this.cachedCommit(repository.directory, input.oid).then((commit) =>
      readCommitDiff(
        repository.directory,
        commit,
        input.path,
        input.context,
        input.ignoreWhitespace,
      ),
    );
    this.pendingPatches.set(key, promise);
    void promise.then(
      (diff) => {
        if (this.pendingPatches.get(key) !== promise) return;
        this.pendingPatches.delete(key);
        this.patches.set(key, diff);
      },
      () => {
        if (this.pendingPatches.get(key) === promise) this.pendingPatches.delete(key);
      },
    );
    return promise;
  }

  private async fileRepository(input: {
    directory: string;
    repositoryId: string;
    path: string;
    comparison: Comparison;
    scope?: "changes" | "workspace";
  }) {
    const snapshot = await this.snapshot(input);
    const repository = snapshot.repositories.find((repo) => repo.id === input.repositoryId);
    if (
      repository?.state !== "ready" ||
      (input.scope !== "workspace" && !repository.files.some((file) => file.path === input.path))
    )
      throw new Error("文件已不在当前变更列表中，请刷新后重试。");
    const absolute =
      input.scope === "workspace" && input.path === "."
        ? repository.directory
        : resolveFile(repository.directory, input.path);
    if (input.scope === "workspace") {
      if (input.path.split(/[\\/]/).includes(".git")) throw new Error("不能打开 Git 内部文件。");
      const canonical = await realpath(absolute);
      const delta = relative(repository.directory, canonical);
      if (
        delta === ".." ||
        delta.startsWith(`..${sep}`) ||
        isAbsolute(delta) ||
        delta.split(/[\\/]/).includes(".git")
      )
        throw new Error("文件必须位于所属仓库内。");
    }
    return repository;
  }
  async content(input: {
    directory: string;
    repositoryId: string;
    path: string;
    comparison: Comparison;
    scope?: "changes" | "workspace";
  }) {
    return readContent(await this.fileRepository(input), input.path, input.comparison);
  }
  async reveal(input: {
    directory: string;
    repositoryId: string;
    path: string;
    comparison: Comparison;
    scope?: "changes" | "workspace";
  }) {
    return revealInFileManager(await this.fileRepository(input), input.path);
  }
  async resolveLink(input: {
    directory: string;
    repositoryId: string;
    path: string;
    href: string;
  }) {
    const link = parsePreviewLink(input.href);
    if (link?.kind !== "file") throw new Error("不是有效的工作区文件链接。");
    const snapshot = await this.snapshot({ directory: input.directory, comparison: "head" });
    const from = snapshot.repositories.find((repo) => repo.id === input.repositoryId);
    if (from?.state !== "ready") throw new Error("所属仓库不可用。");
    const source = resolveFile(from.directory, input.path);
    let linkedPath = link.path;
    if (process.platform === "win32" && link.absolute && /^\/[a-z]:\//i.test(linkedPath))
      linkedPath = linkedPath.slice(1);
    let target = link.absolute
      ? resolve(linkedPath)
      : linkedPath.startsWith("/")
        ? resolve(snapshot.directory, `.${linkedPath}`)
        : resolve(dirname(source), linkedPath);
    // The configured workspace can use an alias such as macOS /var -> /private/var.
    // Translate its lexical prefix before applying canonical workspace boundaries.
    if (link.absolute) {
      const configuredPath = relative(resolve(input.directory), target);
      if (
        configuredPath !== ".." &&
        !configuredPath.startsWith(`..${sep}`) &&
        !isAbsolute(configuredPath)
      )
        target = resolve(snapshot.directory, configuredPath);
    }
    const workspacePath = relative(snapshot.directory, target);
    if (
      workspacePath === ".." ||
      workspacePath.startsWith(`..${sep}`) ||
      isAbsolute(workspacePath) ||
      workspacePath.split(/[\\/]/).includes(".git")
    )
      throw new Error("文件链接必须位于当前工作区内。");
    let canonical: string;
    try {
      canonical = await realpath(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("链接指向的文件或目录不存在。");
      throw error;
    }
    const canonicalPath = relative(snapshot.directory, canonical);
    if (
      canonicalPath === ".." ||
      canonicalPath.startsWith(`..${sep}`) ||
      isAbsolute(canonicalPath) ||
      canonicalPath.split(/[\\/]/).includes(".git")
    )
      throw new Error("文件链接必须位于当前工作区内。");
    const repository = snapshot.repositories
      .filter((repo) => {
        const delta = relative(repo.directory, canonical);
        return (
          repo.state === "ready" &&
          delta !== ".." &&
          !delta.startsWith(`..${sep}`) &&
          !isAbsolute(delta)
        );
      })
      .sort((a, b) => b.directory.length - a.directory.length)[0];
    if (!repository) throw new Error("链接所属仓库不可用。");
    const stat = await lstat(canonical);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error("链接目标不是普通文件或目录。");
    return {
      repositoryId: repository.id,
      path: relative(repository.directory, canonical).split(sep).join("/") || ".",
      kind: stat.isDirectory() ? ("directory" as const) : ("file" as const),
      version: `${stat.mtimeMs}:${stat.size}`,
      fragment: link.fragment,
    };
  }
  private readonly snapshots = new Map<
    string,
    { time: number; pending: boolean; promise: Promise<ChangesSnapshot> }
  >();
  private readonly patches = new DiffCache(8 * 1024 * 1024, 24);
  private readonly pendingPatches = new Map<string, Promise<FileDiff>>();
  private readonly scanCache = new RepositoryScanCache();

  snapshot(input: {
    directory: string;
    comparison: Comparison;
    force?: boolean;
  }): Promise<ChangesSnapshot> {
    const key = JSON.stringify([resolve(input.directory), input.comparison]);
    const existing = this.snapshots.get(key);
    if (existing && (existing.pending || (!input.force && Date.now() - existing.time < 1000)))
      return existing.promise;
    const promise = scanWorkspace(input, this.scanCache);
    const entry = { time: Date.now(), pending: true, promise };
    this.snapshots.set(key, entry);
    void promise.then(
      () => {
        entry.pending = false;
        entry.time = Date.now();
      },
      () => {
        if (this.snapshots.get(key) === entry) this.snapshots.delete(key);
      },
    );
    if (this.snapshots.size > 20) {
      const first = this.snapshots.keys().next().value;
      if (first !== undefined) this.snapshots.delete(first);
    }
    return promise;
  }

  async diff(input: {
    directory: string;
    comparison: Comparison;
    repositoryId: string;
    path: string;
    context: number;
    ignoreWhitespace: boolean;
  }): Promise<FileDiff> {
    const snapshot = await this.snapshot(input);
    const repository = snapshot.repositories.find((repo) => repo.id === input.repositoryId);
    if (repository?.state !== "ready") throw new Error("所属仓库不可用，请刷新后重试。");
    const file = repository.files.find((change) => change.path === input.path);
    if (!file) throw new Error("文件已不在当前变更列表中，请刷新后重试。");
    const key = JSON.stringify([
      repository.directory,
      input.comparison,
      file,
      input.context,
      input.ignoreWhitespace,
    ]);
    const existing = this.patches.get(key);
    if (existing) return existing;
    const pending = this.pendingPatches.get(key);
    if (pending) return pending;
    const promise = readFileDiff(
      repository,
      input.path,
      input.comparison,
      input.context,
      input.ignoreWhitespace,
    );
    this.pendingPatches.set(key, promise);
    void promise.then(
      (diff) => {
        if (this.pendingPatches.get(key) !== promise) return;
        this.pendingPatches.delete(key);
        this.patches.set(key, diff);
      },
      () => {
        if (this.pendingPatches.get(key) === promise) this.pendingPatches.delete(key);
      },
    );
    return promise;
  }

  close(): void {
    this.commits.clear();
    this.snapshots.clear();
    this.patches.clear();
    this.pendingPatches.clear();
    this.scanCache.clear();
  }
}
