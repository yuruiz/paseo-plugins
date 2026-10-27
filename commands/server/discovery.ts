import { readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { Command } from "../shared/commands";

export interface CommandRoots {
  home: string;
  claude: string;
  codex: string;
  opencode: string;
  pi: string;
}

export function defaultRoots(): CommandRoots {
  const home = os.homedir();
  const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return {
    home,
    claude: process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
    codex: process.env.CODEX_HOME || path.join(home, ".codex"),
    opencode: process.env.OPENCODE_CONFIG_DIR || path.join(config, "opencode"),
    pi: process.env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent"),
  };
}

interface Directory {
  path: string;
  scope: "project" | "global";
  naming: "claude" | "codex" | "copilot" | "path";
  native: boolean;
}

export interface CommandFile extends Omit<Command, "path"> {
  path: string;
  body: string;
  nativeName: string | null;
}

interface DiscoveryInput {
  cwd: string;
  provider: string;
  roots: CommandRoots;
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function projectDirectories(cwd: string, home: string): Promise<string[]> {
  const directories: string[] = [];
  let directory = path.resolve(cwd);
  while (directory !== home) {
    directories.push(directory);
    try {
      await stat(path.join(directory, ".git"));
      break;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return directories;
}

async function commandDirectories({ cwd, provider, roots }: DiscoveryInput): Promise<Directory[]> {
  const projects = await projectDirectories(cwd, roots.home);
  const directories: Directory[] = [];
  function add(
    base: string,
    folder: string,
    scope: Directory["scope"],
    naming: Directory["naming"],
    native: boolean,
  ) {
    directories.push({ path: path.join(base, folder), scope, naming, native });
  }
  for (const project of projects) {
    if (provider === "claude") add(project, ".claude/commands", "project", "claude", true);
    if (provider === "codex") {
      add(project, ".codex/prompts", "project", "path", false);
      add(project, ".codex/commands", "project", "path", false);
    }
    if (provider === "opencode") {
      add(project, ".opencode/commands", "project", "path", true);
      add(project, ".opencode/command", "project", "path", true);
    }
    if (provider === "pi") add(project, ".pi/prompts", "project", "path", true);
    if (provider === "copilot") add(project, ".github/prompts", "project", "copilot", true);
    add(project, ".agents/commands", "project", "path", false);
  }
  if (provider === "claude") add(roots.claude, "commands", "global", "claude", true);
  if (provider === "codex") {
    add(roots.codex, "prompts", "global", "codex", true);
    add(roots.codex, "commands", "global", "path", false);
  }
  if (provider === "opencode") {
    add(roots.opencode, "commands", "global", "path", true);
    add(roots.opencode, "command", "global", "path", true);
  }
  if (provider === "pi") add(roots.pi, "prompts", "global", "path", true);
  if (provider === "copilot") add(roots.home, ".copilot/prompts", "global", "copilot", true);
  add(roots.home, ".agents/commands", "global", "path", false);
  return directories;
}

const ArgumentHintSchema = z.union([z.string(), z.array(z.string())]);
const MetadataSchema = z.object({
  description: z.string().optional(),
  "argument-hint": ArgumentHintSchema.optional(),
  argument_hint: ArgumentHintSchema.optional(),
});

export function parseCommand(raw: string) {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  const metadata = frontmatter ? MetadataSchema.parse(parse(frontmatter[1]) ?? {}) : {};
  const body = frontmatter ? normalized.slice(frontmatter[0].length).trim() : normalized.trim();
  const hint = metadata["argument-hint"] ?? metadata.argument_hint ?? "";
  // Unquoted hints such as [output-path] are YAML flow sequences, not strings.
  const argumentHint = Array.isArray(hint) ? `[${hint.join(", ")}]` : hint;
  return {
    description: metadata.description ?? "",
    argumentHint,
    body,
  };
}

function commandName(relative: string, naming: Directory["naming"]): string {
  const extension = naming === "copilot" ? /(?:\.prompt)?\.md$/i : /\.md$/i;
  const name = relative.replace(extension, "").split(path.sep).join("/");
  if (naming === "codex") return `prompts:${name}`;
  // Claude uses the basename; parent directories organize commands, not namespaces.
  if (naming === "claude") return path.posix.basename(name);
  return name;
}

function describeError(location: string, error: unknown): string {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((issue) => {
      const field = issue.path.join(".") || "frontmatter";
      const message =
        issue.code === "invalid_union" ? "expected text or a list of text" : issue.message;
      return `${field}: ${message}`;
    });
    return `${location}: Invalid command metadata (${issues.join("; ")}).`;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `${location}: ${detail}`;
}

async function scanDirectory(directory: Directory, warnings: string[]): Promise<CommandFile[]> {
  const files: CommandFile[] = [];
  const visited = new Set<string>();
  async function walk(folder: string): Promise<void> {
    let canonical: string;
    try {
      canonical = await realpath(folder);
    } catch (error) {
      if (!missing(error)) warnings.push(describeError(folder, error));
      return;
    }
    if (visited.has(canonical)) return;
    visited.add(canonical);
    try {
      const entries = await readdir(folder, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) await visit(path.join(folder, entry.name));
    } catch (error) {
      warnings.push(describeError(folder, error));
    }
  }
  async function visit(file: string): Promise<void> {
    try {
      const info = await stat(file);
      if (info.isDirectory()) return await walk(file);
      const markdown = file.toLowerCase().endsWith(".md");
      if (!info.isFile() || !markdown) return;
      if (info.size > 1024 * 1024) throw new Error("Command exceeds 1 MiB");
      const parsed = parseCommand(await readFile(file, "utf8"));
      const name = commandName(path.relative(directory.path, file), directory.naming);
      files.push({
        id: file,
        name,
        ...parsed,
        path: file,
        scope: directory.scope,
        mode: "template",
        shadowedBy: null,
        nativeName: directory.native ? name : null,
      });
    } catch (error) {
      warnings.push(describeError(file, error));
    }
  }
  await walk(directory.path);
  return files;
}

export async function discoverCommands(input: DiscoveryInput) {
  const directories = await commandDirectories(input);
  const warnings: string[] = [];
  const files: CommandFile[] = [];
  const ids = new Set<string>();
  for (const directory of directories) {
    for (const file of await scanDirectory(directory, warnings)) {
      if (ids.has(file.id)) continue;
      ids.add(file.id);
      files.push(file);
    }
  }
  return { files, directories: directories.map((directory) => directory.path), warnings };
}
