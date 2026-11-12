import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { jobSchema, stateSchema } from "../shared/model";
import { ConfigurationError, LaunchConfigurations, resolveAgentConfig } from "./agent-config";

const job = jobSchema.parse({
  id: "b7d67365-15aa-4a69-a664-3825bdd00e99",
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  cursor: "2026-01-01T00:00:00.000Z",
  error: null,
  name: "Report",
  prompt: "Write report",
  provider: "codex/old",
  cwd: "/work",
  mode: "old-mode",
  thinking: "low",
  enabled: false,
  missed: "skip",
  rule: {
    calendarId: "civil",
    timezone: "Asia/Shanghai",
    recurrence: { kind: "daily" },
    adjustment: "skip",
    withinMonth: true,
    time: { kind: "fixed", at: "09:00" },
  },
});
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function home(profiles: unknown[]) {
  const directory = await mkdtemp(join(tmpdir(), "scheduler-profiles-"));
  directories.push(directory);
  await writeFile(
    join(directory, "config.json"),
    JSON.stringify({ daemon: { agentProfiles: profiles } }),
  );
  return directory;
}

describe("agent configuration resolution", () => {
  it("loads legacy jobs as custom and adds no shared default", () => {
    expect(job.agentConfigSource).toBe("custom");
    expect(job.profileId).toBe("");
    expect(
      stateSchema.parse({ version: 1, revision: 0, jobs: [job], calendars: [], runs: [] })
        .agentDefaults,
    ).toBeNull();
  });
  it("keeps per-job overrides and resolves shared custom settings without leaking old options", async () => {
    const defaults = {
      source: "custom" as const,
      provider: "claude/model/alias",
      mode: "",
      thinking: "",
    };
    expect(await resolveAgentConfig(job, defaults, "/unused")).toEqual({
      provider: "codex",
      model: "old",
      modeId: "old-mode",
      thinkingOptionId: "low",
    });
    expect(
      await resolveAgentConfig({ ...job, agentConfigSource: "default" }, defaults, "/unused"),
    ).toEqual({
      provider: "claude",
      model: "model/alias",
      modeId: undefined,
      thinkingOptionId: undefined,
    });
    await expect(
      resolveAgentConfig({ ...job, agentConfigSource: "default" }, null, "/unused"),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
  it("reads the latest profile by stable ID, including all feature values", async () => {
    const profile = {
      id: "personal",
      name: "Original",
      provider: "claudex",
      model: "model",
      modeId: "bypassPermissions",
      thinkingOptionId: "xhigh",
      featureValues: { fast: true, options: { budget: 42 } },
    };
    const directory = await home([profile]);
    const direct = { ...job, agentConfigSource: "profile" as const, profileId: "personal" };
    expect(await resolveAgentConfig(direct, null, directory)).toEqual({
      provider: "claudex",
      model: "model",
      modeId: "bypassPermissions",
      thinkingOptionId: "xhigh",
      featureValues: profile.featureValues,
    });
    await writeFile(
      join(directory, "config.json"),
      JSON.stringify({
        daemon: { agentProfiles: [{ id: "personal", name: "Renamed", provider: "claude" }] },
      }),
    );
    expect(
      await resolveAgentConfig(
        { ...job, agentConfigSource: "default" },
        { source: "profile", profileId: "personal" },
        directory,
      ),
    ).toEqual({ provider: "claude" });
  });
  it("fails explicitly for removed or invalid profiles and unreadable config", async () => {
    const directory = await home([]);
    const direct = { ...job, agentConfigSource: "profile" as const, profileId: "gone" };
    await expect(resolveAgentConfig(direct, null, directory)).rejects.toThrow(
      "missing or ambiguous",
    );
    await writeFile(
      join(directory, "config.json"),
      JSON.stringify({ daemon: { agentProfiles: [{ id: "gone", provider: "" }] } }),
    );
    await expect(resolveAgentConfig(direct, null, directory)).rejects.toThrow("invalid settings");
    await writeFile(join(directory, "config.json"), "{ invalid secret content");
    await expect(resolveAgentConfig(direct, null, directory)).rejects.toThrow(
      "Cannot read Paseo agent profiles",
    );
  });
  it("applies complete profiles only to this instance's pending launches and removes the marker", () => {
    const configurations = new LaunchConfigurations();
    const otherInstance = new LaunchConfigurations();
    const config = {
      provider: "claudex",
      model: "new",
      modeId: "bypassPermissions",
      thinkingOptionId: "xhigh",
      featureValues: { fast: true },
    };
    const release = configurations.register("run", config);
    const request = {
      config: { provider: "codex", cwd: "/work", model: "old", featureValues: { old: true } },
      env: { KEEP: "yes", [configurations.environmentKey]: "run" },
    };
    expect(otherInstance.apply(request)).toBeUndefined();
    expect(configurations.apply({ ...request, env: {} })).toBeUndefined();
    expect(configurations.apply(request)).toEqual({
      config: { cwd: "/work", ...config },
      env: { KEEP: "yes" },
    });
    expect(() => configurations.apply(request)).toThrow("expired");
    release();
    const cancel = configurations.register("canceled", config);
    cancel();
    expect(() =>
      configurations.apply({ ...request, env: { [configurations.environmentKey]: "canceled" } }),
    ).toThrow("expired");
  });
});
