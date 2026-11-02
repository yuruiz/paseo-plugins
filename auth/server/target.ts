import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Provider, Scope } from "../shared/contracts";

export interface Target {
  key: string;
  provider: Provider;
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  problem?: string;
  missing?: boolean;
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function envMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object(value)).filter((v): v is [string, string] => typeof v[1] === "string"),
  );
}
export function providerOf(id: string, providers: Record<string, unknown>): Provider | undefined {
  if (id === "claude" || id === "codex") return id;
  const parent = object(providers[id]).extends;
  return parent === "claude" || parent === "codex" ? parent : undefined;
}
export function makeTarget(
  provider: Provider,
  cwd: string,
  config: Record<string, unknown>,
  baseEnv: NodeJS.ProcessEnv,
): Target {
  const env = { ...baseEnv, ...envMap(config.env) };
  for (const key of [
    "ELECTRON_RUN_AS_NODE",
    "ELECTRON_NO_ATTACH_CONSOLE",
    "ESBUILD_BINARY_PATH",
    "NODE_OPTIONS",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "PASEO_AGENT_ID",
    "PASEO_NODE_ENV",
    "PASEO_DESKTOP_MANAGED",
    "PASEO_SUPERVISED",
  ])
    delete env[key];
  const configured = config.command;
  let problem: string | undefined;
  let command: string = provider;
  if (configured !== undefined) {
    if (
      Array.isArray(configured) &&
      configured.length === 1 &&
      typeof configured[0] === "string" &&
      configured[0]
    )
      command = configured[0];
    else
      problem =
        "This provider uses a custom launch command with arguments, which Auth does not yet support. Use the official CLI executable directly.";
  }
  const managedKeys =
    provider === "claude"
      ? [
          "ANTHROPIC_API_KEY",
          "ANTHROPIC_AUTH_TOKEN",
          "CLAUDE_CODE_OAUTH_TOKEN",
          "CLAUDE_CODE_USE_BEDROCK",
          "CLAUDE_CODE_USE_VERTEX",
          "CLAUDE_CODE_USE_FOUNDRY",
        ]
      : [
          "OPENAI_API_KEY",
          "CODEX_API_KEY",
          "CODEX_ACCESS_TOKEN",
          "OPENAI_IDENTITY_TOKEN_FILE",
          "OPENAI_IDENTITY_PROVIDER_ID",
        ];
  const managed = managedKeys.filter((key) => env[key] && env[key] !== "0" && env[key] !== "false");
  if (managed.length) {
    const reason =
      "Detected authentication environment variables: " +
      managed.join(", ") +
      ". Update the credentials in the provider configuration. Browser sign-in does not replace them.";
    problem = problem ? problem + " " + reason : reason;
  }
  if (
    provider === "claude" &&
    env.ANTHROPIC_BASE_URL &&
    env.ANTHROPIC_BASE_URL.replace(/\/$/, "") !== "https://api.anthropic.com"
  )
    problem = "This provider uses a custom API endpoint. Update the credentials for that service.";
  if (
    provider === "codex" &&
    env.OPENAI_BASE_URL &&
    env.OPENAI_BASE_URL.replace(/\/$/, "") !== "https://api.openai.com/v1"
  )
    problem = "This provider uses a custom API endpoint. Update the credentials for that service.";
  if (process.platform === "win32")
    problem =
      "Auth currently supports macOS and Linux hosts. You can use it from mobile or web clients.";
  // Hash auth-relevant launch inputs, never expose them to the client. Separate homes must not share a login.
  const identity = Object.fromEntries(
    Object.entries(env)
      .filter(([k]) =>
        /^(HOME|USERPROFILE|XDG_CONFIG_HOME|CODEX_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(k),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const key = createHash("sha256")
    .update(JSON.stringify([provider, command, identity]))
    .digest("hex");
  return { key, provider, command, cwd, env, problem };
}
export async function resolveTarget(
  input: Scope,
  { paseo }: PluginHandlerContext,
): Promise<Target> {
  const { config } = await paseo.config.get();
  let id: string = input.provider;
  let cwd = homedir();
  if (input.agentId) {
    const snapshot = await paseo.agents.ref(input.agentId).refresh();
    if (!snapshot?.agent || snapshot.agent.archivedAt)
      throw new Error("The current session no longer exists or has been archived.");
    id = snapshot.agent.provider;
    cwd = snapshot.agent.cwd;
  }
  const base = providerOf(id, config.providers);
  if (base !== input.provider)
    throw new Error("This session does not use the selected Claude / Codex provider.");
  const original = object(config.providers[base]);
  const custom = object(config.providers[id]);
  const merged = {
    ...original,
    ...custom,
    env: { ...envMap(original.env), ...envMap(custom.env) },
  };
  const target = makeTarget(base, cwd, merged, process.env);
  if (!target.problem) {
    const candidates = path.isAbsolute(target.command)
      ? [target.command]
      : (target.env.PATH ?? "")
          .split(path.delimiter)
          .filter((p) => path.isAbsolute(p))
          .map((p) => path.join(p, target.command));
    let found: string | undefined;
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        found = candidate;
        break;
      } catch {
        /* Try next PATH entry. */
      }
    }
    if (found) target.command = found;
    else {
      target.missing = true;
      target.problem = "Official CLI not found. Install Claude Code or Codex on this host first.";
    }
  }
  return target;
}
