import { execFile } from "node:child_process";
import { access, appendFile, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { withCodex } from "./codex-rpc";

type TranscriptEntry = Record<string, unknown>;
interface SessionStore {
  load(key: { sessionId: string }): Promise<TranscriptEntry[]>;
  append(key: { sessionId: string }, entries: TranscriptEntry[]): Promise<void>;
}

const run = promisify(execFile);
export interface NativeForkInput {
  sessionId: string;
  messageId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  model?: string | null;
  pluginDirectory?: string;
}

export async function forkCodex(input: NativeForkInput): Promise<string> {
  const version = await run("codex", ["--version"], { env: input.env, cwd: input.cwd, timeout: 5000 });
  if (version.stdout.trim() !== "codex-cli 0.165.0") {
    throw new Error("Native fork currently supports Codex 0.165.0; this version needs an adapter update");
  }
  return withCodex(input.env, input.cwd, async (request) => {
    type Item = { id: string; type: string; phase?: string };
    type Turn = { id: string; status: string; items: Item[] };
    let cursor: string | null = null;
    const cursors = new Set<string>();
    let selected: Turn | undefined;
    do {
      const page: { data: Turn[]; nextCursor: string | null } = await request("thread/turns/list", {
        threadId: input.sessionId, itemsView: "full", limit: 100, cursor,
      });
      selected = page.data.find((turn) => turn.items.some((item) => item.id === input.messageId && item.type === "agentMessage"));
      if (selected) break;
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error("Codex returned a repeated history cursor");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (!selected) throw new Error("This reply is not present in the native Codex history");
    if (selected.status !== "completed") throw new Error("Choose a reply from a completed Codex turn");
    if (selected.items.at(-1)?.id !== input.messageId || selected.items.at(-1)?.phase === "commentary") {
      throw new Error("Codex forks whole turns. Choose the final reply in this turn");
    }
    const result = await request<{ thread: { id: string } }>("thread/fork", {
      threadId: input.sessionId,
      lastTurnId: selected.id,
      excludeTurns: true,
      deferGoalContinuation: true,
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
    });
    if (!result.thread?.id || result.thread.id === input.sessionId) throw new Error("Codex did not create a new thread");
    return result.thread.id;
  });
}

export async function forkClaude(input: NativeForkInput): Promise<string> {
  const version = await run("claude", ["--version"], { env: input.env, cwd: input.cwd, timeout: 5000 });
  if (version.stdout.trim() !== "2.1.252 (Claude Code)") {
    throw new Error("Native fork currently supports Claude Code 2.1.252; this version needs an adapter update");
  }
  if (!input.pluginDirectory) throw new Error("Beautiful Chat's installation directory was not found");
  const require = createRequire(path.join(input.pluginDirectory, "package.json"));
  const sdkPath = require.resolve("@anthropic-ai/claude-agent-sdk");
  const sdkPackage = JSON.parse(await readFile(path.join(path.dirname(sdkPath), "package.json"), "utf8"));
  if (sdkPackage.version !== "0.3.246") throw new Error("Native fork requires Claude Agent SDK 0.3.246");
  // The SDK requires ESM import.meta.url; Paseo bundles plugin server code as CommonJS.
  const { forkSession } = await import(pathToFileURL(sdkPath).href) as {
    forkSession(sessionId: string, options: { sessionStore: SessionStore; upToMessageId: string }): Promise<{ sessionId: string }>;
  };
  const projects = path.join(input.env.CLAUDE_CONFIG_DIR ?? path.join(input.env.HOME ?? homedir(), ".claude"), "projects");
  let project: string | undefined;
  for (const entry of await readdir(projects, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      await access(path.join(projects, entry.name, `${input.sessionId}.jsonl`));
      if (project) throw new Error("The Claude session exists in multiple project directories");
      project = path.join(projects, entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!project) throw new Error("The native Claude session was not found");
  const file = (sessionId: string) => path.join(project!, `${sessionId}.jsonl`);
  const store: SessionStore = {
    async load({ sessionId }) {
      const text = await readFile(file(sessionId), "utf8");
      return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
    },
    async append({ sessionId }, entries) {
      if (sessionId === input.sessionId) throw new Error("Cannot overwrite the source session");
      await appendFile(file(sessionId), entries.map((entry) => JSON.stringify(entry) + "\n").join(""), { mode: 0o600 });
    },
  };
  const entries = await store.load({ sessionId: input.sessionId });
  const selected = entries?.find((entry) => entry.uuid === input.messageId);
  if (selected?.type !== "assistant") throw new Error("This reply is not present in the native Claude history");
  const message = selected.message as { content?: { type?: string }[] } | undefined;
  if (Array.isArray(message?.content) && message.content.some((block) => block.type === "tool_use")) {
    throw new Error("Choose a Claude reply after its tool calls have finished");
  }
  const result = await forkSession(input.sessionId, { sessionStore: store, upToMessageId: input.messageId });
  if (result.sessionId === input.sessionId) throw new Error("Claude did not create a new session");
  return result.sessionId;
}
