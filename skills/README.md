# Skills

Search, preview and invoke skills from the **Skills** composer pill or workspace panel in Paseo.
The menu and badge include only entries backed by a readable `SKILL.md` with nonblank `name`
and `description` frontmatter. Session commands such as `model`, `config`, `doctor` and `compact`
are not added from the provider's command list, even when the provider labels them as skills.
A real skill with one of those names is still included.

## Install

Requires Paseo daemon and app **0.13.0 or newer**, with plugins enabled on the intended host.

```sh
paseo plugin install "$PWD/skills"
```

Once this directory is published in this repository, Git installation uses:

```sh
paseo plugin add git:yuruiz/paseo-plugins:skills
```

The runtime ID is `skills`. The plugin uses host-provided runtime modules and needs no build step.

## Use

Open the **Skills** pill above an agent's composer. Search by name or description, select a skill,
and invoke it with optional arguments. **Open tab** shows the full body and a copyable path.
The Command Center's **Skills** action opens the same panel. Model-only skills remain readable
but do not have an Invoke button.

Discovery supports Claude, Codex and Hermes. Project, repository, personal, admin and installed
Claude plugin sources retain upstream precedence and name deduplication. Bodies load on demand.
Ordinary Markdown, `AGENTS.md`, `README.md`, legacy command files and folders without a valid
`SKILL.md` do not become menu items.

Providers without filesystem discovery show an explicit unsupported-discovery message. Built-in
entries without a discoverable `SKILL.md` are omitted: a provider's `kind: "skill"` is insufficient
proof. Filesystem discovery does not guarantee a skill is enabled or loaded in the live session.
See [design and limitations](docs/design.md) for the scan boundaries.

## GitHub sync

Open the full **Skills** tab, then **GitHub sync**. On each daemon machine, install GitHub CLI
and authenticate with `gh auth login`. Enter an existing private `owner/repository`, initialized
with a README, and optionally a branch. Reading requires repository Contents access; uploading
requires write access. The plugin uses GitHub CLI authentication without storing a token.

Choose **Upload to GitHub** or **Download to this machine**, select skills, and apply. The repository
stores complete folders under `skills/<name>/`, including scripts, references, binary resources,
and executable permissions. Unselected skills and unrelated repository files are preserved.
On another machine, configure the same repository and select the skills to download.

The comparison shows matching versions, local-only skills, available downloads, and differing
versions, with a file list for each difference. It compares content and executable permissions,
not timestamps: differing versions require choosing which copy to keep. The sync screen checks
when opened and every five minutes while mounted; **Check for updates** refreshes immediately.
It never transfers skills automatically.

New downloads use `~/.agents/skills` for Codex, `~/.claude/skills` for Claude, or
`$HERMES_HOME/skills` for Hermes. Existing discovered skills update at the displayed path.
Replacement needs a second confirmation. Local backups remain beneath the destination parent's
`.paseo-sync/versions/` directory, and the result shows their paths. Restore them manually if needed.
Remote versions remain in Git history. Read [sync behavior and limits](docs/github-sync.md).

## Develop

From the repository root:

```sh
npm run setup -- skills
npm run check -- skills
npm test -- skills server/skills.test.ts client/skills-query.test.ts
```

Follow [the repository disk-space requirements](../CONTRIBUTING.md#disk-space-on-this-development-machine)
before installing dependencies or running tests. Keep `TMPDIR` on the SSD **outside any Git checkout**
(for example `~/code/.cache/paseo-skills/tmp`): resolver tests include paths outside a repository.
After installing locally, reload source changes
with `paseo plugin reload skills`; do not restart the daemon.

## Upstream and license

Imported from [gpambrozio/paseo-plugins/skills](https://github.com/gpambrozio/paseo-plugins/tree/b990f96dbca7a0bb7e9b4123e089b1db8e43b618/skills),
commit `b990f96dbca7a0bb7e9b4123e089b1db8e43b618` (upstream 0.4.0). This fork removes session-reported
commands and unverified entries from discovery, rendering and counts. The upstream MIT
[license](LICENSE) is retained. Historical upstream plans and execution notes in `docs/` describe
that original implementation, not this fork's scope.
