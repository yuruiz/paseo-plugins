import type { PluginClientContext } from "@getpaseo/plugin/client";
import { afterEach, expect, it, vi } from "vitest";
import { contributePills } from "./pills";

vi.mock("react-native", () => ({ Pressable: () => null, Text: () => null, View: () => null }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: () => null }));
vi.mock("./browser", () => ({ McpBrowser: () => null }));
vi.mock("./query", () => ({ useServers: () => ({}) }));

type Agent = { id: string; workspaceId?: string; archivedAt?: string };
type Observer = {
  snapshot(value: {
    entries: { agent: Agent }[];
    pageInfo: { hasMore: boolean; nextCursor: string | null };
  }): void;
  update(value: { type: string; payload: { kind: string; agent?: Agent; agentId?: string } }): void;
  error(error: unknown): void;
};
function harness() {
  let observer: Observer | undefined;
  const release = vi.fn(async () => undefined);
  const subscription = {
    release,
    subscribe: (value: Observer) => {
      observer = value;
      return () => undefined;
    },
  };
  const registrations: { remove: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }[] =
    [];
  const addComposerPill = vi.fn(() => {
    const registration = { remove: vi.fn(), update: vi.fn() };
    registrations.push(registration);
    return registration;
  });
  const list = vi.fn(async (_input: unknown) => ({ subscription }));
  const client = {
    paseo: { agents: { list } },
    addComposerPill,
    openPanel: vi.fn(),
  } as unknown as PluginClientContext;
  return {
    client,
    list,
    release,
    subscription,
    registrations,
    addComposerPill,
    observer: () => observer!,
  };
}
afterEach(() => vi.useRealTimers());

it("keeps pills stable across updates, removes archived agents and releases its own observation", async () => {
  const h = harness();
  const stop = contributePills(h.client);
  await Promise.resolve();
  h.observer().snapshot({
    entries: [{ agent: { id: "a", workspaceId: "w" } }],
    pageInfo: { hasMore: false, nextCursor: null },
  });
  h.observer().update({
    type: "agent_update",
    payload: { kind: "upsert", agent: { id: "a", workspaceId: "w" } },
  });
  expect(h.addComposerPill).toHaveBeenCalledTimes(1);
  h.observer().update({
    type: "agent_update",
    payload: { kind: "upsert", agent: { id: "a", workspaceId: "new" } },
  });
  expect(h.registrations[0].remove).toHaveBeenCalledOnce();
  expect(h.addComposerPill).toHaveBeenCalledTimes(2);
  h.observer().update({
    type: "agent_update",
    payload: { kind: "upsert", agent: { id: "a", workspaceId: "new", archivedAt: "now" } },
  });
  expect(h.registrations[1].remove).toHaveBeenCalledOnce();
  stop();
  expect(h.release).toHaveBeenCalledOnce();
  h.observer().snapshot({
    entries: [{ agent: { id: "late", workspaceId: "w" } }],
    pageInfo: { hasMore: false, nextCursor: null },
  });
  expect(h.addComposerPill).toHaveBeenCalledTimes(2);
});

it("releases a subscription whose bootstrap finishes after cleanup", async () => {
  const h = harness();
  let resolve!: (value: { subscription: typeof h.subscription }) => void;
  h.list.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const stop = contributePills(h.client);
  stop();
  resolve({ subscription: h.subscription });
  await Promise.resolve();
  expect(h.release).toHaveBeenCalledOnce();
  expect(h.addComposerPill).not.toHaveBeenCalled();
});

it("reopens failed observations and cancels the retry on teardown", async () => {
  vi.useFakeTimers();
  const h = harness();
  const stop = contributePills(h.client);
  await Promise.resolve();
  h.observer().error(new Error("offline"));
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.list).toHaveBeenCalledTimes(2);
  h.observer().error(new Error("offline"));
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.list).toHaveBeenCalledTimes(2);
});

it("loads later pages while preserving removal deltas received during pagination", async () => {
  const h = harness();
  const stop = contributePills(h.client);
  await Promise.resolve();
  h.list.mockImplementation(async () => ({
    subscription: h.subscription,
    entries: [{ agent: { id: "b", workspaceId: "w" } }, { agent: { id: "c", workspaceId: "w" } }],
    pageInfo: { hasMore: false, nextCursor: null },
  }));
  h.observer().snapshot({
    entries: [{ agent: { id: "a", workspaceId: "w" } }],
    pageInfo: { hasMore: true, nextCursor: "next" },
  });
  h.observer().update({ type: "agent_update", payload: { kind: "remove", agentId: "b" } });
  await Promise.resolve();
  expect(h.addComposerPill).toHaveBeenCalledTimes(2);
  expect(
    h.addComposerPill.mock.calls.map(
      (call) => (call as unknown as [{ agentId: string }])[0].agentId,
    ),
  ).toEqual(["a", "c"]);
  stop();
});
