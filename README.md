# Paseo Secrets

See [OVERVIEW.md](OVERVIEW.md) for behavior, requirements, and security limits.

Requires Paseo 0.11.2 or later, a macOS or Linux daemon, and npm on the daemon host. Enable trusted plugins in Paseo, then install the Git release:

```sh
paseo plugin install https://github.com/yuruiz/paseo-secrets.git --ref v0.3.0
```

The agent can use three MCP tools:

- `request_secrets({ agentId, purpose, fields })`: open a private input card in the current conversation. Read `PASEO_AGENT_ID` from the agent environment for the ID. Each field has an uppercase `name` and `kind: "text" | "image"`. The tool returns pending immediately; the agent should finish its turn and wait for the user's submission notification.
- `run_with_secrets({ grantId, executable, args })`: consume one grant. Text is injected as environment values; images are injected as temporary file paths. Grants containing images return status and an `outputId` with empty stdout/stderr.
- `read_secret_output({ outputId })`: read explicitly released text. Before approval it returns only `awaiting_review`. The user's release sends a notification; do not poll while waiting.

Select **Secrets** in the composer to create a grant manually. `/secrets` or **Provide secrets** in the Command Center adds an inline form. **Send to agent** delivers metadata only. For image output, review and edit in the conversation, then release or discard it. The Secrets popover also lists pending requests and held output if a timeline card is unavailable. Requests follow the app question card interaction: one field at a time, tabs with completion checks, Next, and a final submit. The plugin matches this presentation with the available host primitives; it does not call the permission-bound QuestionFormCard or its answer transport. Raw values, original filenames, image bytes and unreleased output are never included in plugin timeline rows.

The plugin hosts an official-SDK Streamable HTTP MCP server bound to `127.0.0.1`. It exposes the three tools above, with no raw-input or grant-listing MCP tool. Output reading is gated by the separate client approval RPC. The grant ID authorizes one execution; keep it private. Browser-origin requests are rejected. This local endpoint does not replace the existing app-to-daemon connection used to submit secrets. The port is saved in `$PASEO_HOME/plugin-state/secrets-mcp/endpoint.json` so configurations remain valid after reload. That file contains no credentials. An occupied saved port fails explicitly rather than silently changing the endpoint.

New Codex, Claude, OpenCode, and Copilot agents automatically receive the `paseo-secrets` MCP configuration. Internal agents and other providers are left unchanged. Existing agents need the endpoint added through their provider's MCP configuration and their session reloaded. The current plugin API cannot hot-add tools to an already-running session. Other MCP-capable providers can configure the same local endpoint manually. Do not expose this endpoint on the network.

For an existing Codex setup, register the local endpoint once using `codex mcp add paseo-secrets --url http://127.0.0.1:PORT/mcp`, replacing `PORT` with the saved port. Then reload the agent session. Clients with a tool timeout below two minutes may cancel execution earlier; increase that client's MCP tool timeout when longer commands are needed.

Once admitted, the grant is consumed before spawning, including when the executable cannot start. Capacity rejections leave it pending. Revoking a pending grant does not stop a command that has already claimed it. For an explicit shell command, pass `sh` with `args: ["-c", "…"]`; do not expand secret values in the agent's own shell.

The child process inherits only `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_ALL`, and `TMPDIR`, then adds the supplied variables. It does not inherit provider tokens or other environment variables from the daemon. Programs still have the daemon user's filesystem and network access. On command exit, timeout, client disconnect, or orderly plugin shutdown, the broker kills its process group. A deliberately detached process can escape this lifecycle, and a broker crash can leave a running command behind; this is not a process sandbox.

The plugin stores no private input or unreleased output in settings, drafts, timeline rows, or query/mutation caches. Image files are the exception to memory-only handling during consumption: the broker uses a private directory and owner-only files under its image directory. It removes them after completion, failure or cancellation. An inline form's timeline row contains only a request ID; its input values stay in the mounted client's form. Input values are cleared when submission begins, and a failure requires re-entry. If the host remounts a form during a layout or theme change, enter its values again; private drafts are not cached outside the mounted form. Check the pending-grant list before retrying an uncertain submission. Managed-runtime strings cannot be securely zeroed, and host memory, swap, and crash dumps are outside this guarantee.

![Private input with Skip](assets/private-input.png)

![Output review](assets/output-review.png)

## Development

Install development dependencies and run the standalone checks:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm run format:check
npm test
```

The test file exercises the real local MCP server, disposable child processes, private image cleanup, output review, and form/Skip behavior. CI runs it on macOS and Linux with Node 22. The source was extracted from the Paseo monorepo after plugin lifecycle and browser flows were verified there; those host integration tests remain in Paseo.

To develop against this checkout:

```sh
paseo plugin install /absolute/path/to/paseo-secrets
```

Reload installed source changes with `paseo plugin reload secrets`. Reloading drops pending requests, grants and held output. Reload existing agent sessions afterward to refresh their tool inventory.
