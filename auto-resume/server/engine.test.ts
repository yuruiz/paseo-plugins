import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaults, type State } from "../shared/contracts";
import { ResumeEngine, type Failure } from "./engine";
import type { Gateway, Observation } from "./gateway";
import type { Store } from "./store";

function fixture(initial?: State) {
  let state: State = structuredClone(initial ?? { version: 1, preferences: {}, jobs: {} });
  const store = {
    snapshot: () => structuredClone(state),
    update: async (change: (next: State) => void) => {
      const next = structuredClone(state);
      change(next);
      state = next;
    },
    close: async () => {},
  } as unknown as Store;
  const observation: Observation = {
    provider: "codex",
    status: "error",
    archived: false,
    permissions: false,
    lastUserMessageAt: "2026-11-01T07:00:00Z",
  };
  const gateway: Gateway = {
    inspect: vi.fn(async () => ({ ...observation })),
    captureTranscript: vi.fn(async () => "transcript-1"),
    send: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
  };
  const engine = new ResumeEngine(store, gateway);
  return { engine, store, gateway, observation };
}
const failure: Failure = {
  agentId: "a",
  workspaceId: "w",
  provider: "codex",
  text: "You've hit your usage limit. Try again in 1 hour",
  key: "turn1",
};
const active: ResumeEngine[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T08:00:00Z"));
});
afterEach(async () => {
  await Promise.all(active.splice(0).map((engine) => engine.stop()));
  vi.useRealTimers();
});
async function setup(auto = false) {
  const f = fixture();
  active.push(f.engine);
  await f.engine.start();
  if (auto) await f.engine.configure("a", { ...defaults(), enabled: true });
  await f.engine.detect(failure);
  return f;
}
async function due(f: ReturnType<typeof fixture>) {
  const job = f.engine.view("a").job!;
  vi.setSystemTime(new Date(job.runAt!));
  await f.engine.fire("a", job.id);
}
describe("quota recovery lifecycle", () => {
  it("defaults to opt-in, then schedules a one-shot in the same conversation", async () => {
    const f = await setup();
    const job = f.engine.view("a").job!;
    expect(job.status).toBe("detected");
    expect(f.gateway.send).not.toHaveBeenCalled();
    await f.engine.schedule("a", job.id);
    expect(f.engine.view("a").job!.runAt).toBe("2026-11-01T09:01:00.000Z");
    await due(f);
    expect(f.gateway.send).toHaveBeenCalledOnce();
    expect(f.engine.view("a").job!.status).toBe("resumed");
    await f.engine.fire("a", job.id);
    expect(f.gateway.send).toHaveBeenCalledOnce();
  });
  it("automatically waits and Croner fires only once", async () => {
    const f = await setup(true);
    await vi.advanceTimersByTimeAsync(3600000);
    expect(f.gateway.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.gateway.send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.gateway.send).toHaveBeenCalledOnce();
  });
  it("does not invent a recovery time", async () => {
    const f = await setup(true);
    await f.engine.detect({ ...failure, key: "unknown", text: "You've hit your usage limit" });
    expect(f.engine.view("a").job!.status).toBe("detected");
    expect(f.engine.view("a").job!.runAt).toBeNull();
    await expect(f.engine.schedule("a", f.engine.view("a").job!.id)).rejects.toThrow("future");
  });
  it("cancel and disabling both stop a pending job", async () => {
    const f = await setup(true);
    const job = f.engine.view("a").job!;
    await f.engine.cancel("a", job.id);
    await vi.advanceTimersByTimeAsync(4000000);
    expect(f.gateway.send).not.toHaveBeenCalled();
    await f.engine.detect({ ...failure, key: "again" });
    await f.engine.configure("a", { ...defaults(), enabled: false });
    expect(f.engine.view("a").job!.status).toBe("canceled");
  });
  it.each(["running", "permissions", "archived", "provider", "user"])(
    "does not send when %s changes",
    async (change) => {
      const f = await setup(true);
      if (change === "running") f.observation.status = "running";
      if (change === "permissions") f.observation.permissions = true;
      if (change === "archived") f.observation.archived = true;
      if (change === "provider") f.observation.provider = "claude";
      if (change === "user") f.observation.lastUserMessageAt = "2026-11-01T08:30:00Z";
      await due(f);
      expect(f.gateway.send).not.toHaveBeenCalled();
      expect(f.engine.view("a").job!.status).toBe("canceled");
    },
  );
  it("deduplicates hook delivery and rejects stale card actions", async () => {
    const f = await setup(true);
    const id = f.engine.view("a").job!.id;
    await f.engine.detect(failure);
    expect(f.engine.view("a").job!.id).toBe(id);
    await f.engine.detect({ ...failure, key: "new" });
    await expect(f.engine.schedule("a", id)).rejects.toThrow("outdated");
  });
  it("stops after the configured number of consecutive quota failures", async () => {
    const f = await setup(true);
    await f.engine.configure("a", { ...defaults(), enabled: true, maxAttempts: 2 });
    await due(f);
    await f.engine.detect({ ...failure, key: "turn2" });
    expect(f.engine.view("a").job!.attempts).toBe(1);
    await due(f);
    await f.engine.detect({ ...failure, key: "turn3" });
    expect(f.engine.view("a").job!.status).toBe("attention");
    expect(f.gateway.send).toHaveBeenCalledTimes(2);
  });
  it("continues a manually authorized wait through another quota failure", async () => {
    const f = await setup();
    await f.engine.schedule("a", f.engine.view("a").job!.id);
    await due(f);
    await f.engine.detect({ ...failure, key: "turn2" });
    expect(f.engine.view("a").job!.status).toBe("waiting");
  });
  it("does not silently resend an ambiguous send failure", async () => {
    const f = await setup(true);
    vi.mocked(f.gateway.send).mockRejectedValue(new Error("connection dropped after write"));
    await due(f);
    expect(f.engine.view("a").job!.status).toBe("attention");
    await expect(
      f.engine.schedule(
        "a",
        f.engine.view("a").job!.id,
        new Date(Date.now() + 3600000).toISOString(),
      ),
    ).rejects.toThrow("continue manually");
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.gateway.send).toHaveBeenCalledOnce();
  });
  it("rechecks after read failure without submitting a prompt", async () => {
    const f = await setup(true);
    vi.mocked(f.gateway.inspect).mockRejectedValueOnce(new Error("offline"));
    await due(f);
    expect(f.gateway.send).not.toHaveBeenCalled();
    expect(f.engine.view("a").job!.status).toBe("waiting");
    await due(f);
    expect(f.gateway.send).toHaveBeenCalledOnce();
  });
  it("cancellation during the final status read prevents dispatch", async () => {
    const f = await setup(true);
    let unblock!: (value: Observation) => void;
    vi.mocked(f.gateway.inspect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          unblock = resolve;
        }),
    );
    const job = f.engine.view("a").job!;
    vi.setSystemTime(new Date(job.runAt!));
    const firing = f.engine.fire("a", job.id);
    await Promise.resolve();
    await Promise.resolve();
    const cancel = f.engine.cancel("a", job.id);
    unblock(f.observation);
    await Promise.all([firing, cancel]);
    expect(f.gateway.send).not.toHaveBeenCalled();
    expect(f.engine.view("a").job!.status).toBe("canceled");
  });
  it("cancels on manual turn start, but permits its own turn start", async () => {
    const f = await setup(true);
    await f.engine.started("a");
    expect(f.engine.view("a").job!.status).toBe("canceled");
    await f.engine.detect({ ...failure, key: "second" });
    vi.mocked(f.gateway.send).mockImplementationOnce(async () => {
      await f.engine.started("a");
    });
    await due(f);
    expect(f.engine.view("a").job!.status).toBe("resumed");
    await f.engine.started("a");
    expect(f.engine.view("a").job!.authorized).toBe(false);
  });
});
describe("preference changes during recovery", () => {
  it("turning off after dispatch revokes authorization for subsequent quota retries", async () => {
    const f = await setup(true);
    await due(f);
    await f.engine.configure("a", { ...defaults(), enabled: false });
    await f.engine.detect({ ...failure, key: "limited-again" });
    expect(f.engine.view("a").job!.status).toBe("detected");
    expect(f.engine.view("a").job!.authorized).toBe(false);
  });
  it("saving preferences with auto mode already off preserves a manual appointment", async () => {
    const f = await setup();
    await f.engine.schedule("a", f.engine.view("a").job!.id);
    await f.engine.configure("a", { ...defaults(), enabled: false, maxAttempts: 2 });
    expect(f.engine.view("a").job!.status).toBe("waiting");
    expect(f.engine.view("a").job!.authorized).toBe(true);
  });
});
describe("restart recovery", () => {
  it("rebuilds an overdue one-shot and validates the saved transcript", async () => {
    const f = await setup(true);
    const snapshot = f.store.snapshot();
    await f.engine.stop();
    const restored = fixture(snapshot);
    active.push(restored.engine);
    restored.observation.transcriptHash = "transcript-1";
    restored.observation.lastUserMessageAt = null;
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    await restored.engine.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(restored.gateway.send).toHaveBeenCalledOnce();
  });
  it("does not resume a transcript changed while the plugin was stopped", async () => {
    const f = await setup(true);
    const snapshot = f.store.snapshot();
    await f.engine.stop();
    const restored = fixture(snapshot);
    active.push(restored.engine);
    restored.observation.transcriptHash = "new-message";
    await restored.engine.start();
    await due(restored);
    expect(restored.gateway.send).not.toHaveBeenCalled();
  });
  it("marks interrupted dispatch unknown instead of duplicating it", async () => {
    const f = await setup(true);
    const snapshot = f.store.snapshot();
    snapshot.jobs.a.status = "sending";
    await f.engine.stop();
    const restored = fixture(snapshot);
    active.push(restored.engine);
    await restored.engine.start();
    expect(restored.engine.view("a").job!.status).toBe("attention");
    await vi.advanceTimersByTimeAsync(4000000);
    expect(restored.gateway.send).not.toHaveBeenCalled();
  });
});
