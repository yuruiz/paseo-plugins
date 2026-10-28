import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import type { ServerEntry } from "../shared/contracts";

type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
export interface ResolvedServer {
  entry: ServerEntry;
  raw: ObjectValue;
  expandEnv: boolean;
}
export interface DiscoveryRoots {
  codexHome: string;
  claudeConfig: string;
  paseoHome: string;
}
export function defaultRoots(): DiscoveryRoots {
  const home = homedir();
  const expand = (value: string) =>
    value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
  return {
    codexHome: expand(process.env.CODEX_HOME ?? path.join(home, ".codex")),
    claudeConfig: path.join(expand(process.env.CLAUDE_CONFIG_DIR ?? home), ".claude.json"),
    paseoHome: expand(process.env.PASEO_HOME ?? path.join(home, ".paseo")),
  };
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeServer(
  name: string,
  raw: ObjectValue,
  source: string,
  scope: ServerEntry["scope"],
  expandEnv = false,
): ResolvedServer {
  const transport =
    raw.type === "sse"
      ? "sse"
      : raw.type === "http" || (!raw.type && typeof raw.url === "string")
        ? "http"
        : raw.type === "stdio" || (!raw.type && typeof raw.command === "string")
          ? "stdio"
          : "unsupported";
  let endpoint =
    transport === "stdio" && typeof raw.command === "string" ? path.basename(raw.command) : "";
  let issue: string | undefined;
  if (transport === "unsupported") issue = "不支持此传输类型。";
  else if (transport === "stdio" && (typeof raw.command !== "string" || !raw.command.trim()))
    issue = "缺少启动命令。";
  else if (transport !== "stdio") {
    try {
      const url = new URL(String(raw.url));
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      // Deliberately omit credentials, path, query and fragment from the client.
      endpoint = url.origin;
    } catch {
      if (expandEnv && typeof raw.url === "string" && raw.url.includes("${"))
        endpoint = "环境变量地址";
      else issue = "服务地址无效。";
    }
  }
  if (raw.headersHelper) issue = "此服务使用动态认证脚本，浏览器暂不执行此脚本。";
  return {
    raw,
    expandEnv,
    entry: {
      id: digest(`${scope}\0${source}\0${name}`),
      revision: digest(JSON.stringify(raw)),
      name,
      source,
      scope,
      transport,
      endpoint,
      disabled: raw.enabled === false || raw.disabled === true,
      ...(issue ? { issue } : {}),
      ...(Array.isArray(raw.enabled_tools) ? { enabledTools: strings(raw.enabled_tools) } : {}),
      disabledTools: strings(raw.disabled_tools),
    },
  };
}

async function readConfig(file: string, warnings: string[]): Promise<ObjectValue> {
  try {
    const info = await stat(file);
    if (info.size > 2 * 1024 * 1024) throw new Error("size");
    const text = await readFile(file, "utf8");
    return object(file.endsWith(".toml") ? parse(text) : JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      warnings.push(`无法读取配置：${file}（格式无效、文件过大或无访问权限）。`);
    return {};
  }
}

async function projectDirs(cwd: string) {
  const dirs = [path.resolve(cwd)];
  let current = dirs[0];
  for (let i = 0; i < 64; i++) {
    try {
      await stat(path.join(current, ".git"));
      return dirs.reverse();
    } catch {
      /* Walk to repository root. */
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    dirs.push(parent);
    current = parent;
  }
  return [path.resolve(cwd)];
}

async function savedAgent(agentId: string, root: string, warnings: string[]) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(agentId)) throw new Error("无效的 agent ID。");
  const dir = path.join(root, "agents");
  let folders;
  try {
    folders = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      warnings.push("无法读取 Paseo 保存的会话配置。");
    return {};
  }
  const candidates = [
    path.join(dir, `${agentId}.json`),
    ...folders.filter((f) => f.isDirectory()).map((f) => path.join(dir, f.name, `${agentId}.json`)),
  ];
  for (const file of candidates) {
    const record = await readConfig(file, warnings);
    if (record.id === agentId) return record;
  }
  return {};
}

export async function discover(
  agent: { id: string; cwd: string; provider: string },
  roots = defaultRoots(),
) {
  const warnings: string[] = [];
  const found = new Map<string, ResolvedServer>();
  function add(
    config: unknown,
    source: string,
    scope: ServerEntry["scope"],
    expandEnv = false,
    merge = false,
  ) {
    for (const [name, value] of Object.entries(object(config))) {
      const raw = merge ? { ...found.get(name)?.raw, ...object(value) } : object(value);
      found.set(name, normalizeServer(name, raw, source, scope, expandEnv));
    }
  }
  if (agent.provider === "codex") {
    const file = path.join(roots.codexHome, "config.toml");
    add((await readConfig(file, warnings)).mcp_servers, file, "user");
    for (const dir of await projectDirs(agent.cwd)) {
      const project = path.join(dir, ".codex", "config.toml");
      if (project !== file)
        add((await readConfig(project, warnings)).mcp_servers, project, "project", false, true);
    }
    warnings.push(
      "Codex 项目配置按目录层级合并；未验证项目信任状态、命令行覆盖、配置 profile 或托管策略。",
    );
  } else if (agent.provider === "claude") {
    const user = await readConfig(roots.claudeConfig, warnings);
    add(user.mcpServers, roots.claudeConfig, "user", true);
    const file = path.join(agent.cwd, ".mcp.json");
    add((await readConfig(file, warnings)).mcpServers, file, "project", true);
    const local = object(object(user.projects)[agent.cwd]);
    add(local.mcpServers, `${roots.claudeConfig} · ${agent.cwd}`, "project", true);
    const settings = [
      local,
      await readConfig(path.join(agent.cwd, ".claude", "settings.json"), warnings),
      await readConfig(path.join(agent.cwd, ".claude", "settings.local.json"), warnings),
    ];
    for (const setting of settings)
      for (const name of strings(setting.disabledMcpServers)) {
        const server = found.get(name);
        if (server) {
          server.raw.disabled = true;
          server.entry.disabled = true;
          server.entry.revision = digest(JSON.stringify(server.raw));
        }
      }
    warnings.push("未读取 Claude 托管策略、插件或云端连接器；项目批准状态与当前会话加载状态未知。");
  } else warnings.push(`暂不扫描 ${agent.provider} 的原生配置，仅展示 Paseo 保存的会话配置。`);
  const record = await savedAgent(agent.id, roots.paseoHome, warnings);
  add(object(record.config).mcpServers, "Paseo · 保存的 agent 配置", "session");
  return {
    servers: [...found.values()].sort((a, b) => a.entry.name.localeCompare(b.entry.name)),
    warnings,
  };
}

/** Resolve credential references on the daemon; values never leave this module. */
export function connectionConfig(server: ResolvedServer, env: NodeJS.ProcessEnv) {
  const missing = new Set<string>();
  function expand(value: string): string {
    if (!server.expandEnv) return value;
    return value.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
      (_, key: string, fallback?: string) => {
        const resolved = env[key] ?? fallback;
        if (resolved === undefined) missing.add(key);
        return resolved ?? "";
      },
    );
  }
  const raw = server.raw;
  const headers = Object.fromEntries(
    Object.entries(stringMap(raw.http_headers ?? raw.headers)).map(([key, value]) => [
      key,
      expand(value),
    ]),
  );
  for (const [header, key] of Object.entries(stringMap(raw.env_http_headers))) {
    if (env[key] === undefined) missing.add(key);
    else headers[header] = env[key]!;
  }
  if (typeof raw.bearer_token_env_var === "string") {
    if (!env[raw.bearer_token_env_var]) missing.add(raw.bearer_token_env_var);
    else headers.Authorization = `Bearer ${env[raw.bearer_token_env_var]}`;
  }
  const resolved = {
    command: expand(typeof raw.command === "string" ? raw.command : ""),
    args: strings(raw.args).map(expand),
    url: expand(typeof raw.url === "string" ? raw.url : ""),
    headers,
    env: Object.fromEntries(
      Object.entries(stringMap(raw.env)).map(([key, value]) => [key, expand(value)]),
    ),
    cwd: typeof raw.cwd === "string" ? expand(raw.cwd) : undefined,
  };
  for (const key of strings(raw.env_vars)) {
    if (env[key] !== undefined) resolved.env[key] = env[key]!;
  }
  if (missing.size) throw new Error("缺少服务需要的环境变量；请在 daemon 环境中配置后重试。");
  return resolved;
}
