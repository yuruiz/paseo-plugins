import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { inspectionOptions } from "./query";
import type { Inspection } from "../shared/contracts";

vi.mock("@getpaseo/plugin/client", () => ({ useAgent: vi.fn(), useRpc: vi.fn() }));

it("shares manual inspection results with list rows without auto-connecting or crossing agents/revisions", async () => {
  const client = new QueryClient();
  const result: Inspection = {
    status: "connected",
    message: "ok",
    checkedAt: "2026-10-28T00:00:00Z",
    capabilities: {},
    entries: [],
    warnings: [],
  };
  const inspect = vi.fn(async () => result);
  const server = { id: "server", revision: "v1" };
  const row = new QueryObserver(client, inspectionOptions("a", server, inspect));
  const detail = new QueryObserver(client, inspectionOptions("a", server, inspect));
  const changed = new QueryObserver(
    client,
    inspectionOptions("a", { ...server, revision: "v2" }, inspect),
  );
  const otherAgent = new QueryObserver(client, inspectionOptions("b", server, inspect));
  const observers = [row, detail, changed, otherAgent];
  observers.forEach((observer) => observer.subscribe(() => undefined));
  try {
    expect(inspect).not.toHaveBeenCalled();
    expect(row.getCurrentResult().data).toBeUndefined();
    const work = detail.refetch();
    expect(row.getCurrentResult().isFetching).toBe(true);
    await work;
    expect(row.getCurrentResult().data?.status).toBe("connected");
    expect(changed.getCurrentResult().data).toBeUndefined();
    expect(otherAgent.getCurrentResult().data).toBeUndefined();
    expect(inspect).toHaveBeenCalledOnce();

    // A retry that fails must override the old successful status in the row.
    inspect.mockRejectedValueOnce(new Error("offline"));
    await detail.refetch();
    expect(row.getCurrentResult().isError).toBe(true);
    expect(row.getCurrentResult().isFetching).toBe(false);
  } finally {
    observers.forEach((observer) => observer.destroy());
    client.clear();
  }
});
