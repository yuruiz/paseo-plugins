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
