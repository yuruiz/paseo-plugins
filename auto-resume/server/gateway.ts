import type { PaseoApi } from "@getpaseo/client";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { z } from "zod";
import { CONTINUE_PROMPT, type Job } from "../shared/contracts";

export interface Observation {
  provider: string;
  status: string;
  archived: boolean;
  permissions: boolean;
  lastUserMessageAt: string | null;
  transcriptHash?: string;
}
export interface Gateway {
  inspect(id: string): Promise<Observation>;
  captureTranscript(id: string): Promise<string>;
  send(job: Job): Promise<void>;
  publish(job: Job): Promise<void>;
}
const inspectSchema = z.object({
  Id: z.string(),
  Provider: z.string(),
  Status: z.string(),
  Archived: z.boolean(),
  PendingPermissions: z.array(z.unknown()),
});

/** Reuse the plugin's SDK. Before its first callback after restart, use the public local CLI. */
export class PaseoGateway implements Gateway {
  private api?: PaseoApi;
  private cli: string;
  constructor(
    private home: string,
    private temporary: string,
    private signal: AbortSignal,
  ) {
    const bundled = "/Applications/Paseo.app/Contents/Resources/bin/paseo";
    this.cli = process.env.AUTO_RESUME_PASEO_BIN || (existsSync(bundled) ? bundled : "paseo");
  }
  attach(api: PaseoApi) {
    this.api = api;
  }
  private command(args: string[]): Promise<string> {
    const env = {
      ...process.env,
      PASEO_HOME: this.home,
      TMPDIR: this.temporary,
      TMP: this.temporary,
      TEMP: this.temporary,
    };
    for (const key of ["PASEO_AGENT_ID", "PASEO_WORKSPACE_ID", "PASEO_HOST"])
      delete env[key as keyof typeof env];
    return new Promise((resolve, reject) => {
      execFile(
        this.cli,
        ["--home", this.home, "--no-color", ...args],
        {
          env,
          timeout: 25000,
          maxBuffer: 8 * 1024 * 1024,
          signal: this.signal,
          encoding: "utf8",
          windowsHide: true,
        },
        (error, stdout) => {
          if (error)
            reject(new Error(`Paseo ${args[0]} failed (${error.code ?? "connection error"})`));
          else resolve(stdout);
        },
      );
    });
  }
  async inspect(id: string): Promise<Observation> {
    if (this.api) {
      const result = await this.api.agents.ref(id).refresh();
      if (!result) throw new Error("Conversation no longer exists");
      const a = result.agent;
      return {
        provider: a.provider,
        status: a.activeTurn ? "running" : a.status,
        archived: !!a.archivedAt,
        permissions: a.pendingPermissions.length > 0,
        lastUserMessageAt: a.lastUserMessageAt,
      };
    }
    const raw: unknown = JSON.parse(await this.command(["inspect", id, "--json"]));
    const a = inspectSchema.parse(Array.isArray(raw) ? raw[0] : raw);
    if (a.Id !== id) throw new Error("Unexpected conversation returned by Paseo");
    return {
      provider: a.Provider,
      status: a.Status,
      archived: a.Archived,
      permissions: a.PendingPermissions.length > 0,
      lastUserMessageAt: null,
      transcriptHash: await this.captureTranscript(id),
    };
  }
  async captureTranscript(id: string): Promise<string> {
    // The CLI's text projection excludes plugin rows. Hash the complete transcript so
    // repeated identical prompts still invalidate a pending job. Never persist the text.
    const text = await this.command(["logs", id, "--filter", "text"]);
    return createHash("sha256").update(text).digest("hex");
  }
  async send(job: Job): Promise<void> {
    if (this.signal.aborted) throw new Error("Auto-resume is stopping");
    if (this.api)
      await this.api.agents.ref(job.agentId).send(CONTINUE_PROMPT, {
        messageId: `auto-resume-${job.id}-${job.attempts}`,
        activeTurnBehavior: "steer",
      });
    else
      await this.command([
        "send",
        job.agentId,
        "--no-wait",
        "--behavior",
        "steer",
        "--",
        CONTINUE_PROMPT,
      ]);
  }
  async publish(job: Job): Promise<void> {
    if (!this.api) return; // The persisted job is also available through the pill after reconnect.
    await this.api.agents.ref(job.agentId).timeline.append({
      type: "plugin",
      id: "quota-resume",
      kind: "quota-resume",
      version: 1,
      data: { jobId: job.id },
    });
  }
}
