# Paseo Scheduler

A standalone business-calendar scheduler for Paseo. No changes to Paseo core are required. Supports Paseo 0.9.2 and later through the official client and server plugin entry points.

## Features

- Mainland China workdays, including official holidays and weekend makeup workdays.
- Separate NYSE and Nasdaq equity calendars, including holidays and early closes.
- HKEX securities calendar, including half days. Stock Connect, derivatives, and settlement calendars are separate and are not included.
- Custom business calendars imported as JSON, with weekly rules and per-date overrides.
- Daily, weekly, monthly dates, month end, dates counted backward from month end, the nth business day, and the nth weekday of a month.
- Skip, move earlier, or move later on non-business days, with an optional restriction to stay within the month.
- Fixed local times or offsets from market open/close; previews of the next five occurrences and adjustment reasons.
- Pause/resume, manual runs, run history, missed-run policies, and reconciliation after interrupted submissions.
- Provider thinking options, reuse of an existing workspace, and optional local dates in agent titles.

Business calendars use their region's dates and time zone: `Asia/Shanghai`, `America/New_York`, or `Asia/Hong_Kong`. Calendar-day schedules can use any supported IANA time zone.

US daylight saving changes follow the time zone database. Nonexistent local times are skipped; repeated local times run at their first occurrence only. HKEX's market-close anchor uses the latest closing-auction end: 16:10 on full days and 12:10 on half days. It does not detect the actual random auction close.

## Install and configure

Install dependencies and check the source:

```sh
npm ci
npm run typecheck
npm run lint
```

Paseo plugins are trusted, unsandboxed code. Server code can access the daemon host's files, processes, credentials, and network; client code runs inside Paseo. The user must explicitly enable plugins under **Settings → Plugins** on the intended host.

```sh
paseo plugin install /absolute/path/to/paseo-plugins/scheduler --home /absolute/path/to/daemon-home
paseo plugin ls --home /absolute/path/to/daemon-home
```

Open **Advanced Schedules → Settings** from the sidebar:

1. Enter the absolute home path of the daemon hosting this plugin.
2. Choose a separate data directory, such as `<daemon-home>/scheduler-data`. The directory binds to that daemon home on first use and cannot be reused by another daemon.
3. Enter the Paseo CLI path. An absolute path is recommended for desktop installations, whose PATH may differ from your terminal's.
4. Save the settings and enable background execution when ready.

New schedules start paused. Preview their run times before enabling them. Both background execution and the individual schedule must be enabled for automatic runs. **Run now** can execute a paused schedule but still requires background execution to be enabled.

Provider, Model, Mode, and Thinking use dropdowns populated from the selected host's provider catalog. The working directory scopes discovery; its options refresh after you leave that field. **Provider default** keeps the host's default model rather than pinning a model ID. Mode is the exception: the form pins the provider's advertised default mode, because the daemon does not apply it when `paseo run` omits `--mode` (Claude falls back to Always Ask). **Custom value…** is available when a provider does not advertise a required value. Existing selections remain visible during loading and discovery failures.

Hours, minutes, monthly positions, weekdays, and common time zones are selectable. Weekly schedules use weekday buttons. Market-relative offsets use Before/After plus hour/minute selectors. Business-calendar time zones follow the calendar; calendar-day schedules also allow a custom IANA time zone.

Wide layouts group related fields into two columns. Select fields show their explanations below the label; text-field explanations open with **?**. Workspace/title/missed-run settings are under **More options**. Schedule rows show the next run and inline actions; **Details** reveals the directory and agent settings. Compact layouts stack fields, including hour/minute controls, and use larger text and touch targets. Narrow panes also use the compact layout. On iOS, the form moves above the keyboard; scrolling dismisses the keyboard and controls remain tappable while it is open.

After editing source, run `paseo plugin reload paseo-scheduler --home <daemon-home>`. A daemon restart is not required. Removing the plugin deletes its Paseo-managed settings but preserves the separate data directory. Reconfigure that directory after reinstalling to restore schedules and history.

## Calendar sources and updates

The initial release includes **official announcement snapshots for 2026**:

| Calendar ID   | Source                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cn-workdays` | [State Council holiday arrangements for 2026](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm), checked against the [Beijing government republication](https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html)                                                                                                    |
| `us-nyse`     | [NYSE Holidays & Trading Hours](https://www.nyse.com/trade/hours-calendars)                                                                                                                                                                                                                                                                      |
| `us-nasdaq`   | [Nasdaq Trading Schedule](https://www.nasdaq.com/market-activity/stock-market-holiday-schedule)                                                                                                                                                                                                                                                  |
| `hk-hkex`     | [HKEX CT/075/25: 2026 securities-market holidays](https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf) and [trading hours](https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market?sc_lang=en) |

Snapshots were checked on 2026-09-29. Import updates for unscheduled closures; this release does not automatically fetch new announcements.

Every calendar declares its coverage, version, and sources. Dates outside that coverage are unknown. Affected schedules stop calculating future occurrences and request an update instead of assuming ordinary Monday–Friday operation. Previews can still show known dates before the coverage boundary.

Under **Calendars → Edit / export**, copy and edit the full JSON document, then import it:

- Importing the same ID **replaces the entire calendar**. Increase the version and retain all coverage and exceptions still needed.
- Merge a new year into the complete document. Do not extend `validThrough` without adding that year's official holidays.
- Give a custom company calendar a new ID; update its name, dates, and sources.
- `weekdays` uses 1 = Monday through 7 = Sunday. `overrides` takes precedence over the weekly rule.
- Non-trading calendars use `session: null`. Trading-day overrides can specify opening/closing times and `halfDay`.
- Future occurrences use the imported version. Historical runs retain their original calendar version.

See the [custom business calendar example](examples/company-calendar.json). It is demonstration data, not an official calendar.

## Execution and recovery

The server plugin checks schedules every 30 seconds. No connected app is needed, but the host and daemon must be running. Sleeping hosts, disabled plugins, and stopped daemons cannot execute on time.

Each schedule chooses a missed-run policy:

- **Skip:** do not start occurrences more than 90 seconds late; record the number skipped.
- **Run the latest missed occurrence:** start only the latest known missed occurrence after recovery, without replaying the entire backlog.

A schedule permits only one active or unconfirmed run at a time. Occurrences reached during that run are handled by the same missed-run policy after it finishes. Editing or resuming an individual schedule resets its starting point to the save time. Resuming background execution retains existing cursors. Backlogs beyond the automatic recovery limit require review and a new save to reset the starting point.

The plugin starts a new agent through `paseo run --background --home ... --label paseo-scheduler-run=...`. By default it creates a fresh local workspace. Set **Existing workspace ID** to reuse a workspace, and **Thinking option** to preserve a provider-specific setting such as `max`. The optional dated title uses the schedule's time zone. Runs also carry `external-scheduler=paseo-scheduler`, `external-schedule`, and `external-schedule-date` labels for CLI filtering.

It persists the occurrence ID before submission. After a timeout or restart, it searches for an agent with that label. Unconfirmed submissions remain blocked and are not automatically resubmitted. After reviewing the corresponding agent, you can unblock the record in **Run history**; this does not cancel a submitted task.

The local ledger and daemon-side agent creation do not share a transaction, so the plugin does not promise strict exactly-once execution. **Agent finished** means the agent returned to an idle/closed state; check its conversation for the business outcome.

In the main schedule form, **After run** offers **Archive conversation** (the default for new schedules) or **Keep conversation**. Existing schedules retain their saved choice. Each schedule card shows its current setting. The choice is captured when each run starts and applies to future runs; editing a schedule does not change an active run's choice. Archival follows the scheduler's 30-second checks after an agent finishes or fails. It archives that agent, preserving the workspace and history. Use **Run history → Open conversation** to read a run, including archived conversations; opening history does not unarchive it. Runs without a confirmed agent ID have no conversation link. This action uses the selected plugin host; older clients without navigation support show an update notice. Running agents and pending permission requests are not force-archived. Errors appear in Run history and are retried while background execution is enabled, including after plugin reloads, without resubmitting the task.

The data directory uses a process lock and atomic JSON replacement. It retains the most recent 1,000 runs plus older unresolved runs; the UI displays the most recent 100. Use a local disk rather than shared storage or live synchronization of files being written.

## Development and validation

```sh
npm test -- server/engine.test.ts --bail=1
npm test -- server/scheduler.test.ts --bail=1
npm run format
npm run typecheck
npm run lint
```

`shared/` contains data and RPC contracts. `server/` owns calendar calculations, file storage, and CLI execution. `client/` contains the React Native UI. The SDK is pinned to 0.9.2 to avoid depending on unreleased APIs from the Paseo checkout.

Plugin UI, built-in calendar labels, help text, and system errors are in English. User-entered schedule names, prompts, imported calendar content, and existing historical records are preserved.

See [VALIDATION.md](VALIDATION.md) for verification coverage and remaining gaps.
