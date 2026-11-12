import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { jobSchema, type JobInput, type Job, type Run } from "../shared/model";
import { buildRunArguments } from "./executor";
import type { Executor, Observation } from "./executor";
import { Store } from "./store";
import { Scheduler } from "./scheduler";
import { ConfigurationError } from "./agent-config";
import type { AgentConfig } from "../shared/agent-config";

class RecordingExecutor implements Executor {
  submissions: string[] = [];
  failSubmission = false;
  configurationError = false;
  configurations: Array<AgentConfig | null> = [];
  recovered: Observation | null = null;
  archives: string[] = [];
  failArchive = false;
  observedStatus: Observation["status"] = "finished";
  submit(_job: Job, runId: string, defaults: AgentConfig | null = null): Promise<string> {
    this.configurations.push(defaults);
    if (this.configurationError) return Promise.reject(new ConfigurationError("Profile missing"));
    this.submissions.push(runId);
    if (this.failSubmission) return Promise.reject(new Error("connection lost after send"));
    return Promise.resolve(randomUUID());
  }
  find(_run: Run): Promise<Observation | null> {
    return Promise.resolve(this.recovered);
  }
  observe(agentId: string): Promise<Observation> {
    return Promise.resolve({ agentId, status: this.observedStatus });
  }
  archive(agentId: string): Promise<string> {
    this.archives.push(agentId);
    if (this.failArchive) return Promise.reject(new Error("Archive unavailable"));
    return Promise.resolve("2026-01-31T01:01:00.000Z");
  }
}

const input: JobInput = {
  name: "Month-end report",
  prompt: "Generate a report",
  provider: "codex",
  agentConfigSource: "custom",
  profileId: "",
  cwd: "/tmp",
  mode: "",
  thinking: "",
  workspaceId: "",
  appendDateToTitle: false,
  autoArchive: false,
  rule: {
    calendarId: "civil",
    timezone: "Asia/Shanghai",
    recurrence: { kind: "monthly-date", day: -1 },
    adjustment: "skip",
    withinMonth: true,
    time: { kind: "fixed", at: "09:00" },
  },
  missed: "latest",
  enabled: true,
};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "paseo-scheduler-test-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await Store.open(directory);
  const executor = new RecordingExecutor();
  let now = new Date("2026-01-01T00:00:00Z");
  const scheduler = new Scheduler(
    store,
    executor,
    () => true,
    () => now,
  );
  cleanups.push(() => scheduler.stop());
  await scheduler.save(input, null, 0);
  return {
    directory,
    store,
    executor,
    scheduler,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

describe("durable scheduler", () => {
  it("atomically applies shared settings to all schedules without changing their cadence or pause state", async () => {
    const ctx = await setup();
    await ctx.scheduler.save(
      { ...input, name: "Paused", enabled: false, agentConfigSource: "profile", profileId: "old" },
      null,
      ctx.store.snapshot().revision,
    );
    const before = ctx.store.snapshot();
    const config = { source: "profile" as const, profileId: "shared" };
    expect(await ctx.scheduler.saveAgentDefaults(config, true, before.revision)).toBe(2);
    const after = ctx.store.snapshot();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.agentDefaults).toEqual(config);
    expect(after.jobs).toEqual(
      before.jobs.map((job) => ({
        ...job,
        agentConfigSource: "default",
        revision: job.revision + 1,
      })),
    );
    await expect(
      ctx.scheduler.saveAgentDefaults(
        { source: "custom", provider: "claude", mode: "plan", thinking: "" },
        true,
        before.revision,
      ),
    ).rejects.toThrow("Data changed");
    expect(ctx.store.snapshot()).toEqual(after);
    await ctx.scheduler.stop();
    const reopened = await Store.open(ctx.directory);
    cleanups.push(() => reopened.close());
    expect(reopened.snapshot()).toEqual(after);
  });

  it("only changes inheriting jobs when saving shared settings without apply-to-all", async () => {
    const ctx = await setup();
    const custom = ctx.store.snapshot().jobs[0];
    const first = {
      source: "custom" as const,
      provider: "claude/sonnet",
      mode: "plan",
      thinking: "",
    };
    await ctx.scheduler.saveAgentDefaults(first, false, ctx.store.snapshot().revision);
    await ctx.scheduler.save(
      { ...input, agentConfigSource: "default" },
      null,
      ctx.store.snapshot().revision,
    );
    await ctx.scheduler.saveAgentDefaults(
      { source: "profile", profileId: "personal" },
      false,
      ctx.store.snapshot().revision,
    );
    expect(ctx.store.snapshot().jobs[0]).toEqual(custom);
    ctx.setNow("2026-01-31T01:00:30Z");
    await ctx.scheduler.tick();
    expect(ctx.executor.configurations).toEqual([
      { source: "profile", profileId: "personal" },
      { source: "profile", profileId: "personal" },
    ]);
  });

  it("rejects missing shared configuration and empty profile references", async () => {
    const ctx = await setup();
    const revision = ctx.store.snapshot().revision;
    await expect(
      ctx.scheduler.save({ ...input, agentConfigSource: "default" }, null, revision),
    ).rejects.toThrow("shared agent configuration");
    await expect(
      ctx.scheduler.save({ ...input, agentConfigSource: "profile", profileId: "" }, null, revision),
    ).rejects.toThrow("Choose a Paseo agent profile");
    expect(ctx.store.snapshot().revision).toBe(revision);
  });

  it("records configuration errors as failed without an uncertain submission lock", async () => {
    const ctx = await setup();
    ctx.executor.configurationError = true;
    ctx.setNow("2026-01-31T01:00:30Z");
    await ctx.scheduler.tick();
    expect(ctx.store.snapshot().runs[0]).toMatchObject({
      status: "failed",
      message: "Profile missing",
      agentId: null,
    });
    ctx.executor.configurationError = false;
    await ctx.scheduler.runNow(ctx.store.snapshot().jobs[0].id);
    await ctx.scheduler.tick();
    expect(ctx.executor.submissions).toHaveLength(1);
  });

  it("archives an opted-in run only after the agent finishes", async () => {
    const ctx = await setup();
    const job = ctx.store.snapshot().jobs[0];
    await ctx.scheduler.save(
      { ...input, autoArchive: true },
      job.id,
      ctx.store.snapshot().revision,
    );
    ctx.setNow("2026-01-31T01:00:30Z");
    await ctx.scheduler.tick();
    expect(ctx.executor.archives).toEqual([]);
    ctx.executor.observedStatus = "submitted";
    await ctx.scheduler.tick();
    expect(ctx.executor.archives).toEqual([]);
    ctx.executor.observedStatus = "finished";
    await ctx.scheduler.tick();
    const run = ctx.store.snapshot().runs[0];
    expect(ctx.executor.archives).toEqual([run.agentId]);
    expect(run.archivedAt).toBe("2026-01-31T01:01:00.000Z");
    expect(run.archiveError).toBeNull();
    await ctx.scheduler.tick();
    expect(ctx.executor.archives).toHaveLength(1);
  });

  it("retries archiving failures without starting the task again", async () => {
    const ctx = await setup();
    await ctx.scheduler.save(
      { ...input, autoArchive: true },
      ctx.store.snapshot().jobs[0].id,
      ctx.store.snapshot().revision,
    );
    ctx.setNow("2026-01-31T01:00:30Z");
    await ctx.scheduler.tick();
    ctx.executor.failArchive = true;
    await ctx.scheduler.tick();
    expect(ctx.store.snapshot().runs[0].status).toBe("finished");
    expect(ctx.store.snapshot().runs[0].archiveError).toContain("Archive unavailable");
    ctx.executor.failArchive = false;
    await ctx.scheduler.tick();
    expect(ctx.store.snapshot().runs[0].archivedAt).toBe("2026-01-31T01:01:00.000Z");
    expect(ctx.store.snapshot().runs[0].archiveError).toBeNull();
    expect(ctx.executor.submissions).toHaveLength(1);
    expect(ctx.executor.archives).toHaveLength(2);
  });

  it("captures the archive preference per run rather than reading an edited schedule", async () => {
    const ctx = await setup();
    const id = ctx.store.snapshot().jobs[0].id;
    await ctx.scheduler.save({ ...input, autoArchive: true }, id, ctx.store.snapshot().revision);
    ctx.setNow("2026-01-31T01:00:30Z");
    await ctx.scheduler.tick();
    await ctx.scheduler.save({ ...input, autoArchive: false }, id, ctx.store.snapshot().revision);
    await ctx.scheduler.tick();
    expect(ctx.executor.archives).toHaveLength(1);
    expect(ctx.store.snapshot().jobs[0].autoArchive).toBe(false);
  });

  it("archives failed agents but never unresolved submissions", async () => {
    const ctx = await setup();
    await ctx.scheduler.save(
      { ...input, autoArchive: true },
      ctx.store.snapshot().jobs[0].id,
      ctx.store.snapshot().revision,
    );
    ctx.setNow("2026-01-31T01:00:30Z");
    ctx.executor.failSubmission = true;
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();
    expect(ctx.executor.archives).toHaveLength(0);
    expect(ctx.store.snapshot().runs[0].status).toBe("uncertain");
    ctx.executor.recovered = { agentId: randomUUID(), status: "failed" };
    await ctx.scheduler.tick();
    expect(ctx.store.snapshot().runs[0].status).toBe("failed");
    expect(ctx.executor.archives).toEqual([ctx.executor.recovered.agentId]);
  });

  it("resumes pending archival from disk after a restart", async () => {
    const ctx = await setup();
    await ctx.scheduler.save(
      { ...input, autoArchive: true },
      ctx.store.snapshot().jobs[0].id,
      ctx.store.snapshot().revision,
    );
    ctx.setNow("2026-01-31T01:00:30Z");
    ctx.executor.failArchive = true;
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();
    await ctx.scheduler.stop();
    const restored = await Store.open(ctx.directory);
    const executor = new RecordingExecutor();
    const scheduler = new Scheduler(
      restored,
      executor,
      () => true,
      () => new Date("2026-01-31T01:02:00Z"),
    );
    try {
      await scheduler.tick();
      expect(restored.snapshot().runs[0].archivedAt).toBe("2026-01-31T01:01:00.000Z");
      expect(executor.archives).toHaveLength(1);
      expect(executor.submissions).toHaveLength(0);
    } finally {
      await scheduler.stop();
    }
  });

  it("preserves an imported schedule's workspace, thinking, mode, prompt, and dated title", () => {
    const job = jobSchema.parse({
      ...input,
      id: randomUUID(),
      revision: 1,
      cursor: "2026-09-27T00:00:00.000Z",
      createdAt: "2026-09-27T00:00:00.000Z",
      error: null,
      name: "weekly-summary",
      prompt: "/weekly_summary",
      provider: "claudex",
      mode: "auto",
      thinking: "max",
      workspaceId: "/vault/Personal",
      appendDateToTitle: true,
    });
    const args = buildRunArguments({
      job,
      runId: "test-run",
      daemonHome: "/daemon",
      now: new Date("2026-09-27T14:30:00Z"),
    });
    expect(args).toEqual([
      "run",
      "--background",
      "--json",
      "--home",
      "/daemon",
      "--provider",
      "claudex",
      "--cwd",
      "/tmp",
      "--title",
      "weekly-summary 2026-09-27",
      "--label",
      "paseo-scheduler-run=test-run",
      "--label",
      "external-scheduler=paseo-scheduler",
      "--label",
      "external-schedule=weekly-summary",
      "--label",
      "external-schedule-date=2026-09-27",
      "--workspace",
      "/vault/Personal",
      "--mode",
      "auto",
      "--thinking",
      "max",
      "--",
      "/weekly_summary",
    ]);
  });

  it("keeps existing schedules on fresh workspaces when launch options are absent", () => {
    const job = jobSchema.parse({
      ...input,
      id: randomUUID(),
      revision: 1,
      cursor: "2026-09-27T00:00:00.000Z",
      createdAt: "2026-09-27T00:00:00.000Z",
      error: null,
    });
    const args = buildRunArguments({ job, runId: "test-run", daemonHome: "/daemon" });
    expect(
      args.slice(args.indexOf("--new-workspace"), args.indexOf("--new-workspace") + 2),
    ).toEqual(["--new-workspace", "local"]);
    expect(args).not.toContain("--workspace");
    expect(args).not.toContain("--thinking");
    expect(args[args.indexOf("--title") + 1]).toBe("Month-end report");
  });

  it("persists one trigger before submission and does not repeat it across ticks", async () => {
    const ctx = await setup();
    ctx.setNow("2026-01-31T01:00:30Z");
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();
    expect(ctx.executor.submissions).toHaveLength(1);
    expect(ctx.store.snapshot().runs[0].status).toBe("finished");
    expect(ctx.executor.archives).toEqual([]);
    const onDisk = JSON.parse(await readFile(join(ctx.directory, "state.json"), "utf8"));
    expect(onDisk.runs[0].id).toBe(ctx.executor.submissions[0]);
  });

  it("holds an uncertain submission and later reconciles it without retrying", async () => {
    const ctx = await setup();
    ctx.executor.failSubmission = true;
    ctx.setNow("2026-01-31T01:00:30Z");
    await ctx.scheduler.tick();
    expect(ctx.store.snapshot().runs[0].status).toBe("uncertain");
    await ctx.scheduler.tick();
    expect(ctx.executor.submissions).toHaveLength(1);
    ctx.executor.recovered = { agentId: randomUUID(), status: "finished" };
    await ctx.scheduler.tick();
    expect(ctx.store.snapshot().runs[0].status).toBe("finished");
    expect(ctx.executor.submissions).toHaveLength(1);
  });

  it("only catches up the latest missed occurrence", async () => {
    const ctx = await setup();
    ctx.setNow("2026-04-01T00:00:00Z");
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();
    expect(ctx.executor.submissions).toHaveLength(1);
    expect(ctx.store.snapshot().runs[0].scheduledAt).toBe("2026-03-31T01:00:00.000Z");
  });

  it("records skipped missed occurrences without launching an agent", async () => {
    const ctx = await setup();
    const job = ctx.store.snapshot().jobs[0];
    await ctx.scheduler.save({ ...input, missed: "skip" }, job.id, ctx.store.snapshot().revision);
    ctx.setNow("2026-04-01T00:00:00Z");
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();
    expect(ctx.executor.submissions).toHaveLength(0);
    expect(ctx.store.snapshot().runs.map((run) => run.status)).toEqual(["skipped"]);
  });

  it("rejects stale client writes and preserves the saved job", async () => {
    const ctx = await setup();
    const job = ctx.store.snapshot().jobs[0];
    await expect(ctx.scheduler.save({ ...input, name: "old editor" }, job.id, 0)).rejects.toThrow(
      "Data changed",
    );
    expect(ctx.store.snapshot().jobs[0].name).toBe("Month-end report");
  });

  it("prevents two plugin processes from owning the same storage", async () => {
    const ctx = await setup();
    await expect(Store.open(ctx.directory)).rejects.toThrow("Lock file is already being held");
  });

  it("restores the ledger and cursor from disk after closing the store", async () => {
    const ctx = await setup();
    ctx.setNow("2026-01-31T01:00:30Z");
    await ctx.scheduler.tick();
    const before = ctx.store.snapshot();
    await ctx.scheduler.stop();
    const restored = await Store.open(ctx.directory);
    try {
      expect(restored.snapshot()).toEqual(before);
    } finally {
      await restored.close();
    }
  });

  it("refuses to reuse the same ledger for another daemon home", async () => {
    const root = await mkdtemp(join(tmpdir(), "paseo-binding-test-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const firstHome = join(root, "first");
    const secondHome = join(root, "second");
    await mkdir(firstHome);
    await mkdir(secondHome);
    const store = await Store.open(join(root, "data"), firstHome);
    await store.close();
    await expect(Store.open(join(root, "data"), secondHome)).rejects.toThrow(
      "bound to another daemon",
    );
  });

  it("keeps unknown post-restart submissions blocked until reconciled", async () => {
    const ctx = await setup();
    const job = ctx.store.snapshot().jobs[0];
    await ctx.store.update((state) => {
      state.runs.push({
        id: randomUUID(),
        jobId: job.id,
        jobName: job.name,
        jobRevision: 1,
        scheduledAt: "2026-01-31T01:00:00.000Z",
        calendarVersion: "1",
        status: "dispatching",
        agentId: null,
        message: "",
        updatedAt: "2026-01-31T01:00:00.000Z",
        autoArchive: false,
        archivedAt: null,
        archiveError: null,
      });
    });
    ctx.setNow("2026-02-01T00:00:00Z");
    await ctx.scheduler.tick();
    expect(ctx.store.snapshot().runs[0].status).toBe("uncertain");
    expect(ctx.executor.submissions).toHaveLength(0);
  });
});
