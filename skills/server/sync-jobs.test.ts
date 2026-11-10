import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { expect, test, vi } from "vitest";
import { SkillSync } from "./sync";
import { SyncJobs } from "./sync-jobs";

const input = {
  agentId: "agent",
  token: "preview",
  names: ["one"],
  direction: "upload" as const,
  overwrite: false,
};
const context = {} as PluginHandlerContext;

test("returns immediately for a slow transfer and deduplicates retries", async () => {
  let finish!: (value: { completed: string[]; backups: string[]; error: null }) => void;
  const apply = vi.fn(
    () =>
      new Promise<{ completed: string[]; backups: string[]; error: null }>((resolve) => {
        finish = resolve;
      }),
  );
  const jobs = new SyncJobs({ apply } as unknown as SkillSync);
  const first = jobs.start(input, context);
  expect(jobs.status({ agentId: "agent" })).toMatchObject({
    jobId: first.jobId,
    state: "running",
    result: null,
  });
  expect(jobs.start(input, context)).toEqual(first);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(() => jobs.start({ ...input, token: "another" }, context)).toThrow(/already/);
  expect(jobs.status({ agentId: "other" })).toBeNull();
  finish({ completed: ["one"], backups: [], error: null });
  await Promise.resolve();
  expect(jobs.status({ agentId: "agent" })).toMatchObject({
    state: "finished",
    result: { completed: ["one"], error: null },
  });
  expect(jobs.start(input, context)).toEqual(first);
  expect(apply).toHaveBeenCalledTimes(1);
});

test("retains a failed transfer result for clients that reopen the page", async () => {
  const apply = vi.fn().mockRejectedValue(new Error("Concurrent remote change"));
  const jobs = new SyncJobs({ apply } as unknown as SkillSync);
  jobs.start(input, context);
  await Promise.resolve();
  expect(jobs.status({ agentId: "agent" })).toMatchObject({
    state: "finished",
    result: { completed: [], error: "Concurrent remote change" },
  });
});
