# Contributing

Each plugin owns its manifest, package version, lockfile, dependencies, tests and runtime modules. There is no npm workspace hoisting: Paseo must be able to prepare any plugin from its own subdirectory without installing siblings.

## Develop

Use Node.js 22 or newer. From the repository root:

```sh
npm run setup -- commands
npm run check -- commands
npm test -- commands server/commands.test.ts
```

Omit the plugin name from `setup` or `check` to process all plugins sequentially. The local root test command requires a plugin and specific test files. CI runs each plugin's full suite separately.

You can also run the package's scripts directly:

```sh
npm --prefix commands run typecheck
npm --prefix commands run lint
npm --prefix commands run format
```

For a fresh installation, use `paseo plugin install "$PWD/commands"`. For an existing installation already using that directory, run `paseo plugin reload commands`. Check `paseo plugin ls` for its path and `running` status. Never restart the daemon for a plugin edit.

When changing an existing installation's directory, preserve its saved settings and data first. Removing a plugin can delete settings even when its separate data directory survives. Runtime IDs are listed in the root README; do not rename them during a path migration.

## Release

Version each plugin independently in its `package.json` and lockfile. Keep its `repository.directory` equal to its top-level folder. Runtime imports stay within that folder, so copying or installing one plugin never depends on sibling source files or root scripts.

Git installation uses the folder selector, for example `git:yuruiz/paseo-plugins:commands`. A manifest's preparation commands run inside that selected folder. Retain a synchronized lockfile wherever preparation installs dependencies.

Use namespaced tags such as `commands/v0.1.1` for a plugin release. Do not give the entire collection one shared release version. Registry submissions must identify the folder and the reviewed commit. Existing registry records keep their approved pins until the reviewer approves the new location.

## Disk space on this development machine

Keep projects, dependencies, caches, temporary directories and output on the mounted SSD under `~/code`. Verify `df -P ~/code` before allocating space. Set `TMPDIR`, `npm_config_cache` and `XDG_CACHE_HOME` to SSD directories before running npm or tests; do not fall back to the system disk when the SSD is unavailable.
