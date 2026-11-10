# AGENTS.md

Working rules for contributors and coding agents in this repository. They restate the
Paseo plugin requirements we must follow when developing, reviewing, and releasing.

## References

- Plugin quickstart: https://paseo.sh/docs/plugins
- Plugin reference: https://paseo.sh/docs/plugins/reference
- Publishing guide: https://paseo.sh/docs/plugins/publishing
- Registry review policy: https://github.com/getpaseo/plugins/blob/main/REVIEW.md

## Compliance

- Keep the standard plugin layout: `paseo-plugin.json`, `index.client.tsx`,
  `index.server.ts`, `client/`, `server/`, `shared/`, with a committed lockfile.
- Manifest paths are relative, use forward slashes, and must not contain `..` segments.
  Keep `requirements.paseo` accurate and the listed entry files present.
- Follow the plugin SDK contracts: client code must not reach into daemon-only APIs, and
  daemon code must not depend on the UI. Keep RPC contracts schema-validated.
- Dependencies must stay minimal and resolve through the committed lockfile. Any build or
  lifecycle script must have an understandable purpose and no hidden side effects.
- Registry review reads the pinned artifact without executing it; everything needed to
  understand the plugin must be inside the repository.

## Security

- Session logs are private user data: the plugin only reads them locally, or over SSH from
  hosts the user configured, and never transmits raw log contents anywhere. The multi-host
  snapshot RPC sends only usage metadata to the connected Paseo client, excluding prompt-derived titles. Never log or echo
  log lines, prompts, file contents, or per-request text.
- SSH access is limited to user-configured hosts. Passwords stay on the daemon host
  (`hosts.json`, mode 600) or come from a user-supplied password command; never print,
  log, or quote credentials, key material, or raw remote command output.
- Remote write access is limited to the incremental cache directory; remote logs stay
  read-only.
- Network destinations are existing authenticated Paseo connections for local-only usage
  snapshots, user-configured SSH hosts, and the version check
  (`raw.githubusercontent.com`, falling back to `api.github.com`), which reads public files
  and sends no user data. Document every network destination and data flow in `OVERVIEW.md`.
- No hidden network calls, no telemetry, no `eval` of dynamic or remote code, no shell
  built from external data.

## Data sanitization

- Everything committed must be desensitized: no real names, hostnames, IP addresses,
  account handles, project names, workspace paths, tokens, or customer data in code,
  comments, docs, fixtures, examples, screenshots, or commit messages.
- Use obvious placeholders such as `<host>`, `user@example.com`, `acme-project`, `12345678`.
- Screenshots and media: agents must never capture, generate, edit, replace, or push
  images themselves. Only screenshots supplied by the author may be committed, and only
  after the author confirms they are desensitized. Never push an image change the author
  did not provide.

## Code safety

- Local scans are read-only; keep delta state bounded and inside the plugin data directory.
- Validate and clamp external input (hosts configuration, ranges, intervals); keep error
  messages useful without echoing credentials or raw remote output.
- When behavior or data access changes, update `OVERVIEW.md` in the same change.

## Keeping docs in sync

Feature changes must update the user-facing documents in the same change:

- `README.md`: feature list, setup, and usage examples.
- `OVERVIEW.md`: capabilities, settings, permissions, and data access.
- `paseo-plugin.json`: description, media, icon, and requirements.

A release is not ready while these documents still describe older behavior.

## Publishing and releases

This plugin is maintained in `paseo-agent-usage/` in `yuruiz/paseo-plugins`.
Follow the root `CONTRIBUTING.md`. Keep `repository.directory` synchronized with
this folder and push changes to this collection, not to a standalone repository.

Direct Git installs use `git:yuruiz/paseo-plugins:paseo-agent-usage`. Keep the
runtime ID and data directory unchanged. The original upstream registry listing
retains its approved source; do not update that listing as part of ordinary
changes here. The update checker reads this folder's version at the collection's
`main` commit. Use namespaced tags if publishing a release.

Checklist before pushing:

- `npm run typecheck` passes; run `npm run build:collector` when the remote collector
  sources change and commit the regenerated bundle.
- Grep the change for secrets and real identifiers; confirm none.
- README, OVERVIEW, and the manifest are updated together (see above).
- Bump `package.json` and `shared/version.ts` together; the update check compares the
  collection version against `shared/version.ts`.
- Screenshots are supplied by the author, never captured or committed by agents. Do not
  generate, capture, or replace images under `assets/`; ask the author to provide the
  desensitized screenshot instead.
