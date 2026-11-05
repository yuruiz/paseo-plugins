import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { rewindAgent } from "./rewind";

const client = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  getLastServerInfoMessage: vi.fn(),
  rewindAgent: vi.fn(),
}));
vi.mock("@getpaseo/client/internal/daemon-client", () => ({
  DaemonClient: vi.fn(function () { return client; }),
}));

let home: string;
const input = { hostId: "host-1", agentId: "agent-2", messageId: "message-3", mode: "conversation" as const };

beforeEach(async () => {
  vi.clearAllMocks();
  client.connect.mockResolvedValue(undefined);
  client.close.mockResolvedValue(undefined);
  client.getLastServerInfoMessage.mockReturnValue({ serverId: "host-1" });
  client.rewindAgent.mockResolvedValue({ ok: true });
  home = await mkdtemp(path.join(tmpdir(), "rewind-test-"));
  vi.stubEnv("PASEO_HOME", home);
  vi.stubEnv("PASEO_LISTEN", "127.0.0.1:1234");
  await writeFile(path.join(home, "server-id"), "host-1\n");
  await writeFile(path.join(home, "paseo.pid"), JSON.stringify({ listen: "0.0.0.0:5678" }));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe("rewind daemon bridge", () => {
  it.each(["conversation", "files", "both"] as const)("rewinds the exact message in %s mode", async (mode) => {
    expect(await rewindAgent({ ...input, mode })).toEqual({});
    expect(DaemonClient).toHaveBeenCalledWith(expect.objectContaining({
      url: "ws://127.0.0.1:5678/ws",
      reconnect: { enabled: false },
    }));
    expect(client.rewindAgent).toHaveBeenCalledExactlyOnceWith("agent-2", "message-3", mode);
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("rejects a different selected host before opening a connection", async () => {
    await expect(rewindAgent({ ...input, hostId: "other" })).rejects.toThrow("host does not match");
    expect(DaemonClient).not.toHaveBeenCalled();
  });

  it("checks the connected daemon identity before mutating", async () => {
    client.getLastServerInfoMessage.mockReturnValue({ serverId: "other" });
    await expect(rewindAgent(input)).rejects.toThrow("different daemon");
    expect(client.rewindAgent).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it.each(["example.com:5678", "127.0.0.1:0", "user@localhost:5678", "127.0.0.1:5678/other"])(
    "rejects an invalid local endpoint: %s", async (listen) => {
      await writeFile(path.join(home, "paseo.pid"), JSON.stringify({ listen }));
      await expect(rewindAgent(input)).rejects.toThrow("loopback endpoint");
      expect(DaemonClient).not.toHaveBeenCalled();
    },
  );

  it("reports rewind failures and closes the connection", async () => {
    client.rewindAgent.mockRejectedValue(new Error("Checkpoint missing"));
    await expect(rewindAgent(input)).rejects.toThrow("Checkpoint missing");
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("cleans up failed connections without masking the original error", async () => {
    client.connect.mockRejectedValue(new Error("Offline"));
    client.close.mockRejectedValue(new Error("Already closed"));
    await expect(rewindAgent(input)).rejects.toThrow("Offline");
    expect(client.rewindAgent).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("does not report a completed rewind as failed when cleanup fails", async () => {
    client.close.mockRejectedValue(new Error("Already closed"));
    expect(await rewindAgent(input)).toEqual({});
  });
});
