import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { RpcInput } from "@getpaseo/plugin";
import { rewindRpc } from "../shared/rewind-rpc";

async function readJson(file: string): Promise<{ listen?: string; daemon?: { listen?: string } }> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function rewindAgent(input: RpcInput<typeof rewindRpc>) {
  const rawHome = process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
  const home = rawHome === "~" ? homedir() : rawHome.startsWith("~/")
    ? path.join(homedir(), rawHome.slice(2)) : path.resolve(rawHome);
  const serverId = (await readFile(path.join(home, "server-id"), "utf8")).trim();
  if (serverId !== input.hostId) throw new Error("Rewind host does not match this daemon");

  const pid = await readJson(path.join(home, "paseo.pid"));
  const config = await readJson(path.join(home, "config.json"));
  const listen = pid.listen ?? process.env.PASEO_LISTEN ?? config.daemon?.listen ?? "127.0.0.1:6767";
  const address = listen.replace(/^0\.0\.0\.0:/, "127.0.0.1:").replace(/^\[::\]:/, "[::1]:");
  const url = new URL(`ws://${address}/ws`);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.port === "0" || url.pathname !== "/ws") {
    throw new Error("Rewind requires this daemon's bound loopback endpoint");
  }

  // PaseoApi does not expose rewind; use the daemon's existing rewind protocol.
  const client = new DaemonClient({
    url: url.href,
    clientId: `beautiful-chat-rewind-${randomUUID()}`,
    clientType: "cli",
    appVersion: "0.8.0",
    password: process.env.PASEO_PASSWORD,
    reconnect: { enabled: false },
    connectTimeoutMs: 5000,
  });
  try {
    await client.connect();
    if (client.getLastServerInfoMessage()?.serverId !== input.hostId) {
      throw new Error("Rewind endpoint belongs to a different daemon");
    }
    await client.rewindAgent(input.agentId, input.messageId, input.mode);
    return {};
  } finally {
    await client.close().catch(() => {});
  }
}
