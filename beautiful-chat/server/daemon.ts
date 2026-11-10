import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";

async function readJson(file: string): Promise<{ listen?: string; daemon?: { listen?: string } }> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function withDaemon<T>(hostId: string, action: (client: DaemonClient, home: string) => Promise<T>): Promise<T> {
  const rawHome = process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
  const home = rawHome === "~" ? homedir() : rawHome.startsWith("~/")
    ? path.join(homedir(), rawHome.slice(2)) : path.resolve(rawHome);
  const serverId = (await readFile(path.join(home, "server-id"), "utf8")).trim();
  if (serverId !== hostId) throw new Error("Selected host does not match this daemon");

  const pid = await readJson(path.join(home, "paseo.pid"));
  const config = await readJson(path.join(home, "config.json"));
  const listen = pid.listen ?? process.env.PASEO_LISTEN ?? config.daemon?.listen ?? "127.0.0.1:6767";
  const address = listen.replace(/^0\.0\.0\.0:/, "127.0.0.1:").replace(/^\[::\]:/, "[::1]:");
  const url = new URL(`ws://${address}/ws`);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.port === "0" || url.pathname !== "/ws") {
    throw new Error("This action requires this daemon's bound loopback endpoint");
  }

  const client = new DaemonClient({
    url: url.href,
    clientId: `beautiful-chat-${randomUUID()}`,
    clientType: "cli",
    appVersion: "0.8.0",
    password: process.env.PASEO_PASSWORD,
    reconnect: { enabled: false },
    connectTimeoutMs: 5000,
  });
  try {
    await client.connect();
    if (client.getLastServerInfoMessage()?.serverId !== hostId) {
      throw new Error("The endpoint belongs to a different daemon");
    }
    return await action(client, home);
  } finally {
    await client.close().catch(() => {});
  }
}
