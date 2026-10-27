import { execFile } from "node:child_process";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import type { Job, Run } from "../shared/model";
import type { Settings } from "../shared/settings";

export interface Observation {
  agentId: string;
  status: "submitted" | "finished" | "failed";
}
export interface Executor {
  submit(job: Job, runId: string): Promise<string>;
  find(run: Run): Promise<Observation | null>;
  observe(agentId: string): Promise<Observation>;
  archive(agentId: string): Promise<string>;
}

interface RunArgumentsInput {
  job: Job;
  runId: string;
  daemonHome: string;
  now?: Date;
}

export function buildRunArguments({
  job,
  runId,
  daemonHome,
  now = new Date(),
}: RunArgumentsInput): string[] {
  const date = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(job.rule.timezone)
    .toPlainDate()
    .toString();
  const title = job.appendDateToTitle ? `${job.name} ${date}` : job.name;
  const args = [
    "run",
    "--background",
    "--json",
    "--home",
    daemonHome,
    "--provider",
    job.provider,
    "--cwd",
    job.cwd,
    "--title",
    title,
    "--label",
    `paseo-scheduler-run=${runId}`,
    "--label",
    "external-scheduler=paseo-scheduler",
    "--label",
    `external-schedule=${job.name}`,
    "--label",
    `external-schedule-date=${date}`,
  ];
  if (job.workspaceId) args.push("--workspace", job.workspaceId);
  else args.push("--new-workspace", "local");
  if (job.mode) args.push("--mode", job.mode);
  if (job.thinking) args.push("--thinking", job.thinking);
  args.push("--", job.prompt);
  return args;
}

export class CliExecutor implements Executor {
  constructor(
    private settings: Settings,
    private signal: AbortSignal,
  ) {}

  private command(args: string[]): Promise<unknown> {
    const env = { ...process.env };
    delete env.PASEO_AGENT_ID;
    delete env.PASEO_WORKSPACE_ID;
    delete env.PASEO_HOST;
    env.PASEO_HOME = this.settings.daemonHome;
    return new Promise((resolve, reject) => {
      execFile(
        this.settings.cliPath,
        args,
        {
          env,
          signal: this.signal,
          timeout: 30000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Paseo CLI call failed: ${stderr.trim() || error.message}`));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error("Paseo CLI returned invalid JSON; check its version and path"));
          }
        },
      );
    });
  }

  async submit(job: Job, runId: string): Promise<string> {
    const args = buildRunArguments({ job, runId, daemonHome: this.settings.daemonHome });
    const output = z.object({ agentId: z.uuid() }).parse(await this.command(args));
    return output.agentId;
  }

  async find(run: Run): Promise<Observation | null> {
    const output = await this.command([
      "ls",
      "--all",
      "--global",
      "--label",
      `paseo-scheduler-run=${run.id}`,
      "--json",
      "--home",
      this.settings.daemonHome,
    ]);
    const agents = z.array(z.object({ id: z.uuid() })).parse(output);
    if (agents.length > 1)
      throw new Error("Multiple agents match this occurrence ID; manual review is required");
    return agents.length === 1 ? this.observe(agents[0].id) : null;
  }

  async observe(agentId: string): Promise<Observation> {
    const output = await this.command([
      "inspect",
      agentId,
      "--json",
      "--home",
      this.settings.daemonHome,
    ]);
    const agent = z.object({ Id: z.uuid(), Status: z.string() }).parse(output);
    if (agent.Status === "idle" || agent.Status === "closed")
      return { agentId: agent.Id, status: "finished" };
    if (agent.Status === "error") return { agentId: agent.Id, status: "failed" };
    return { agentId: agent.Id, status: "submitted" };
  }

  async archive(agentId: string): Promise<string> {
    const current = z
      .object({
        Status: z.string(),
        ArchivedAt: z.iso.datetime().nullable(),
        PendingPermissions: z.array(z.unknown()),
      })
      .parse(
        await this.command(["inspect", agentId, "--json", "--home", this.settings.daemonHome]),
      );
    if (current.ArchivedAt) return current.ArchivedAt;
    const terminal = ["idle", "closed", "error"].includes(current.Status);
    if (!terminal || current.PendingPermissions.length > 0)
      throw new Error("The agent is not finished; automatic archiving will wait.");
    const result = z
      .object({ status: z.literal("archived"), archivedAt: z.iso.datetime() })
      .parse(
        await this.command(["archive", agentId, "--json", "--home", this.settings.daemonHome]),
      );
    return result.archivedAt;
  }
}
