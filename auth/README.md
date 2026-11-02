# Auth

Log in to Claude Code and Codex from a Paseo conversation. Authentication errors produce an inline card; open the official authorization page in your browser, then return to the card for progress and session recovery. No external terminal is needed.

## Requirements and installation

- Paseo **0.14.x** on the daemon and client.
- A macOS or Linux daemon with the official `claude` or `codex` CLI on its PATH. Desktop, web, iOS and Android clients are supported.
- Claude CLI with `auth login` and JSON `auth status`; Codex CLI with `login --device-auth` and `login status`.
- Codex device code login must be enabled in ChatGPT security settings or allowed by the workspace administrator.

```sh
paseo plugin add git:yuruiz/paseo-plugins:auth
# Local development, from the repository root:
paseo plugin install "$PWD/auth"
```

Install on the daemon that runs your agents. The sidebar screen's host picker selects which machine receives the login. Creating/building this package does not install it or change existing logins.

## Use

- A recognized provider authentication failure adds one **Auth card** to the current conversation. Repeated errors update the same row.
- Type `/auth`, or choose **在当前对话登录** in Command Center, to show the card manually.
- **账号登录** in the sidebar and **管理 Claude / Codex 登录** in Command Center provide host-level manual login.
- Click **重新登录**. For Codex, copy the device code and enter it on the authorization website. For Claude, open the website and paste its authorization code into the card if prompted.
- The card updates when the CLI exits successfully and its status command confirms saved credentials. Switching pages does not stop login; **取消登录** does. Sessions expire after ten minutes.
- After login, click **重新加载当前会话**, then **继续任务** if desired. Reload restarts only that provider session and preserves conversation history. Running turns and pending permission requests block recovery. Continue sends a new instruction to inspect completed work and resume; it does not blindly replay the previous prompt.

## Scope and limitations

The plugin uses the daemon's environment plus the selected provider's `env` overrides. It supports built-in Claude/Codex and custom provider entries extending them, including separate `CODEX_HOME` / `CLAUDE_CONFIG_DIR` values and a single configured executable. Opaque command wrappers with arguments are not supported. Other plugins' per-session environment injections and per-agent credential overrides are not exposed by the SDK and are not resolved by Auth; use host/provider configuration for accounts managed here.

Environment-managed API keys/tokens, cloud-provider authentication, and custom API endpoints are not replaced by browser login. Such detected configurations show an explanation instead of starting login. Provider-specific settings files can also select other authentication mechanisms; those are owned by the CLI. This first version handles account OAuth login, not MCP server OAuth or arbitrary third-party providers.

Automatic detection uses failed-turn error codes/messages and error snapshots in the agent directory, not model replies or tool output. Startup failures are picked up while a client is connected. Unrecognized failures can always use `/auth`. Rate limits, generic 403 responses and network failures are not classified as expired login. `检查状态` checks locally recognized credentials; it is not an authenticated API health check and does not prove an existing token is still valid.

Paseo 0.14's published SDK still exposes `server.on("agent.turn_ended")`; this plugin uses that installed contract. Newer documentation also describes a renamed `addHook` API. Compatibility is pinned to 0.14.x until that migration is verified.

## Data and lifecycle

- Official CLIs own credential storage and refresh. Auth does not read token files, implement OAuth exchanges, log CLI output, or copy tokens into conversation history.
- Authorization URLs, device codes and progress are delivered by host-scoped plugin RPC. They live in bounded server memory and the mounted UI only. Timeline rows contain only provider and reason. Terminal states clear URLs/codes; plugin shutdown kills owned processes and clears memory.
- Pasted authorization codes go directly to the waiting CLI's stdin; they are cleared from the input and are never sent as agent messages.
- Only allowlisted HTTPS authorization URLs from official Claude/OpenAI domains become clickable links. Starting login does not launch a browser on the daemon.
- Users connected to the same trusted Paseo host share login state for the same credential scope. Multiple clicks reuse an active login. A different credential directory gets a different login session. This is not per-client account isolation.
- Auth does not persist its own state or logs. CLI-owned credential files, logs and temporary files follow the CLI/daemon environment. On machines requiring external storage, configure credential homes, temporary paths and caches on that storage before logging in.

## Development

From the repository root, configure `TMPDIR`, `npm_config_cache` and `XDG_CACHE_HOME` to verified SSD directories before installing dependencies or running checks.

```sh
npm run setup -- auth
npm run check -- auth
npm --prefix auth test
```

The tests cover output parsing, URL allowlists, provider-error classification, credential scopes, concurrent starts, stale status checks, cancellation, timeouts, code submission, output bounds, timeline deduplication, and explicit/idempotent recovery. CLI protocol probes used isolated configurations with Claude Code 2.1.312 and Codex 0.163.0. Completing real browser authorization and live app interaction requires the account owner.
