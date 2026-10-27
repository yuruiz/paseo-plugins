# Paseo plugins

Plugins for [Paseo](https://paseo.sh). Each plugin lives in its own top-level directory and can be installed independently.

| Plugin                  | What it adds                                                                                      | Runtime ID        |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ----------------- |
| [Commands](commands/)   | Search, preview and run project, global and session commands from the composer.                   | `commands`        |
| [Secrets](secrets/)     | Private inputs, one-use execution grants, reviewed output and 1Password Connect integration.      | `secrets`         |
| [Scheduler](scheduler/) | Business-calendar schedules, upcoming-run previews and run history.                               | `paseo-scheduler` |
| [GitHub PR](github-pr/) | Pull request monitoring, workspace automation and review workflows. Requires a Linux daemon host. | `github-pr`       |
| [VS Code](vscode/)      | Open a configured remote VS Code editor inside a workspace tab.                                   | `vscode-diff`     |

## Install

Enable plugins on the intended Paseo host, then install the folders you need:

```sh
paseo plugin add git:yuruiz/paseo-plugins:commands
paseo plugin add git:yuruiz/paseo-plugins:secrets
paseo plugin add git:yuruiz/paseo-plugins:scheduler
paseo plugin add git:yuruiz/paseo-plugins:github-pr
paseo plugin add git:yuruiz/paseo-plugins:vscode
```

Each plugin's README describes its host version, setup, data access and platform requirements. Plugins are trusted, unsandboxed code. Existing registry installations keep their previously approved source until the registry approves a migration; the commands above install directly from this repository.

## Develop

```sh
git clone https://github.com/yuruiz/paseo-plugins.git
cd paseo-plugins
npm run setup -- commands
npm run check -- commands
npm test -- commands server/commands.test.ts
```

Run `npm run setup` and `npm run check` to process every plugin sequentially. Each directory retains its own package version and lockfile. See [CONTRIBUTING.md](CONTRIBUTING.md) for local installation, targeted tests, releases and disk-space requirements.

## Repository migration

The former `paseo-commands`, `paseo-secrets`, `paseo-github-pr` and `paseo-vscode` repositories are consolidated here with their commit histories. Scheduler was imported from its local project. Future development belongs in this repository; the old repositories and release tags remain available for existing installations. Plugin IDs and persisted-data locations are unchanged.

The directory organization follows [stevecastaneda/paseo-plugins](https://github.com/stevecastaneda/paseo-plugins). Each plugin retains its applicable license and notices.
