import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const environment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Plugin tests",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Plugin tests",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};
export async function command(directory: string, ...args: string[]): Promise<string> {
  const result = await execute("git", ["-C", directory, ...args], { env: environment });
  return result.stdout;
}
export async function put(directory: string, path: string, text: string | Buffer): Promise<void> {
  await mkdir(dirname(join(directory, path)), { recursive: true });
  await writeFile(join(directory, path), text);
}
export async function commit(directory: string, message = "fixture"): Promise<void> {
  await command(directory, "add", "-A");
  await command(directory, "commit", "-qm", message);
}
export async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "paseo-git-diff-test-"));
  async function repo(name: string): Promise<string> {
    const path = join(base, name);
    await mkdir(path, { recursive: true });
    await command(path, "init", "-q", "-b", "main");
    await command(path, "config", "user.name", "Plugin tests");
    await command(path, "config", "user.email", "test@example.invalid");
    return path;
  }
  return { base, repo, close: () => rm(base, { recursive: true, force: true }) };
}
export async function addModule(parent: string, source: string, path: string): Promise<string> {
  await command(parent, "-c", "protocol.file.allow=always", "submodule", "add", "-q", source, path);
  return join(parent, path);
}
