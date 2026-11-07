import { execCommand } from "@getpaseo/plugin/server";
import { TaskPool } from "./concurrency";

const processes = new TaskPool(6);

export class GitError extends Error {
  constructor(
    public readonly args: string[],
    public readonly detail: string,
    public readonly tooLarge = false,
  ) {
    super(detail);
    this.name = "GitError";
  }
}

const environment = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_LAZY_FETCH: "1",
  LC_ALL: "C",
};
for (const key of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_COMMON_DIR",
])
  delete environment[key as keyof typeof environment];

export async function git(
  directory: string,
  args: string[],
  options: { acceptDifference?: boolean; maxBuffer?: number; encoding?: BufferEncoding } = {},
): Promise<string> {
  try {
    const result = await processes.run(() =>
      execCommand("git", ["--no-pager", "--literal-pathspecs", ...args], {
        cwd: directory,
        env: environment,
        shell: false,
        timeout: 15000,
        maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
        encoding: options.encoding,
      }),
    );
    return result.stdout;
  } catch (error) {
    const failure = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (options.acceptDifference && failure.code === 1) return failure.stdout ?? "";
    throw new GitError(
      args,
      failure.stderr?.trim() || failure.message || String(error),
      failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    );
  }
}

export const DIFF_OPTIONS = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--ignore-submodules=none",
  "--submodule=short",
  "--find-renames",
];

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
