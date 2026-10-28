# MCP Pills

An MCP configuration and interface browser for Paseo. Adds an **MCP** composer pill and an agent-scoped workspace panel. The pill count is the number of discovered configurations, not the number of live connections.

## Install

Requires Paseo **>=0.13.0** in both the daemon and app, and Node.js >=22.

```sh
npm ci --ignore-scripts
paseo plugin install /absolute/path/to/mcp-pills
```

Open the MCP pill beside the composer, or choose **MCP 配置与接口浏览器** in the Command Center. Select a service and press **连接并浏览接口**. Expand individual entries to inspect descriptions, input/output schemas, annotations, resource URIs and prompt arguments. Search and category filters work on the returned definitions. The expand icon in the header opens a larger tab view. Configuration scope and limitations are collapsed below the compact service list.

## Discovery

| Provider    | Files read, low to high precedence                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Codex       | `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`), repository-root-to-cwd `.codex/config.toml` files      |
| Claude Code | `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`), cwd `.mcp.json`, that cwd's local entry in `.claude.json` |
| All         | The selected agent's saved `config.mcpServers` under `$PASEO_HOME/agents` (default `~/.paseo/agents`)              |

Codex fields merge by server name across project levels; Claude and saved session entries replace lower-scope entries with the same name. Claude's project `disabledMcpServers` is respected. Codex `enabled`, `enabled_tools` and `disabled_tools` are displayed. Environment references are resolved on the daemon at connection time, including Claude `${VAR}` / `${VAR:-default}` and Codex bearer/header environment settings.

These are configuration candidates. The plugin does not query the agent's running provider process or change Paseo APIs. Project trust/approval, CLI overrides, active profiles, managed policy, runtime injection, provider plugins and cloud connectors are not resolved. Other providers show saved Paseo configuration only. Discovery warnings and empty/error states are shown explicitly.

## Connections and data

HTTP, SSE and stdio are supported. No connection starts just by opening the pill. Clicking the connection button starts a separate MCP client; stdio runs the configured command in its configured cwd or the agent's cwd. Only initialization and list requests are sent. No tools, resource bodies or prompt content are executed/read. Connections are closed after inspection and plugin teardown aborts pending inspections.

The UI receives names, origins (without URL paths, userinfo or query strings), sources and configuration flags, plus the interface definitions returned by the server. It never receives raw startup arguments, header values or environment values from configuration. Raw connection errors are replaced with safe messages. Server-supplied definitions themselves may contain sensitive information supplied by that server.

OAuth sessions from the coding provider are not reused; services requiring OAuth may show **需要认证**. Dynamic header helper commands and unsupported transports are not executed. No automatic HTTP-to-SSE fallback is attempted: use the transport declared in the configuration.

Inspection times out after 20 seconds, paginates each interface category up to 20 pages, and bounds the total result to 500 entries / 1 MiB. Oversized definitions (over 64 KiB), partial failures and truncation are reported. Results remain in the current app's in-memory query cache; use refresh to query again.

## Storage and development

The plugin does not persist inspection results. Before running stdio, it resolves an existing `~/code` directory (or `PASEO_MCP_PILLS_DATA_DIR`) and places temporary files and npm/uv/pip/XDG caches under `.cache/mcp-pills` there. Missing or unavailable storage stops the launch. This redirects common caches; a third-party server can still choose its own output locations.

On this development machine, `~/code` and `~/.paseo` resolve to the mounted SSD. Keep package installation, test output and caches on that volume:

```sh
df -P ~/code
mkdir -p .cache/tmp .cache/npm
export TMPDIR="$PWD/.cache/tmp"
export npm_config_cache="$PWD/.cache/npm"
export XDG_CACHE_HOME="$PWD/.cache"
npm run typecheck
npm run lint
npm run format:check
npm test -- server/discovery.test.ts server/inspect.test.ts client/filter.test.ts client/pills.test.ts
paseo plugin reload mcp-pills
```

Configuration references: [Codex](https://developers.openai.com/codex/config-reference), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Paseo composer pills](https://paseo.sh/docs/plugins/reference#composer-pills).
