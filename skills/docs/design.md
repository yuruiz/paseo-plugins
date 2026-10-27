# Skills discovery

This fork lists only skills backed by files. It retains upstream's source grouping, search,
body preview, invocation, composer popover and full workspace panel.

## Recognition rule

An entry must be in a supported provider's skill search path, contain a readable `SKILL.md`,
and have nonblank top-level `name` and `description` frontmatter. Ordinary Markdown, agent
instructions, legacy slash-command files and empty directories are excluded. Symlinked skill
folders are supported. The existing lightweight frontmatter parser supports flat fields and
literal/folded block scalars; this is not full YAML validation.

`agent.commands()` is never queried. Its `kind` is not reliable evidence: upstream observed Claude
labelling session controls such as `model`, `config` and `doctor` as skills. Neither reported
commands nor reported-only skills belong in this menu. The RPC, browser and badge use the same
filesystem result; there is no reported-entry fallback or command-name denylist.

## Search paths and precedence

- Claude: `.claude/skills` from cwd through the repository root, then the Claude home skills,
  then installed plugin skills. Plugin entries with `projectPath` apply only inside that project,
  regardless of their `scope` string. Read `plugins/installed_plugins.json`, not all cached versions.
- Codex: `.agents/skills` then `.codex/skills` at each directory from cwd through the repository
  root; `~/.agents/skills`, `$CODEX_HOME/skills` (default `~/.codex/skills`), then `/etc/codex/skills`.
  The legacy `.codex` directories remain lower priority within each scope.
- Hermes: `$HERMES_HOME/skills` (default `~/.hermes/skills`), including flat skills and one category
  level. Excluded environment/archive directories and `_org` mirrors are skipped at both levels.

Outside a repository the project walk uses cwd only. Search paths retain upstream first-name-wins
precedence. Unsupported providers return `scanned: false` and the UI explains the discovery limit.
Missing directories are normal. A missing agent or a skill removed before opening surfaces an error.

## Loading and invocation

`skills.list` resolves provider and cwd through the agent handle. `skills.read` re-runs discovery
and accepts an opaque skill ID, never a caller-provided path. Bodies load only for the selected
skill. The pill and panel share the list query; the badge counts only that list.

Invocation sends `/<name> [arguments]` to the selected agent. `user-invocable: false` hides the
Invoke controls. A successful send closes the popover or opens the agent tab. Keep the existing
lifetime guard so a completed send cannot close a later popover or lose an unseen error.

## Limits

- Built-in skills without discoverable files are omitted, even if they are real skills.
- Files on disk are not proof of live-session availability. Codex disabled-skill configuration
  is not read, and discovery does not cross-check the session's loaded list.
- Codex's `.system` subtree and plugin caches are not recursively scanned. This fork retains the
  upstream search paths rather than scanning arbitrary caches for anything named `SKILL.md`.
- Same-name skills are deduplicated although Codex can expose several copies.
- Hermes project trust, external directories, organization mirrors, and nesting beyond one category
  are not resolved. Profile-specific roots are not inferred from an agent's launch configuration.
- Environment overrides come from the plugin subprocess, not each agent's provider configuration.

The historical `plan.md` and `execution-ledger.md` describe upstream decisions. This document
supersedes their additive session-command discovery design.
