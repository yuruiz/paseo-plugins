import { beforeEach, describe, it, expect, vi } from "vitest";
import type { PluginServerContext, PluginHandlerContext } from "@getpaseo/plugin/server";
import contribute from "./index.server";
const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(() => true),
  dispose: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("./server/sessions", () => ({
  AuthSessions: class {
    authenticated = mocks.authenticated;
    dispose = mocks.dispose;
  },
}));
vi.mock("./server/target", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./server/target")>()),
  resolveTarget: mocks.resolve,
}));
function fixture() {
  const handlers = new Map<string, (input: any, ctx: PluginHandlerContext) => Promise<any>>();
  const hooks = new Map<string, (input: any, ctx: PluginHandlerContext) => Promise<any>>();
  const server = {
    handle: (contract: { name: string }, handler: any) => handlers.set(contract.name, handler),
    on: (name: string, handler: any) => hooks.set(name, handler),
  };
  const agent = {
    id: "agent",
    provider: "claude",
    status: "error",
    cwd: "/work",
    lastError: "OAuth token has expired secret-private",
    archivedAt: null,
    pendingPermissions: [] as unknown[],
    activeTurn: null,
  };
  const ref = {
    refresh: vi.fn(async () => ({ agent })),
    reload: vi.fn(async () => ({ agent: { ...agent, status: "idle" } })),
    send: vi.fn(async () => {}),
    timeline: { append: vi.fn(async () => ({})) },
  };
  const context = {
    paseo: {
      agents: { ref: () => ref },
      config: { get: async () => ({ config: { providers: {} } }) },
    },
  } as unknown as PluginHandlerContext;
  const dispose = contribute(server as unknown as PluginServerContext);
  return {
    agent,
    ref,
    context,
    handlers,
    hooks,
    dispose,
    call: (name: string, input: unknown) => handlers.get(name)!(input, context),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticated.mockReturnValue(true);
  mocks.resolve.mockResolvedValue({ key: "target", provider: "claude" });
});
describe("conversation cards and recovery", () => {
  it("publishes one card per error without copying raw errors or secrets into history", async () => {
    const f = fixture();
    await f.call("auth.show", { agentId: "agent", automatic: true });
    await f.call("auth.show", { agentId: "agent", automatic: true });
    expect(f.ref.timeline.append).toHaveBeenCalledTimes(1);
    expect(f.ref.timeline.append).toHaveBeenCalledWith({
      type: "plugin",
      id: "auth",
      kind: "auth-request",
      version: 1,
      data: { provider: "claude", reason: "required" },
    });
    expect(JSON.stringify(f.ref.timeline.append.mock.calls)).not.toContain("secret-private");
  });
  it("ignores quota and policy failures, while allowing a manual card", async () => {
    const f = fixture();
    f.agent.lastError = "403 Forbidden by organization policy";
    expect(await f.call("auth.show", { agentId: "agent", automatic: true })).toEqual({
      shown: false,
    });
    expect(await f.call("auth.show", { agentId: "agent", automatic: false })).toEqual({
      shown: true,
    });
  });
  it("responds to explicit provider error codes in failed-turn events", async () => {
    const f = fixture();
    await f.hooks.get("agent.turn_ended")!(
      {
        agent: f.agent,
        outcome: {
          kind: "failed",
          error: { message: "request failed", code: "authentication_error" },
        },
      },
      f.context,
    );
    expect(f.ref.timeline.append).toHaveBeenCalledTimes(1);
  });
  it("does not reload a running or approval-blocked agent", async () => {
    const f = fixture();
    const input = { agentId: "agent", provider: "claude", sessionId: "session", action: "reload" };
    f.agent.status = "running";
    await expect(f.call("auth.recover", input)).rejects.toThrow("is running");
    f.agent.status = "idle";
    f.agent.pendingPermissions = [{}];
    await expect(f.call("auth.recover", input)).rejects.toThrow("is running");
    expect(f.ref.reload).not.toHaveBeenCalled();
  });
  it("requires successful login and explicit reload before continuing", async () => {
    const f = fixture();
    const input = {
      agentId: "agent",
      provider: "claude",
      sessionId: "session",
      action: "continue",
    };
    mocks.authenticated.mockReturnValue(false);
    await expect(f.call("auth.recover", input)).rejects.toThrow("Complete sign-in first");
    mocks.authenticated.mockReturnValue(true);
    await expect(f.call("auth.recover", input)).rejects.toThrow("Reload the current session first");
    expect(f.ref.send).not.toHaveBeenCalled();
  });
  it("reload and continue are idempotent per agent and login session", async () => {
    const f = fixture();
    const input = { agentId: "agent", provider: "claude", sessionId: "session", action: "reload" };
    await f.call("auth.recover", input);
    await f.call("auth.recover", input);
    expect(f.ref.reload).toHaveBeenCalledTimes(1);
    await f.call("auth.recover", { ...input, action: "continue" });
    await f.call("auth.recover", { ...input, action: "continue" });
    expect(f.ref.send).toHaveBeenCalledTimes(1);
  });
  it("a lost send acknowledgement cannot submit the same continuation twice", async () => {
    const f = fixture();
    const input = { agentId: "agent", provider: "claude", sessionId: "session", action: "reload" };
    await f.call("auth.recover", input);
    f.ref.send.mockRejectedValueOnce(new Error("disconnected"));
    await expect(f.call("auth.recover", { ...input, action: "continue" })).rejects.toThrow();
    await f.call("auth.recover", { ...input, action: "continue" });
    expect(f.ref.send).toHaveBeenCalledTimes(1);
  });
});
