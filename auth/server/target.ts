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
        "此 provider 使用带参数的自定义启动命令，暂不支持自动登录。请使用官方 CLI 的独立可执行文件。";
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
  if (managedKeys.some((k) => env[k] && env[k] !== "0" && env[k] !== "false"))
    problem =
      "此 provider 使用环境变量或外部服务认证，请在对应配置中更新凭据。网页登录不会替换该配置。";
  if (
    provider === "claude" &&
    env.ANTHROPIC_BASE_URL &&
    env.ANTHROPIC_BASE_URL.replace(/\/$/, "") !== "https://api.anthropic.com"
  )
    problem = "此 provider 使用自定义 API 地址，请更新该服务的凭据。";
  if (
    provider === "codex" &&
    env.OPENAI_BASE_URL &&
    env.OPENAI_BASE_URL.replace(/\/$/, "") !== "https://api.openai.com/v1"
  )
    problem = "此 provider 使用自定义 API 地址，请更新该服务的凭据。";
  if (process.platform === "win32")
    problem = "Auth 第一版支持 macOS / Linux 主机；可从手机或 Web 客户端操作。";
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
      throw new Error("当前会话已不存在或已归档。");
    id = snapshot.agent.provider;
    cwd = snapshot.agent.cwd;
  }
  const base = providerOf(id, config.providers);
  if (base !== input.provider) throw new Error("此会话不使用指定的 Claude / Codex provider。");
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
      target.problem = "未找到官方 CLI。请先在此主机安装对应的 Claude Code / Codex。";
    }
  }
  return target;
}
