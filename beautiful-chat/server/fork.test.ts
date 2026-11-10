import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forkAgent } from "./fork";

const mocks = vi.hoisted(() => ({
  withDaemon: vi.fn(), forkCodex: vi.fn(), forkClaude: vi.fn(),
  fetchAgent: vi.fn(), fetchAgents: vi.fn(), importAgent: vi.fn(), applyAgentConfig: vi.fn(), updateAgent: vi.fn(),
}));
vi.mock("./daemon", () => ({ withDaemon: mocks.withDaemon }));
vi.mock("./native-fork", () => ({ forkCodex: mocks.forkCodex, forkClaude: mocks.forkClaude }));
let home: string;
let source: Record<string, unknown>;
const nativeId = randomUUID();
const input = () => ({ hostId: "host", agentId: "source", messageId: "reply", requestId: randomUUID() });

beforeEach(async () => {
  vi.resetAllMocks();
  home = await mkdtemp(path.join(tmpdir(), "fork-bridge-"));
  await writeFile(path.join(home, "config.json"), "{}");
  source = { id: "source", provider: "codex", cwd: home, workspaceId: "workspace", status: "idle",
    title: "Original", persistence: { sessionId: nativeId }, model: "gpt-test", currentModeId: "default", thinkingOptionId: "high" };
  mocks.withDaemon.mockImplementation((_host, action) => action(mocks, home));
  mocks.fetchAgent.mockImplementation(async () => ({ agent: source }));
  mocks.fetchAgents.mockResolvedValue({ entries: [] });
  mocks.forkCodex.mockResolvedValue("native-fork");
  mocks.forkClaude.mockResolvedValue("native-fork");
  mocks.importAgent.mockResolvedValue({ id: "fork", workspaceId: "workspace" });
});
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe("native fork daemon bridge", () => {
  it.each(["codex", "claude"])("imports a %s fork into the original workspace and copies settings", async (provider) => {
    source.provider = provider;
    const request = input();
    expect(await forkAgent(request)).toEqual({ agentId: "fork", workspaceId: "workspace" });
    expect(mocks.withDaemon).toHaveBeenCalledWith("host", expect.any(Function));
    expect(provider === "codex" ? mocks.forkCodex : mocks.forkClaude).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: nativeId, messageId: "reply", cwd: home, model: "gpt-test",
    }));
    expect(mocks.importAgent).toHaveBeenCalledExactlyOnceWith({
      provider, sessionId: "native-fork", cwd: home, workspaceId: "workspace",
      labels: { "beautiful-chat.fork-request": request.requestId, "beautiful-chat.fork-source": "source" },
    });
    expect(mocks.applyAgentConfig).toHaveBeenCalledWith("fork", { modelId: "gpt-test", modeId: "default", thinkingOptionId: "high" });
    expect(mocks.updateAgent).toHaveBeenCalledWith("fork", { name: "Original (fork)" });
  });

  it.each([
    ["unsupported provider", { provider: "custom" }, "built-in"],
    ["running source", { status: "running" }, "finish"],
    ["active turn", { activeTurn: { turnId: "running" } }, "finish"],
    ["missing workspace", { workspaceId: undefined }, "workspace"],
    ["missing persistence", { persistence: null }, "native session"],
    ["unsafe session path", { persistence: { sessionId: "../../other" } }, "native session"],
  ])("rejects %s before creating a native fork", async (_name, patch, error) => {
    Object.assign(source, patch);
    await expect(forkAgent(input())).rejects.toThrow(error as string);
    expect(mocks.forkCodex).not.toHaveBeenCalled();
    expect(mocks.importAgent).not.toHaveBeenCalled();
  });

  it("uses the configured provider environment without mutating process.env", async () => {
    await writeFile(path.join(home, "config.json"), JSON.stringify({ agents: { providers: { codex: { env: { CODEX_HOME: home } } } } }));
    const original = process.env.CODEX_HOME;
    await forkAgent(input());
    expect(mocks.forkCodex.mock.calls[0]![0].env.CODEX_HOME).toBe(home);
    expect(process.env.CODEX_HOME).toBe(original);
  });

  it("rejects custom launch commands instead of using a different executable", async () => {
    await writeFile(path.join(home, "config.json"), JSON.stringify({ agents: { providers: { codex: { command: ["wrapper"] } } } }));
    await expect(forkAgent(input())).rejects.toThrow("custom provider commands");
    expect(mocks.forkCodex).not.toHaveBeenCalled();
  });

  it("coalesces concurrent requests and returns completed requests without forking again", async () => {
    const request = input();
    const first = forkAgent(request);
    const second = forkAgent(request);
    expect(first).toBe(second);
    await Promise.all([first, second]);
    await forkAgent(request);
    expect(mocks.forkCodex).toHaveBeenCalledOnce();
    expect(mocks.importAgent).toHaveBeenCalledOnce();
    await expect(forkAgent({ ...request, messageId: "another" })).rejects.toThrow("reused");
  });

  it("reuses the native session after an import failure", async () => {
    const request = input();
    mocks.importAgent.mockRejectedValueOnce(new Error("Offline"));
    await expect(forkAgent(request)).rejects.toThrow("Offline");
    await forkAgent(request);
    expect(mocks.forkCodex).toHaveBeenCalledOnce();
    expect(mocks.importAgent).toHaveBeenCalledTimes(2);
    expect(mocks.importAgent.mock.calls[1]![0].sessionId).toBe("native-fork");
  });

  it("recovers a completed import after a lost response", async () => {
    mocks.fetchAgents.mockResolvedValue({ entries: [{ agent: { id: "recovered", workspaceId: "workspace" } }] });
    expect(await forkAgent(input())).toEqual({ agentId: "recovered", workspaceId: "workspace" });
    expect(mocks.forkCodex).not.toHaveBeenCalled();
    expect(mocks.importAgent).not.toHaveBeenCalled();
  });
});
