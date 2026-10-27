# Commands

Browse commands for the current agent, inspect their Markdown and send them with arguments. **Commands** above the composer opens an anchored popover on desktop and a sheet on compact layouts. Search, preview and invoke without leaving the conversation; successful sends close the popover. **Open tab** in its header and the Command Center open the full panel. Requires Paseo 0.13.0 or newer on both daemon and client.

## Install

Install from the public source repository:

```sh
paseo plugin add git:yuruiz/paseo-commands
```

The runtime plugin ID is `commands`. Enable plugins on the host before using it. Installing from Git runs `npm ci --omit=dev --ignore-scripts` to install the locked YAML parser dependency. Node.js 22 or newer and npm must be available on the daemon host.

The composer button belongs to an existing agent. A new empty draft has no agent ID, so the button appears after its first message creates the agent. Draft commands are not currently supported.

## Development

```sh
git clone https://github.com/yuruiz/paseo-commands.git
cd paseo-commands
npm ci --ignore-scripts
npm run typecheck
paseo plugin install "$PWD"
```

After editing, typecheck and run `paseo plugin reload commands`. No daemon restart is needed.

## Sources

Project discovery walks from the agent's working directory to the nearest Git root (including worktrees), or to the home/filesystem root for a directory outside Git. Only the current provider's directories and shared `.agents/commands` are scanned. Missing directories are normal; unreadable or malformed files produce visible warnings.

| Provider | Project directories                       | Global directories                                                                                           |
| -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| All      | `.agents/commands`                        | `~/.agents/commands`                                                                                         |
| Claude   | `.claude/commands`                        | `$CLAUDE_CONFIG_DIR/commands` or `~/.claude/commands`                                                        |
| Codex    | `.codex/prompts`, `.codex/commands`       | `$CODEX_HOME/prompts`, `$CODEX_HOME/commands`, defaulting to `~/.codex`                                      |
| OpenCode | `.opencode/commands`, `.opencode/command` | `$OPENCODE_CONFIG_DIR/{commands,command}`, defaulting to `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode` |
| Pi       | `.pi/prompts`                             | `$PI_CODING_AGENT_DIR/prompts` or `~/.pi/agent/prompts`                                                      |
| Copilot  | `.github/prompts`                         | `~/.copilot/prompts`                                                                                         |

Environment overrides come from the daemon process. Provider profiles with a different private environment can still expose commands through the session, but those files may have no preview. Claude plugin commands and configuration-defined commands are included when reported by the session; their backing files are not scanned. Entries explicitly marked as skills are excluded.

Markdown discovery is recursive, follows symlinks with cycle detection, accepts `.md`/`.prompt.md`, and caps each file at 1 MiB. YAML frontmatter supplies `description` and `argument-hint`. The **Directories** button shows the exact search paths.

## Invocation

- **Native**: the live session reports the command. Send `/<name> <arguments>` through Paseo. The provider owns expansion and execution. Codex global prompts use `/prompts:<name>`.
- **Template**: send the selected file's Markdown as a normal prompt. Expand `$ARGUMENTS`, numbered arguments and supplied `$NAME` assignments. Quoted arguments retain spaces. Without placeholders, append the arguments. The plugin does not execute frontmatter settings, shell substitutions or file directives.

Project files precede global files with the same name; nearer project files precede ancestors. Shadowed files remain visible and can be sent explicitly as templates. Shared templates and session commands with identical names remain separate entries. Files are re-read on invocation; deleted files and changed native availability fail visibly. Running and archived agents reject invocation. After sending, **Open agent** shows the result in the agent's conversation.

The plugin reads files on the selected daemon host and sends only to the selected agent. The agent provider receives the command and arguments, or the expanded Markdown prompt, under that agent's normal data-handling rules. Native commands may cause the provider to run tools. The plugin does not directly execute shell commands or modify command files. Files under `.agents/commands` are a plugin convention, not a claim that every provider supports that directory natively.

## Checks

All checks run independently of the Paseo monorepo:

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
```

Interaction and discovery design reference: [gpambrozio's Skills plugin](https://paseo.sh/plugins/gpambrozio/skills). Implementation is independent.
