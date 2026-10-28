import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Inspection, InterfaceEntry } from "../shared/contracts";
import { connectionConfig, type ResolvedServer } from "./discovery";

const TIMEOUT = 20_000;
const MAX_ITEMS = 500;
const MAX_BYTES = 1024 * 1024;

async function childEnvironment(overrides: Record<string, string>) {
  // Resolve an existing parent first: an unavailable external volume must not
  // silently create a replacement directory on the system disk.
  const parent = await realpath(
    process.env.PASEO_MCP_PILLS_DATA_DIR ?? path.join(homedir(), "code"),
  );
  const root = path.join(parent, ".cache", "mcp-pills");
  const directories = {
    tmp: path.join(root, "tmp"),
    cache: path.join(root, "cache"),
    npm: path.join(root, "npm"),
    uv: path.join(root, "uv"),
    pip: path.join(root, "pip"),
  };
  await Promise.all(Object.values(directories).map((dir) => mkdir(dir, { recursive: true })));
  return {
    ...getDefaultEnvironment(),
    ...overrides,
    TMPDIR: directories.tmp,
    TMP: directories.tmp,
    TEMP: directories.tmp,
    XDG_CACHE_HOME: directories.cache,
    npm_config_cache: directories.npm,
    UV_CACHE_DIR: directories.uv,
    PIP_CACHE_DIR: directories.pip,
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

export function safeConnectionError(error: unknown): {
  status: "error" | "auth-required";
  message: string;
} {
  const code =
    (error as { code?: unknown; status?: unknown })?.code ??
    (error as { status?: unknown })?.status;
  const text = error instanceof Error ? error.message : "";
  if (code === 401 || code === 403 || /unauthorized|\b401\b|\b403\b/i.test(text)) {
    return {
      status: "auth-required",
      message:
        "服务要求认证。浏览器支持配置中的请求头与环境变量令牌，暂不复用 provider 的 OAuth 登录。",
    };
  }
  if (/timeout|timed out|abort/i.test(text))
    return { status: "error", message: "连接或接口查询超时，请稍后重试。" };
  if (code === "ENOENT")
    return {
      status: "error",
      message: "找不到启动命令或工作目录。请检查 daemon 的 PATH 与服务配置。",
    };
  // SDK errors may contain request headers, URLs or command arguments.
  return { status: "error", message: "连接失败。请检查服务地址、启动命令、认证配置及网络连接。" };
}

export async function inspect(
  server: ResolvedServer,
  cwd: string,
  signal?: AbortSignal,
): Promise<Inspection> {
  const result: Inspection = {
    status: "error",
    message: "",
    checkedAt: new Date().toISOString(),
    capabilities: {},
    entries: [],
    warnings: [],
  };
  if (server.entry.disabled || server.entry.issue)
    return {
      ...result,
      message: server.entry.disabled ? "此服务已在配置中禁用。" : server.entry.issue!,
    };
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) lifetime.abort();
  const timer = setTimeout(abort, TIMEOUT);
  const options = { signal: lifetime.signal, timeout: 8_000 };
  const client = new Client({ name: "paseo-mcp-pills", version: "0.1.0" }, { capabilities: {} });
  let transport: Transport | undefined;
  let bytes = 0;
  try {
    if (lifetime.signal.aborted) throw new Error("Aborted");
    let config;
    try {
      config = connectionConfig(server, process.env);
    } catch {
      return { ...result, message: "缺少服务需要的环境变量；请在 daemon 环境中配置后重试。" };
    }
    if (server.entry.transport === "stdio") {
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: await childEnvironment(config.env),
        cwd: config.cwd ? path.resolve(cwd, config.cwd) : cwd,
        stderr: "ignore",
        maxBufferSize: 2 * 1024 * 1024,
      });
    } else {
      const url = new URL(config.url);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid URL");
      const requestInit = {
        headers: config.headers,
        signal: lifetime.signal,
        redirect: "error" as const,
      };
      transport =
        server.entry.transport === "sse"
          ? new SSEClientTransport(url, {
              requestInit,
              eventSourceInit: {
                fetch: (input, init) =>
                  fetch(input, {
                    ...init,
                    ...requestInit,
                    headers: { ...init?.headers, ...config.headers },
                  }),
              },
            })
          : new StreamableHTTPClientTransport(url, { requestInit });
    }
    if (lifetime.signal.aborted) throw new Error("Aborted");
    await client.connect(transport, options);
    result.status = "connected";
    result.message = "已连接并读取接口；此结果不代表 agent 已加载或获准使用该服务。";
    const version = client.getServerVersion();
    result.serverName = version?.name;
    result.serverVersion = version?.version;
    result.instructions = client.getInstructions()?.slice(0, 32_000);
    const capabilities = client.getServerCapabilities() ?? {};
    result.capabilities = capabilities;

    async function collect(
      kind: InterfaceEntry["kind"],
      load: (cursor?: string) => Promise<{ items: Record<string, unknown>[]; nextCursor?: string }>,
    ) {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      try {
        for (let page = 0; page < 20; page++) {
          const data = await load(cursor);
          for (const details of data.items) {
            const size = Buffer.byteLength(JSON.stringify(details));
            if (size > 64 * 1024) {
              result.warnings.push(`${kind}：一个接口定义过大，已跳过。`);
              continue;
            }
            if (result.entries.length >= MAX_ITEMS || bytes + size > MAX_BYTES) {
              result.warnings.push("接口清单超过显示上限，结果已截断。");
              return;
            }
            bytes += size;
            const name = String(details.name ?? details.uri ?? details.uriTemplate ?? "未命名接口");
            result.entries.push({
              kind,
              name,
              description: typeof details.description === "string" ? details.description : "",
              configuredDisabled:
                kind === "tool" &&
                (server.entry.disabledTools.includes(name) ||
                  (server.entry.enabledTools !== undefined &&
                    !server.entry.enabledTools.includes(name))),
              details,
            });
          }
          if (!data.nextCursor) return;
          if (cursors.has(data.nextCursor)) {
            result.warnings.push(`${kind}：服务返回重复分页游标，已停止读取。`);
            return;
          }
          cursors.add(data.nextCursor);
          cursor = data.nextCursor;
        }
        result.warnings.push(`${kind}：达到分页上限，结果已截断。`);
      } catch {
        result.warnings.push(`${kind} 接口列表读取失败，其他已读取结果仍可浏览。`);
      }
    }
    if (capabilities.tools)
      await collect("tool", async (cursor) => {
        const data = await client.listTools({ cursor }, options);
        return { items: data.tools, nextCursor: data.nextCursor };
      });
    if (capabilities.resources) {
      await collect("resource", async (cursor) => {
        const data = await client.listResources({ cursor }, options);
        return { items: data.resources, nextCursor: data.nextCursor };
      });
      await collect("template", async (cursor) => {
        const data = await client.listResourceTemplates({ cursor }, options);
        return { items: data.resourceTemplates, nextCursor: data.nextCursor };
      });
    }
    if (capabilities.prompts)
      await collect("prompt", async (cursor) => {
        const data = await client.listPrompts({ cursor }, options);
        return { items: data.prompts, nextCursor: data.nextCursor };
      });
    return result;
  } catch (error) {
    return { ...result, ...safeConnectionError(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await client.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
  }
}
