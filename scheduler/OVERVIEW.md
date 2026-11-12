Scheduler adds business-calendar schedules for Paseo agents. It supports mainland China workdays, US equity-market calendars, HKEX securities calendars and custom calendars, with previews of upcoming runs and a run history.

Configure the daemon home, a separate scheduler data directory and the Paseo CLI path before enabling background execution. New schedules start paused. Background execution and the individual schedule must both be enabled for automatic runs. The host and daemon must remain running. Calendar data is bundled for 2026; dates outside its declared coverage require an update.

Choose one shared model configuration for all schedules, or reuse a Paseo agent profile. Existing schedules can switch together with one action; individual schedules can keep overrides. Profile references use the latest saved settings on each run, including provider features. Missing profiles stop that run with an error. Shared changes affect future runs and preserve task prompts and timing.

The plugin stores schedules and run history in the configured directory and launches agents through the local Paseo CLI. Scheduled prompts and the selected working directory are passed to those agents and their providers. It can archive completed conversations when the schedule requests it. An uncertain launch is reconciled before retrying to avoid duplicate agent runs.

Requires Paseo 0.9.2 or newer. The plugin runs as trusted code on the daemon host and needs access to its configured data directory and CLI. It does not fetch calendar updates automatically.
