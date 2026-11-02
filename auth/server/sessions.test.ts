import { afterEach, describe, it, expect, vi } from "vitest";
import { AuthSessions } from "./sessions";
import type { Launch, ProcessEvents } from "./process";
import type { Target } from "./target";

const target: Target = {
  key: "test",
  provider: "claude",
  command: "claude",
  cwd: "/work",
  env: {},
};
const registries: AuthSessions[] = [];
function fixture(ttl?: number) {
  const calls: {
    args: string[];
    events: ProcessEvents;
    write: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const launch: Launch = (_target, args, events) => {
    const call = {
      args,
      events,
      write: vi.fn(),
      stop: vi.fn(() => queueMicrotask(() => events.exit(143))),
    };
    calls.push(call);
    return call;
  };
  const sessions = new AuthSessions(launch, ttl);
  registries.push(sessions);
  return { sessions, calls };
}
async function tick() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
afterEach(async () => {
  await Promise.all(registries.splice(0).map((r) => r.dispose()));
  vi.useRealTimers();
});

describe("login lifecycle", () => {
  it("deduplicates simultaneous login starts for a credential scope", () => {
    const { sessions, calls } = fixture();
    const one = sessions.start(target);
    const two = sessions.start(target);
    expect(one.sessionId).toBe(two.sessionId);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["auth", "login"]);
  });
  it("sends a Claude code only to its active CLI, then verifies login", async () => {
    const { sessions, calls } = fixture();
    const started = sessions.start(target);
    calls[0].events.data(
      "https://claude.com/cai/oauth/authorize?state=secret\nPaste code here if prompted > ",
    );
    sessions.submit(target, started.sessionId!, "code#state");
    expect(calls[0].write).toHaveBeenCalledWith("code#state");
    expect(sessions.state(target).expectsCode).toBe(false);
    expect(() => sessions.submit(target, started.sessionId!, "again")).toThrow();
    calls[0].events.exit(0);
    expect(calls[1].args).toEqual(["auth", "status"]);
    calls[1].events.data(JSON.stringify({ loggedIn: true, email: "user@example.test" }));
    calls[1].events.exit(0);
    await tick();
    expect(sessions.state(target)).toMatchObject({
      phase: "succeeded",
      status: "authenticated",
      account: "user@example.test",
    });
    expect(sessions.state(target).url).toBeUndefined();
    expect(JSON.stringify(sessions.state(target))).not.toContain("secret");
  });
  it("cancel kills the process, clears codes and ignores late output", () => {
    const { sessions, calls } = fixture();
    const t = { ...target, provider: "codex" as const };
    const first = sessions.start(t);
    calls[0].events.data("https://auth.openai.com/codex/deviceauth\nABCD-1234\n");
    sessions.cancel(t, first.sessionId!);
    calls[0].events.data("ABCD-5678\n");
    expect(calls[0].stop).toHaveBeenCalled();
    expect(sessions.state(t)).toMatchObject({
      phase: "canceled",
      url: undefined,
      deviceCode: undefined,
    });
    const second = sessions.start(t);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(() => sessions.cancel(t, first.sessionId!)).toThrow();
  });
  it("expires unattended flows without keeping credentials in the view", async () => {
    vi.useFakeTimers();
    const { sessions, calls } = fixture(1000);
    sessions.start(target);
    calls[0].events.data("https://claude.ai/oauth/authorize?state=secret\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sessions.state(target)).toMatchObject({ phase: "expired", url: undefined });
  });
  it("fails closed on CLI failure or unverified successful exit", async () => {
    const { sessions, calls } = fixture();
    sessions.start(target);
    calls[0].events.exit(0);
    calls[1].events.data('{"loggedIn":false}');
    calls[1].events.exit(1);
    await tick();
    expect(sessions.state(target).phase).toBe("failed");
    sessions.start(target);
    calls[2].events.data("private-token=secret");
    calls[2].events.exit(1);
    expect(JSON.stringify(sessions.state(target))).not.toContain("secret");
  });
  it("a slow pre-login status check cannot overwrite a newer successful login", async () => {
    const { sessions, calls } = fixture();
    const checking = sessions.check(target);
    sessions.start(target);
    calls[1].events.exit(0);
    calls[2].events.data('{"loggedIn":true}');
    calls[2].events.exit(0);
    await tick();
    calls[0].events.data('{"loggedIn":false}');
    calls[0].events.exit(1);
    await checking;
    expect(sessions.state(target)).toMatchObject({ phase: "succeeded", status: "authenticated" });
  });
  it("checks once when multiple clients request status", async () => {
    const { sessions, calls } = fixture();
    const a = sessions.check(target);
    const b = sessions.check(target);
    expect(calls).toHaveLength(1);
    calls[0].events.data('{"loggedIn":true}');
    calls[0].events.exit(0);
    expect((await a).status).toBe("authenticated");
    expect((await b).status).toBe("authenticated");
  });
  it("rejects control characters in codes and bounds CLI output", () => {
    const { sessions, calls } = fixture();
    const initial = sessions.start(target);
    calls[0].events.data("Paste code here if prompted > ");
    expect(() => sessions.submit(target, initial.sessionId!, "code\ncommand")).toThrow();
    calls[0].events.data("x".repeat(65537));
    expect(sessions.state(target).phase).toBe("failed");
    expect(calls[0].stop).toHaveBeenCalled();
  });
  it("prevents login when credentials are externally managed", () => {
    const { sessions, calls } = fixture();
    expect(sessions.start({ ...target, problem: "Managed" })).toMatchObject({
      canLogin: false,
      status: "unsupported",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("status check feedback", () => {
  it("records why a check was skipped and preserves it across state reads", async () => {
    const { sessions, calls } = fixture();
    const blocked = { ...target, problem: "配置使用 OPENAI_API_KEY，无法执行此检查。" };
    expect(sessions.state(blocked).lastCheck).toBeUndefined();
    const result = await sessions.check(blocked);
    expect(result.lastCheck).toEqual({
      at: expect.any(Number),
      kind: "skipped",
      status: "unsupported",
      message: blocked.problem,
    });
    expect(sessions.state(blocked).lastCheck).toEqual(result.lastCheck);
    expect(sessions.state(target).lastCheck).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
  it("reports missing executables without suggesting that credentials were inspected", async () => {
    const { sessions, calls } = fixture();
    expect(
      (await sessions.check({ ...target, missing: true, problem: "CLI 未安装" })).lastCheck,
    ).toMatchObject({ kind: "skipped", status: "missing" });
    expect(calls).toHaveLength(0);
  });
  it("records each completed check even when the authentication result is unchanged", async () => {
    vi.useFakeTimers();
    const { sessions, calls } = fixture();
    vi.setSystemTime(10000);
    const first = sessions.check(target);
    calls[0].events.data('{"loggedIn":true}');
    calls[0].events.exit(0);
    expect((await first).lastCheck).toMatchObject({
      at: 10000,
      kind: "checked",
      status: "authenticated",
    });
    vi.setSystemTime(20000);
    const second = sessions.check(target);
    calls[1].events.data('{"loggedIn":true}');
    calls[1].events.exit(0);
    expect((await second).lastCheck).toMatchObject({
      at: 20000,
      kind: "checked",
      status: "authenticated",
    });
    expect(sessions.state(target).lastCheck?.at).toBe(20000);
    sessions.start(target);
    expect(sessions.state(target).lastCheck).toBeUndefined();
  });
  it("records failed CLI checks instead of dropping their feedback", async () => {
    const { sessions, calls } = fixture();
    const checking = sessions.check(target);
    calls[0].events.error();
    expect((await checking).lastCheck).toMatchObject({
      kind: "checked",
      status: "error",
      message: expect.stringContaining("无法检查"),
    });
  });
});
