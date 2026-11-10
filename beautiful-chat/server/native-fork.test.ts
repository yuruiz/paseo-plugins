import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { forkClaude, forkCodex } from "./native-fork";
import { withCodex } from "./codex-rpc";
import { forkAgent } from "./fork";

const pluginDirectory = fileURLToPath(new URL("../", import.meta.url));

async function verifyDaemonImport(env: NodeJS.ProcessEnv, cwd: string, sessionId: string, provider: "codex" | "claude", replyText: string) {
  const home = path.join(cwd, "paseo");
  await mkdir(home);
  await writeFile(path.join(home, "config.json"), JSON.stringify({ version: 1,
    plugins: { "beautiful-chat": { source: "directory", path: pluginDirectory, enabled: false } },
    daemon: { listen: "127.0.0.1:0", relay: { enabled: false }, mcp: { enabled: false, injectIntoAgents: false } },
    agents: { providers: { [provider]: { env: { CODEX_HOME: env.CODEX_HOME, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR } } }, metadataGeneration: { providers: [] } },
  }));
  const child = spawn("paseo", ["daemon", "run", "--home", home], {
    env: { ...env, PASEO_HOME: home, PASEO_LISTEN: "127.0.0.1:0", PASEO_RELAY_ENABLED: "false" },
    stdio: "ignore",
  });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let client: DaemonClient | undefined;
  try {
    let listen: string | undefined;
    for (let i = 0; i < 150; i++) {
      try { listen = JSON.parse(await readFile(path.join(home, "paseo.pid"), "utf8")).listen; } catch {}
      if (listen && !listen.endsWith(":0")) break;
      if (child.exitCode !== null) throw new Error("Isolated Paseo daemon exited during startup");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!listen || listen.endsWith(":0")) throw new Error("Isolated Paseo daemon did not become ready");
    client = new DaemonClient({ url: `ws://${listen}/ws`, clientId: "beautiful-chat-fork-test",
      clientType: "cli", appVersion: "0.8.0", reconnect: { enabled: false } });
    await client.connect();
    const hostId = client.getLastServerInfoMessage()!.serverId;
    const imported = await client.importAgent({ provider, sessionId, cwd });
    const original = await client.fetchAgentTimeline(imported.id);
    const reply = original.entries.find((entry) => entry.item.type === "assistant_message");
    if (reply?.item.type !== "assistant_message" || !reply.item.messageId) throw new Error("Imported reply has no native message ID");
    vi.stubEnv("PASEO_HOME", home);
    const request = { hostId, agentId: imported.id, messageId: reply.item.messageId, requestId: randomUUID() };
    const fork = await forkAgent(request);
    expect(fork.workspaceId).toBe(imported.workspaceId);
    expect(fork.agentId).not.toBe(imported.id);
    expect(await forkAgent(request)).toEqual(fork);
    const forked = await client.fetchAgentTimeline(fork.agentId);
    const texts = forked.entries.flatMap((entry) => entry.item.type === "assistant_message" ? [entry.item.text] : []);
    expect(texts).toEqual([replyText]);
    const unchanged = await client.fetchAgentTimeline(imported.id);
    expect(unchanged.entries).toEqual(original.entries);
    expect((await client.fetchAgent({ agentId: imported.id }))!.agent.persistence?.sessionId).toBe(sessionId);
  } finally {
    vi.unstubAllEnvs();
    await client?.close();
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
}

describe.runIf(process.env.BEAUTIFUL_CHAT_NATIVE_TESTS === "1")("installed provider native forks", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "beautiful-chat-native-"));
    env = { ...process.env, CODEX_HOME: path.join(root, "codex"), CLAUDE_CONFIG_DIR: path.join(root, "claude") };
    await mkdir(env.CODEX_HOME!, { recursive: true });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("Claude keeps the source byte-for-byte and forks through the selected UUID", async () => {
    const sessionId = randomUUID();
    const ids = Array.from({ length: 4 }, () => randomUUID());
    const project = path.join(env.CLAUDE_CONFIG_DIR!, "projects", "-old-project-location");
    await mkdir(project, { recursive: true });
    const entries = ids.map((uuid, i) => ({
      type: i % 2 ? "assistant" : "user", uuid, parentUuid: ids[i - 1] ?? null,
      sessionId, cwd: root, timestamp: new Date().toISOString(),
      message: { role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `message-${i}` }] },
    }));
    const original = entries.map((entry) => JSON.stringify(entry) + "\n").join("");
    const source = path.join(project, `${sessionId}.jsonl`);
    await writeFile(source, original);
    const fork = await forkClaude({ env, cwd: root, sessionId, messageId: ids[1]!, pluginDirectory });
    expect(await readFile(source, "utf8")).toBe(original);
    const forked = (await readFile(path.join(project, `${fork}.jsonl`), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line)).filter((entry) => entry.message);
    expect(forked.map((entry) => entry.message.content[0].text)).toEqual(["message-0", "message-1"]);
    expect(forked[0].uuid).not.toBe(ids[0]);
    expect(forked[1].parentUuid).toBe(forked[0].uuid);
    await expect(forkClaude({ env, cwd: root, sessionId, messageId: randomUUID(), pluginDirectory })).rejects.toThrow("not present");
    if (process.env.BEAUTIFUL_CHAT_DAEMON_TESTS === "1") await verifyDaemonImport(env, root, sessionId, "claude", "message-1");
  }, 60_000);

  it("Codex forks the selected completed turn and keeps the original history", async () => {
    const sessionId = randomUUID();
    const turnIds = [randomUUID(), randomUUID()];
    const timestamp = "2026-11-05T00:00:00.000Z";
    const records: unknown[] = [{ type: "session_meta", payload: {
      id: sessionId, timestamp, cwd: root, originator: "codex_cli_rs", cli_version: "0.165.0",
      source: "cli", model_provider: "openai",
    } }];
    for (const [i, turnId] of turnIds.entries()) {
      records.push(
        { type: "event_msg", payload: { type: "task_started", turn_id: turnId, model_context_window: 128000 } },
        { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `prompt-${i}` }] } },
        { type: "event_msg", payload: { type: "user_message", message: `prompt-${i}`, images: [], local_images: [] } },
        { type: "response_item", payload: { type: "message", id: `reply-${i}`, role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: `answer-${i}` }] } },
        { type: "event_msg", payload: { type: "agent_message", message: `answer-${i}`, phase: "final_answer" } },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: `answer-${i}` } },
      );
    }
    const folder = path.join(env.CODEX_HOME!, "sessions", "2026", "11", "05");
    await mkdir(folder, { recursive: true });
    const source = path.join(folder, `rollout-2026-11-05T00-00-00-${sessionId}.jsonl`);
    const original = records.map((record) => JSON.stringify({ timestamp, ...record as object }) + "\n").join("");
    await writeFile(source, original);
    type Page = { data: { id: string; status: string; items: { id: string; type: string; text?: string }[] }[] };
    const history = await withCodex(env, root, (request) => request<Page>("thread/turns/list", {
      threadId: sessionId, itemsView: "full", sortDirection: "asc",
    }));
    expect(history.data).toHaveLength(2);
    const messageId = history.data[0]!.items.find((item) => item.type === "agentMessage")!.id;
    const fork = await forkCodex({ env, cwd: root, sessionId, messageId });
    expect(fork).not.toBe(sessionId);
    expect(await readFile(source, "utf8")).toBe(original);
    const forked = await withCodex(env, root, (request) => request<Page>("thread/turns/list", {
      threadId: fork, itemsView: "full", sortDirection: "asc",
    }));
    expect(forked.data).toHaveLength(1);
    expect(forked.data[0]!.items.filter((item) => item.type === "agentMessage").map((item) => item.text)).toEqual(["answer-0"]);
    if (process.env.BEAUTIFUL_CHAT_DAEMON_TESTS === "1") await verifyDaemonImport(env, root, sessionId, "codex", "answer-0");
  }, 60_000);
});
