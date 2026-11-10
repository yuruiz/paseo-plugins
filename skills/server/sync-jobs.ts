import { randomUUID } from "node:crypto";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

import { syncSkills, syncStatus } from "../shared/sync";
import { SkillSync } from "./sync";

type Job = NonNullable<RpcOutput<typeof syncStatus>> & { request: string };

export class SyncJobs {
  private readonly jobs = new Map<string, Job>();
  constructor(private readonly sync: SkillSync) {}

  start(input: RpcInput<typeof syncSkills>, context: PluginHandlerContext) {
    const request = JSON.stringify(input);
    const previous = this.jobs.get(input.agentId);
    if (previous?.request === request) return { jobId: previous.jobId };
    if (previous?.state === "running")
      throw new Error("This agent already has a sync in progress.");
    if ([...this.jobs.values()].filter((job) => job.state === "running").length >= 8)
      throw new Error("Too many syncs in progress. Wait for them to finish.");
    if (this.jobs.size >= 32) {
      const oldest = [...this.jobs].find(([, job]) => job.state === "finished");
      if (oldest) this.jobs.delete(oldest[0]);
    }
    const job: Job = {
      jobId: randomUUID(),
      direction: input.direction,
      state: "running",
      result: null,
      request,
    };
    this.jobs.delete(input.agentId);
    this.jobs.set(input.agentId, job);
    void this.sync.apply(input, context).then(
      (result) => {
        job.result = result;
        job.state = "finished";
      },
      (error) => {
        job.result = {
          completed: [],
          backups: [],
          error: error instanceof Error ? error.message : String(error),
        };
        job.state = "finished";
      },
    );
    return { jobId: job.jobId };
  }

  status(input: RpcInput<typeof syncStatus>): RpcOutput<typeof syncStatus> {
    const job = this.jobs.get(input.agentId);
    if (!job) return null;
    return { jobId: job.jobId, direction: job.direction, state: job.state, result: job.result };
  }
}
