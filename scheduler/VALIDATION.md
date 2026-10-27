# Validation record

Initial validation: macOS, 2026-09-29, Paseo 0.9.2. Rechecked the archive/history/mobile form update on 2026-10-22 with Paseo daemon and CLI 0.12.0 and plugin SDK 0.9.2: typecheck, lint, the 16 scheduler tests, and the isolated archive smoke test passed.

## Passed

- `npm run typecheck`.
- `npm run lint`, with no errors or warnings.
- `server/engine.test.ts`: 14 cases covering month ends, leap years, mainland makeup workdays, last business days, US daylight saving changes, missing/repeated local times, US early closes, HKEX half days, cross-month adjustments, coverage boundaries, and custom overrides.
- `server/scheduler.test.ts`: 16 cases covering persistence before submission, duplicate prevention, uncertain outcomes and reconciliation, latest-only catch-up, skipping missed runs, stale-write rejection, process locking, disk recovery, daemon-home binding, CLI launch options, and per-run automatic archival with failure retries and restart recovery.
- `client/schedule-options.test.ts`: 10 cases covering provider/model serialization, unpinned model defaults, pinned default modes, saved aliases, catalog failures, model-dependent thinking, disabled providers, arbitrary minute offsets, and nonempty weekday selection.
- `npm pack --dry-run`: only plugin entry points, runtime source, examples, and documentation are included; tests and temporary data are excluded.
- Client source audit: no DOM APIs, HTML elements, or browser-only event handlers. Matches from the broad audit expression were TypeScript generics.

## Real daemon verification

Used a temporary home and an OS-assigned port, with the relay disabled. These isolated tests did not modify or restart the main daemon on port 6767.

1. Loaded the plugin and confirmed `running` without load errors.
2. Called the preview RPC over a real WebSocket and plugin subprocess, checking HKEX month-end trading days with full-day and half-day closes.
3. Confirmed an incompatible time zone is rejected with a readable error.
4. Configured a temporary data directory through the settings RPC, then created and persisted a schedule.
5. Dispatched through the real `paseo run --background` CLI using Paseo's `provider-direct-example` Echo test provider. No commercial model was called.
6. Confirmed the run acquired an agent ID and progressed from submitted to finished.
7. Confirmed stale-revision saves fail without replacing the saved data.
8. Reloaded the plugin and confirmed schedules and history survived.
9. Created an automatic minute-resolution task, disconnected the SDK client, then reloaded the plugin. It triggered and tracked the agent to completion without any app or SDK connection.

The occurrence in step 9 was scheduled for `2026-09-29T06:46:00.000Z` and verified in the isolated ledger. The CLI execution path was exercised; commercial provider behavior was not.

The plugin was subsequently installed on the user's main daemon with explicit authorization. Its loaded status, configured data directory, and calendar preview RPC were verified. Background execution remained paused, with no schedules created on that host during installation.

Automatic archival was verified again on 2026-10-22 with a real isolated daemon and Echo test provider: the agent was archived after completion, the shared workspace remained active, and the archived timestamp survived a plugin reload. The isolated daemon and its temporary home were removed afterward.

## English interface update

The client interface, built-in calendar names and reasons, validation messages, backend errors, documentation, and example content have been translated to English. Existing tests that assert message text use the corresponding English wording. User data and historical records are not rewritten.

## Not yet verified

Earlier UI verification was blocked by missing Computer Use permissions. On 2026-10-22, two attempts to access the running Paseo app through Computer Use timed out, so interactive UI and screenshot verification remain incomplete. Wide/compact layouts, light/dark themes, and native iOS/Android rendering have not been visually verified.

Complete those UI checks on the installed plugin when computer access is available: new schedules default to Archive conversation; editing retains the saved choice; Open conversation targets the selected host and opens archived history without unarchiving; compact time fields stack; long labels fit; and the iOS keyboard leaves the form usable. Also check form success and error feedback.
