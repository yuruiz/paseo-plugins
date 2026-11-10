# GitHub skill sync

The full agent Skills panel provides a GitHub sync page. Repository and optional branch settings
are shared by clients connected to the same host through Paseo's settings API. Configure the same
repository separately on each host. GitHub CLI handles authentication on the daemon machine;
credentials never enter the settings document or client RPC payloads.

## Repository and content

Use an existing, initialized private repository on github.com. The default branch is used when
the branch field is empty. A configured branch must already exist. Public repositories are rejected
before reading skill content and again when applying a fresh comparison. The plugin does not create
repositories, change visibility, or bypass branch protection.

Folders live at `skills/<name>/SKILL.md`, with additional files beneath the same folder. The
frontmatter name must equal the folder name. Uploads include hidden files and resources except
`.git`, `node_modules`, `__pycache__`, and `.DS_Store`; review the changed-file list before uploading.
An upload replaces the selected skill's complete subtree, including file deletions, while retaining
unselected subtrees and other repository content. No unselected skill is deleted from either side.

The implementation uses GitHub's [Git tree API](https://docs.github.com/en/rest/git/trees) to
construct selected subtrees and a single commit, then updates the branch through a
[non-forced reference update](https://docs.github.com/en/rest/git/refs#update-a-reference).
Concurrent branch changes reject the update. Protected branches may reject direct writes; select
an existing writable branch instead.

## Comparison and application

The current agent's existing filesystem discovery determines the local skill list and precedence.
Each regular file is compared using its Git blob hash and executable mode. The complete set of
paths also contributes to the skill fingerprint. Identical content stays equal regardless of
mtime. No timestamp or commit ordering is used to guess which of two different copies is newer.

The page shows identical, local-only, remote-only, differing, and blocked entries. Differing copies
require an explicit direction and a second replacement confirmation. The changed-file list shows
paths present only locally, only remotely, or modified. New downloads go to the current provider's
personal skills directory; existing skills update at their discovered location.

Comparisons expire after fifteen minutes and are bound to the agent. At most eight comparisons
are retained. Every apply consumes its token, resolves the agent and skills again, checks the
remote commit and local content, and rejects changed targets. Operations within the plugin process
are serialized. A plugin reload invalidates existing comparisons.

Downloads fetch blobs from the compared immutable commit, verify hashes, and validate every
selected skill before changing local directories. Each skill is staged beside its destination,
the destination is checked again, and the previous directory is moved to a backup before the new
directory is installed. If installation fails, the previous directory is restored. Backups live in
`<destination-parent>/.paseo-sync/versions/backup-<name>-<id>`; they are never pruned automatically.
This nesting keeps backups out of the plugin's supported discovery paths.

A batch download installs one staged skill at a time. A later local failure reports the
completed skills and backup paths. No baseline is advanced or success inferred after an error;
compare again to inspect the actual files. Independent editors do not participate in the plugin's
operation lock; replaced content remains in the backup.
If the process stops between moving the old directory and installing the new one, the skill may
be temporarily absent; restore its retained backup before comparing again.

Transfers run as server jobs. Starting one returns immediately; the page polls its status once
per second, so large transfers do not depend on one long-lived plugin RPC. Reopening the page
shows the current or last result for that agent. Retrying the same request returns the same job.
Job status is retained in memory until plugin restart or eviction from the bounded history.

## Limits

- GitHub.com only; no GitHub Enterprise host configuration or repository creation.
- Requires GitHub CLI on the daemon's PATH, authenticated for the repository. Empty repositories
  must first be initialized, for example with a README.
- Filesystem discovery limits from [design.md](design.md) still apply. Unsupported providers do
  not gain discovery through this feature.
- Names must be portable directory names, unique ignoring case. Namespaced Claude plugin names
  cannot be synced directly because their invocation name differs from their SKILL.md name.
- A symlinked skill root can be uploaded, but cannot be replaced by a download. Nested symlinks,
  submodules, special files, path traversal, case-colliding paths, and reserved filenames are rejected.
- At most 500 files and 10 MiB per skill; 50 selected skills, 1,000 files, and 25 MiB per operation.
  Truncated GitHub tree responses are rejected; a dedicated skills repository is recommended.
- No background downloads, deletion propagation between machines, automatic merging, or claim
  that files changed on disk are already loaded by a running agent session.
