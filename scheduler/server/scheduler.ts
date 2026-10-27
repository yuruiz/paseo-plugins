import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { Calendar, Job, JobInput, Occurrence, Run, State } from "../shared/model";
import { calendarsWithImports } from "./calendars";
import { preview, validateRule } from "./engine";
import type { Executor } from "./executor";
import { Store } from "./store";

export function pending(run: Run): boolean {
  return run.status === "dispatching" || run.status === "uncertain" || run.status === "submitted";
}

function needsArchive(run: Run): boolean {
  const terminal = run.status === "finished" || run.status === "failed";
  return terminal && run.autoArchive && run.archivedAt === null && run.agentId !== null;
}

function requireRevision(state: State, revision: number): void {
  if (state.revision !== revision)
    throw new Error("Data changed. Refresh before saving; your draft is preserved.");
}

function requireJob(state: State, id: string): Job {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) throw new Error("Schedule not found");
  return job;
}

function pruneRuns(state: State): void {
  const recent = new Set(state.runs.slice(-1000).map((run) => run.id));
  state.runs = state.runs.filter((run) => pending(run) || needsArchive(run) || recent.has(run.id));
}

export class Scheduler {
  private stopped = false;
  private active: Promise<void> | null = null;
  private launches = new Set<Promise<void>>();

  constructor(
    readonly store: Store,
    private executor: Executor,
    private enabled: () => boolean,
    private now: () => Date = () => new Date(),
  ) {}

  async save(input: JobInput, id: string | null, revision: number): Promise<void> {
    if (!isAbsolute(input.cwd))
      throw new Error("The working directory must be an absolute path on the daemon host");
    await this.store.update((state) => {
      requireRevision(state, revision);
      validateRule(input.rule, calendarsWithImports(state.calendars));
      const now = this.now().toISOString();
      if (id) {
        const previous = requireJob(state, id);
        Object.assign(previous, input, {
          revision: previous.revision + 1,
          cursor: now,
          error: null,
        });
      } else {
        if (state.jobs.length >= 100) throw new Error("A maximum of 100 schedules is supported");
        state.jobs.push({
          ...input,
          id: randomUUID(),
          revision: 1,
          cursor: now,
          createdAt: now,
          error: null,
        });
      }
    });
  }

  async remove(id: string, revision: number): Promise<void> {
    await this.store.update((state) => {
      requireRevision(state, revision);
      requireJob(state, id);
      if (state.runs.some((run) => run.jobId === id && pending(run)))
        throw new Error("Resolve active or unconfirmed runs before deleting this schedule");
      state.jobs = state.jobs.filter((job) => job.id !== id);
    });
  }

  async importCalendar(calendar: Calendar, revision: number): Promise<void> {
    await this.store.update((state) => {
      requireRevision(state, revision);
      const previous = calendarsWithImports(state.calendars).find(
        (item) => item.id === calendar.id,
      );
      if (previous && previous.version === calendar.version)
        throw new Error("Use a new version number when updating a calendar");
      if (previous && previous.timezone !== calendar.timezone)
        throw new Error("A calendar’s time zone cannot change under the same ID; create a new ID");
      state.calendars = state.calendars.filter((item) => item.id !== calendar.id);
      state.calendars.push(calendar);
      for (const job of state.jobs) if (job.rule.calendarId === calendar.id) job.error = null;
    });
  }

  async resolveUnknown(runId: string, revision: number): Promise<void> {
    await this.store.update((state) => {
      requireRevision(state, revision);
      const run = state.runs.find((item) => item.id === runId);
      if (!run || run.status !== "uncertain")
        throw new Error("This run does not need manual resolution");
      run.status = "skipped";
      run.message = "Reviewed and unblocked by the user; the task was not resubmitted";
      run.updatedAt = this.now().toISOString();
    });
  }

  async runNow(id: string): Promise<void> {
    if (!this.enabled() || this.stopped)
      throw new Error("Enable background execution in the plugin settings first");
    const job = requireJob(this.store.snapshot(), id);
    const now = this.now().toISOString();
    const run = await this.claim(job, { scheduledAt: now, calendarVersion: "manual" }, false);
    if (!run) throw new Error("A run is active or unconfirmed, or the schedule was just modified");
    this.launch(job, run);
  }

  private async claim(
    job: Job,
    occurrence: Pick<Occurrence, "scheduledAt" | "calendarVersion">,
    automatic: boolean,
  ): Promise<Run | null> {
    let claimed: Run | null = null;
    await this.store.update((state) => {
      const current = state.jobs.find((item) => item.id === job.id);
      if (this.stopped || !this.enabled() || !current || current.revision !== job.revision) return;
      if (automatic && !current.enabled) return;
      if (automatic) {
        const calendar = calendarsWithImports(state.calendars).find(
          (item) => item.id === current.rule.calendarId,
        );
        if (!calendar || calendar.version !== occurrence.calendarVersion) return;
      }
      if (state.runs.some((run) => run.jobId === job.id && pending(run))) return;
      if (
        automatic &&
        state.runs.some((run) => run.jobId === job.id && run.scheduledAt === occurrence.scheduledAt)
      )
        return;
      claimed = {
        id: randomUUID(),
        jobId: job.id,
        jobName: job.name,
        jobRevision: job.revision,
        scheduledAt: occurrence.scheduledAt,
        calendarVersion: occurrence.calendarVersion,
        status: "dispatching",
        agentId: null,
        message: "Submitting",
        updatedAt: this.now().toISOString(),
        autoArchive: job.autoArchive,
        archivedAt: null,
        archiveError: null,
      };
      state.runs.push(claimed);
      if (automatic) current.cursor = occurrence.scheduledAt;
      current.error = null;
      pruneRuns(state);
    });
    return claimed;
  }

  private launch(job: Job, run: Run): void {
    const operation = this.dispatch(job, run);
    this.launches.add(operation);
    void operation
      .finally(() => this.launches.delete(operation))
      .catch((error) => console.error("Scheduler persistence error", error));
  }

  private async dispatch(job: Job, run: Run): Promise<void> {
    try {
      const agentId = await this.executor.submit(job, run.id);
      await this.updateRun(run.id, {
        status: "submitted",
        agentId,
        message: "Agent started; waiting for it to finish",
      });
    } catch (error) {
      await this.updateRun(run.id, {
        status: "uncertain",
        message: `Submission outcome unconfirmed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private async updateRun(
    id: string,
    update: Partial<Pick<Run, "status" | "agentId" | "message" | "archivedAt" | "archiveError">>,
  ): Promise<void> {
    await this.store.update((state) => {
      const run = state.runs.find((item) => item.id === id);
      if (run) Object.assign(run, update, { updatedAt: this.now().toISOString() });
    });
  }

  tick(): Promise<void> {
    if (this.active) return this.active;
    const operation = this.processTick();
    this.active = operation;
    void operation
      .finally(() => {
        this.active = null;
      })
      .catch(() => {});
    return operation;
  }

  private async reconcile(): Promise<void> {
    for (const run of this.store.snapshot().runs.filter(pending)) {
      if (this.stopped) return;
      // A live submission is reconciled by its own completion, never concurrently by the timer.
      if (run.status === "dispatching" && this.launches.size > 0) continue;
      try {
        const observation = run.agentId
          ? await this.executor.observe(run.agentId)
          : await this.executor.find(run);
        if (observation) {
          if (observation.status !== run.status || observation.agentId !== run.agentId) {
            await this.updateRun(run.id, {
              ...observation,
              message:
                observation.status === "finished"
                  ? "Agent finished (check its conversation for the task result)"
                  : observation.status,
            });
          }
        } else if (run.status === "dispatching") {
          await this.updateRun(run.id, {
            status: "uncertain",
            message:
              "No matching agent found after restart; awaiting confirmation without retrying",
          });
        }
      } catch (error) {
        const message = `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`;
        if (run.message !== message) await this.updateRun(run.id, { message });
      }
    }
  }

  private async processTick(): Promise<void> {
    if (this.stopped || !this.enabled()) return;
    await this.reconcile();
    await this.archiveFinishedRuns();
    const state = this.store.snapshot();
    const calendars = calendarsWithImports(state.calendars);
    for (const job of state.jobs) {
      if (this.stopped || !this.enabled()) return;
      if (!job.enabled || state.runs.some((run) => run.jobId === job.id && pending(run))) continue;
      try {
        await this.processJob(job, calendars);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.store.update((current) => {
          const target = current.jobs.find((item) => item.id === job.id);
          if (target && target.revision === job.revision) target.error = message;
        });
      }
    }
    await Promise.all(this.launches);
  }

  private async archiveFinishedRuns(): Promise<void> {
    for (const run of this.store.snapshot().runs.filter(needsArchive)) {
      if (this.stopped || !this.enabled()) return;
      if (!run.agentId) continue;
      try {
        const archivedAt = await this.executor.archive(run.agentId);
        await this.updateRun(run.id, { archivedAt, archiveError: null });
      } catch (error) {
        const archiveError = `Automatic archive failed: ${error instanceof Error ? error.message : String(error)}`;
        if (archiveError !== run.archiveError) await this.updateRun(run.id, { archiveError });
      }
    }
  }

  private async processJob(job: Job, calendars: Calendar[]): Promise<void> {
    const now = this.now();
    const upcoming = preview(job.rule, calendars, job.cursor, 1);
    const first = upcoming.occurrences[0];
    if (!first) {
      if (upcoming.notice && upcoming.notice !== job.error) throw new Error(upcoming.notice);
      return;
    }
    if (new Date(first.scheduledAt).getTime() > now.getTime()) return;
    const result = preview(job.rule, calendars, job.cursor, 750);
    const due = result.occurrences.filter(
      (item) => new Date(item.scheduledAt).getTime() <= now.getTime(),
    );
    const latest = due.at(-1);
    if (due.length === 750)
      throw new Error(
        "The backlog exceeds the automatic recovery limit. Review history, then save the schedule again to reset its starting point.",
      );
    if (!latest) {
      if (result.occurrences.length === 0 && result.notice && result.notice !== job.error)
        throw new Error(result.notice);
      return;
    }
    // Do not partially replay a long outage when the latest due date is beyond known calendar data.
    const lastKnown = result.occurrences.at(-1)!;
    if (result.notice && new Date(lastKnown.scheduledAt).getTime() < now.getTime()) {
      const calendar = calendars.find((item) => item.id === job.rule.calendarId)!;
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: job.rule.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      if (today > calendar.validThrough) throw new Error(result.notice);
    }
    if (job.missed === "skip" && now.getTime() - new Date(latest.scheduledAt).getTime() > 90000) {
      await this.store.update((state) => {
        const current = requireJob(state, job.id);
        if (current.revision !== job.revision || !current.enabled) return;
        const calendar = calendarsWithImports(state.calendars).find(
          (item) => item.id === current.rule.calendarId,
        );
        if (!calendar || calendar.version !== latest.calendarVersion) return;
        current.cursor = now.toISOString();
        state.runs.push({
          id: randomUUID(),
          jobId: job.id,
          jobName: job.name,
          jobRevision: job.revision,
          scheduledAt: latest.scheduledAt,
          calendarVersion: latest.calendarVersion,
          status: "skipped",
          agentId: null,
          message: `Skipped ${due.length} missed occurrences`,
          updatedAt: now.toISOString(),
          autoArchive: false,
          archivedAt: null,
          archiveError: null,
        });
        pruneRuns(state);
      });
      return;
    }
    const run = await this.claim(job, latest, true);
    if (run) this.launch(job, run);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.active) await this.active;
    await Promise.allSettled(this.launches);
    await this.store.close();
  }
}
