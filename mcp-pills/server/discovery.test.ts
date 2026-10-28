import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { discover, normalizeServer, connectionConfig, type DiscoveryRoots } from "./discovery";

let root: string;
let roots: DiscoveryRoots;
async function file(name: string, value: unknown) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === "string" ? value : JSON.stringify(value));
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mcp-discovery-"));
  roots = {
    codexHome: path.join(root, "codex"),
    claudeConfig: path.join(root, ".claude.json"),
    paseoHome: path.join(root, "paseo"),
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("agent-scoped discovery", () => {
  it("merges Codex repository config and gives the saved session the final override", async () => {
    await file("repo/.git", "gitdir: elsewhere");
    await file(
      "codex/config.toml",
      '[mcp_servers.alpha]\nurl="https://example.com/private?token=secret"\n[mcp_servers.beta]\ncommand="node"\nargs=["--token", "secret"]\n',
    );
    await file("repo/.codex/config.toml", "[mcp_servers.alpha]\nenabled=false\n");
    await file("repo/sub/.codex/config.toml", '[mcp_servers.beta]\ndisabled_tools=["write"]\n');
    await file("paseo/agents/repo/agent-a.json", {
      id: "agent-a",
      config: { mcpServers: { alpha: { type: "http", url: "https://session.example/mcp" } } },
    });
    const result = await discover(
      { id: "agent-a", cwd: path.join(root, "repo/sub"), provider: "codex" },
      roots,
    );
    expect(result.servers.map((server) => server.entry.name)).toEqual(["alpha", "beta"]);
    expect(result.servers[0].entry).toMatchObject({
      scope: "session",
      disabled: false,
      endpoint: "https://session.example",
    });
    expect(result.servers[1].entry).toMatchObject({
      scope: "project",
      transport: "stdio",
      endpoint: "node",
      disabledTools: ["write"],
    });
    expect(JSON.stringify(result.servers.map((server) => server.entry))).not.toContain("secret");
  });
  it("applies Claude local scope over project and user configuration", async () => {
    const cwd = path.join(root, "repo");
    await file(".claude.json", {
      mcpServers: { same: { command: "user" }, global: { command: "global" } },
      projects: {
        [cwd]: { mcpServers: { same: { command: "local" } }, disabledMcpServers: ["global"] },
      },
    });
    await file("repo/.mcp.json", {
      mcpServers: { same: { command: "project" }, project: { type: "http", url: "${BASE}/mcp" } },
    });
    const result = await discover({ id: "agent-a", cwd, provider: "claude" }, roots);
    expect(result.servers.find((s) => s.entry.name === "same")?.entry.endpoint).toBe("local");
    expect(result.servers.find((s) => s.entry.name === "global")?.entry.disabled).toBe(true);
    expect(result.servers.find((s) => s.entry.name === "project")?.entry.issue).toBeUndefined();
  });
  it("isolates agents and reports malformed files without leaking their contents", async () => {
    await file("paseo/agents/repo/agent-b.json", {
      id: "agent-b",
      config: { mcpServers: { private: { command: "private" } } },
    });
    await file("codex/config.toml", 'token = "private-value" invalid');
    const result = await discover({ id: "agent-a", cwd: root, provider: "codex" }, roots);
    expect(result.servers).toEqual([]);
    expect(result.warnings.join(" ")).toContain("无法读取配置");
    expect(result.warnings.join(" ")).not.toContain("private-value");
    await expect(
      discover({ id: "../agent-b", cwd: root, provider: "unknown" }, roots),
    ).rejects.toThrow("无效");
  });
});

describe("connection-only credential handling", () => {
  it("keeps configuration secrets off the public entry and expands explicit environment references", () => {
    const server = normalizeServer(
      "remote",
      {
        url: "https://user:password@example.com/secret?token=secret",
        http_headers: { "X-Key": "secret" },
        env_http_headers: { "X-Env": "KEY" },
        bearer_token_env_var: "TOKEN",
        enabled_tools: [],
        disabled_tools: ["write"],
      },
      "config",
      "user",
    );
    expect(JSON.stringify(server.entry)).not.toMatch(/password|secret|TOKEN|KEY/);
    const config = connectionConfig(server, { KEY: "key-value", TOKEN: "token-value" });
    expect(config.headers).toEqual({
      "X-Key": "secret",
      "X-Env": "key-value",
      Authorization: "Bearer token-value",
    });
    expect(server.entry.enabledTools).toEqual([]);
    expect(() => connectionConfig(server, {})).toThrow("缺少");
  });
  it("expands Claude defaults without executing shell interpolation", () => {
    const server = normalizeServer(
      "local",
      {
        command: "${CMD:-node}",
        args: ["${VALUE}", "$(touch never)"],
        env: { KEY: "${TOKEN:-fallback}" },
      },
      "config",
      "project",
      true,
    );
    expect(connectionConfig(server, { VALUE: "literal" })).toMatchObject({
      command: "node",
      args: ["literal", "$(touch never)"],
      env: { KEY: "fallback" },
    });
  });
});
