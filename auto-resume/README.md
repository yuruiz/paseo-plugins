# Auto Resume

A Paseo plugin that waits for Claude Code or Codex subscription quota to reset, then sends a continuation prompt to the same conversation.

## Use

- A quota error adds an inline card with **Resume after reset**, a manual time field and cancellation.
- The **Auto-resume** composer pill enables automatic scheduling for that conversation. It is off by default. Turning it off also cancels a pending appointment.
- Reset times use an explicit provider timezone when supplied, otherwise the configured timezone (initially the daemon timezone). Ambiguous or missing times require user input. The manual field accepts an ISO date with a timezone offset.
- A 60-second buffer follows the reported reset time. The buffer and maximum consecutive recovery attempts (default 3) are configurable per conversation.

This is error-triggered monitoring, not proactive quota polling. Bare HTTP 429/RPM/TPM errors, authentication failures and network errors do not schedule a continuation. Unsupported providers have no pill.

## Requirements and installation

Both daemon and app must run Paseo 0.14.x. The published 0.14 SDK uses the supported `server.on` lifecycle aliases; this plugin intentionally typechecks against that package rather than relying on newer online documentation alone.

```sh
npm ci --ignore-scripts --no-audit --no-fund
paseo plugin install /absolute/path/to/auto-resume
```

Or install the Git folder after publishing the changes:

```sh
paseo plugin add git:yuruiz/paseo-plugins:auto-resume
```

The backend normally reuses the plugin's Paseo SDK connection. On restart, before any hook or app RPC supplies that connection, headless recovery uses the public local CLI (`inspect`, `logs --filter text`, `send --no-wait`). On macOS the bundled Paseo CLI is detected; otherwise `paseo` must be on the daemon PATH. `AUTO_RESUME_PASEO_BIN` overrides its executable path. No shell command interpolation is used.

## Persistence and recovery

State defaults to `<PASEO_HOME>/plugin-data/auto-resume` (default home `~/.paseo`). `AUTO_RESUME_DATA_DIR` selects another absolute directory on the daemon machine. The directory is bound to that daemon home and protected by a single-writer lock. Writes use a synced temporary file and atomic rename. CLI temporary files are directed to a `tmp` child of the data directory.

On this development machine both the repository and `~/.paseo` resolve to the external SSD. Keep all dependencies, caches, test output and plugin state on that mounted SSD. Never substitute an internal-disk location when the SSD is unavailable.

Croner owns one run-once timer per waiting conversation. A 30-second reconciliation loop catches overdue work after sleep; persisted jobs are rebuilt on load. The original failed turn has ended: recovery sends a new prompt in the existing session, not a replay of the failed HTTP request. Existing permissions still apply.

Before dispatch the plugin checks provider, archived state, active turn, pending approvals and the last user-message timestamp. Headless startup additionally compares a hash of the text transcript saved when quota was detected. Failure to capture a baseline prevents unattended startup dispatch; the pill remains available for manual control. The transcript is not stored.

Only one job per conversation is retained. Repeated events are deduplicated; obsolete card IDs cannot schedule a different job. Manual activity, cancellation and archive invalidate pending work. Further quota errors reschedule up to the selected attempt limit. Other completion outcomes end that retry chain. A persistent `sending` intent is written before submission: if the process stops or the acknowledgement is lost, the result becomes unknown and requires the user to inspect the conversation and continue manually. The plugin does not claim exactly-once delivery across arbitrary daemon failures. There is no atomic SDK “send only if still idle”; a status check and lifecycle invalidation minimize, but cannot eliminate, a simultaneous user-send race.

## Data access

Reads errors and recent output only for Claude/Codex turns, and uses the local CLI to hash the text history for restart validation after detecting quota exhaustion. Stores per-agent preferences, one current job, a bounded error excerpt, reset timestamps and a transcript hash. Does not read provider credential stores, call vendor quota APIs, change provider/model or auto-approve permissions. The continuation message asks the agent to check existing progress and avoid repeating completed actions.

## Development

```sh
# Point these at verified SSD locations on the development host.
export TMPDIR=/path/on/ssd/tmp
export npm_config_cache=/path/on/ssd/npm-cache
export XDG_CACHE_HOME=/path/on/ssd/cache
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run lint
npm run format:check
```

Tests cover reset parsing (including timezones and DST ambiguity), unrelated-error rejection, one-shot scheduling, concurrent cancellation, retry limits, persistence, writer locking, startup recovery and ambiguous dispatch failures.
