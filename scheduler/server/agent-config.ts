import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { AgentConfig } from "../shared/agent-config";
import type { Job } from "../shared/model";

export class ConfigurationError extends Error {}

const profileSchema = z.object({
  id: z.string(),
  provider: z.string().trim().min(1),
  model: z.string().optional(),
  modeId: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
});
export interface ResolvedAgentConfig {
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

export async function resolveAgentConfig(
  job: Job,
  defaults: AgentConfig | null,
  daemonHome: string,
): Promise<ResolvedAgentConfig> {
  const config: AgentConfig | null =
    job.agentConfigSource === "default"
      ? defaults
      : job.agentConfigSource === "profile"
        ? { source: "profile", profileId: job.profileId }
        : { source: "custom", provider: job.provider, mode: job.mode, thinking: job.thinking };
  if (!config) throw new ConfigurationError("Save a shared agent configuration in Settings first");
  if (config.source === "custom") {
    const slash = config.provider.indexOf("/");
    return {
      provider: slash < 0 ? config.provider : config.provider.slice(0, slash),
      model: slash < 0 ? undefined : config.provider.slice(slash + 1),
      modeId: config.mode || undefined,
      thinkingOptionId: config.thinking || undefined,
    };
  }
  // Timers have no PluginHandlerContext. Read only the selected profile from the
  // configured daemon's persisted config; never cache a full config or log it.
  try {
    const configFile = z
      .object({
        daemon: z
          .object({ agentProfiles: z.array(z.unknown()).default([]) })
          .default({ agentProfiles: [] }),
      })
      .parse(JSON.parse(await readFile(join(daemonHome, "config.json"), "utf8")));
    const matches = configFile.daemon.agentProfiles.filter(
      (profile) =>
        typeof profile === "object" &&
        profile !== null &&
        "id" in profile &&
        profile.id === config.profileId,
    );
    if (matches.length !== 1)
      throw new ConfigurationError(
        `Paseo agent profile "${config.profileId}" is missing or ambiguous. Choose another profile in Settings or edit this schedule.`,
      );
    const parsed = profileSchema.safeParse(matches[0]);
    if (!parsed.success)
      throw new ConfigurationError(
        `Paseo agent profile "${config.profileId}" has invalid settings`,
      );
    const { id: _id, ...profile } = parsed.data;
    return profile;
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(
      "Cannot read Paseo agent profiles from the configured daemon home. Check config.json and file permissions.",
    );
  }
}

// CLI run has no featureValues flag. Carry the resolved bundle through a
// one-use creation hook, scoped to this plugin instance and its own submissions.
export class LaunchConfigurations {
  readonly environmentKey = `PASEO_SCHEDULER_CONFIG_${randomUUID().replaceAll("-", "")}`;
  private pending = new Map<string, ResolvedAgentConfig>();

  register(runId: string, config: ResolvedAgentConfig): () => void {
    this.pending.set(runId, config);
    return () => {
      this.pending.delete(runId);
    };
  }

  apply(
    request: PluginBeforeRequests["agent.create"],
  ): PluginBeforeRequests["agent.create"] | undefined {
    const runId = request.env?.[this.environmentKey];
    if (!runId) return;
    const config = this.pending.get(runId);
    if (!config)
      throw new Error("Scheduler launch configuration expired; review the run before retrying");
    this.pending.delete(runId);
    const env = { ...request.env };
    delete env[this.environmentKey];
    return {
      ...request,
      env,
      config: {
        ...request.config,
        provider: config.provider,
        model: config.model,
        modeId: config.modeId,
        thinkingOptionId: config.thinkingOptionId,
        featureValues: config.featureValues,
      },
    };
  }
}
