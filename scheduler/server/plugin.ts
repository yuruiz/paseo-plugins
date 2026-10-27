import { isAbsolute, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import type { PluginServerContext, PluginSettingsState } from "@getpaseo/plugin/server";
import { schedulerSettings, settingsSchema, type Settings } from "../shared/settings";
import {
  importRpc,
  previewRpc,
  removeRpc,
  resolveRpc,
  runRpc,
  saveRpc,
  statusRpc,
} from "../shared/rpc";
import { calendarsWithImports } from "./calendars";
import { preview } from "./engine";
import { CliExecutor } from "./executor";
import { Scheduler } from "./scheduler";
import { Store } from "./store";

export function contributeScheduler(server: PluginServerContext): () => Promise<void> {
  const settings = server.registerSettings(schedulerSettings);
  let scheduler: Scheduler | null = null;
  let controller = new AbortController();
  let error: string | null = null;
  let configured: Settings | null = null;
  let stopped = false;
  let changes: Promise<void> = Promise.resolve();
  let configurationVersion = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function requireScheduler(): Scheduler {
    if (!scheduler)
      throw new Error(error ?? "Configure the daemon home and a separate data directory first");
    return scheduler;
  }

  function tick(): void {
    if (!scheduler) return;
    void scheduler.tick().catch((failure) => {
      error = failure instanceof Error ? failure.message : String(failure);
    });
  }

  function configure(next: PluginSettingsState<typeof settingsSchema>): void {
    const version = ++configurationVersion;
    changes = changes
      .then(async () => {
        if (stopped || version !== configurationVersion) return;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        controller.abort();
        const previous = scheduler;
        scheduler = null;
        configured = null;
        if (previous) await previous.stop();
        error = null;
        if (next.status === "invalid") throw new Error(next.error);
        const values = next.values;
        if (!values.daemonHome || !values.stateDirectory) return;
        if (!isAbsolute(values.daemonHome) || !isAbsolute(values.stateDirectory))
          throw new Error("Daemon home and data directory must be absolute paths");
        await realpath(values.daemonHome);
        if (resolve(values.stateDirectory) === resolve(values.daemonHome))
          throw new Error(
            "Use a separate data directory, for example <daemon home>/scheduler-data",
          );
        const store = await Store.open(values.stateDirectory, values.daemonHome);
        controller = new AbortController();
        configured = values;
        scheduler = new Scheduler(
          store,
          new CliExecutor(values, controller.signal),
          () => !stopped && values.enabled,
        );
        timer = setInterval(tick, 30000);
        tick();
      })
      .catch((failure) => {
        error = failure instanceof Error ? failure.message : String(failure);
        console.error("Scheduler configuration error", error);
      });
  }

  const unsubscribe = settings.subscribe(configure);
  const initialVersion = configurationVersion;
  void settings
    .read()
    .then((value) => {
      if (configurationVersion === initialVersion && !stopped) configure(value);
    })
    .catch((failure) => {
      error = failure instanceof Error ? failure.message : String(failure);
    });

  server.handle(statusRpc, () => {
    const state = scheduler?.store.snapshot() ?? null;
    return {
      state,
      calendars: calendarsWithImports(state?.calendars ?? []),
      error,
      executing: configured?.enabled ?? false,
    };
  });
  server.handle(previewRpc, ({ rule, after, count }) => {
    const calendars = calendarsWithImports(scheduler?.store.snapshot().calendars ?? []);
    return preview(rule, calendars, after ?? new Date().toISOString(), count);
  });
  server.handle(saveRpc, async ({ job, id, revision }) => {
    await requireScheduler().save(job, id, revision);
    return {};
  });
  server.handle(removeRpc, async ({ id, revision }) => {
    await requireScheduler().remove(id, revision);
    return {};
  });
  server.handle(runRpc, async ({ id }) => {
    await requireScheduler().runNow(id);
    return {};
  });
  server.handle(resolveRpc, async ({ id, revision }) => {
    await requireScheduler().resolveUnknown(id, revision);
    return {};
  });
  server.handle(importRpc, async ({ calendar, revision }) => {
    await requireScheduler().importCalendar(calendar, revision);
    return {};
  });

  return async () => {
    stopped = true;
    unsubscribe();
    if (timer) clearInterval(timer);
    controller.abort();
    await changes;
    if (scheduler) await scheduler.stop();
  };
}
