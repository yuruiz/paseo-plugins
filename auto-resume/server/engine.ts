import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { defaults, type Job, type Preferences, type ResumeView } from "../shared/contracts";
import { parseReset, validTimezone } from "./detect";
import type { Gateway, Observation } from "./gateway";
import type { Store } from "./store";

export interface Failure {
  agentId: string;
  workspaceId: string | null;
  provider: string;
  text: string;
  key: string;
}
export class ResumeEngine {
  private timers = new Map<string, Cron>();
  private queues = new Map<string, Promise<unknown>>();
  private stopped = false;
  private generations = new Map<string, number>();
  private expectedStarts = new Set<string>();
  private invalidate(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
  }
  private sweep?: ReturnType<typeof setInterval>;
  constructor(
    readonly store: Store,
    private gateway: Gateway,
    private now = Date.now,
  ) {}
  view(id: string): ResumeView {
    const state = this.store.snapshot();
    return { preferences: state.preferences[id] ?? defaults(), job: state.jobs[id] ?? null };
  }
  private serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const work = (this.queues.get(id) ?? Promise.resolve()).then(() => {
      if (this.stopped) throw new Error("Auto-resume is stopping");
      return action();
    });
    const settled = work.catch(() => {});
    this.queues.set(id, settled);
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id);
    });
    return work;
  }
  async start() {
    // A crash during send has an unknown result. Never automatically duplicate it.
    await this.store.update((state) => {
      for (const job of Object.values(state.jobs)) {
        if (job.status === "sending") {
          job.status = "attention";
          job.authorized = false;
          job.note =
            "The previous send result is unknown. Check the conversation and continue manually.";
        }
      }
    });
    Object.values(this.store.snapshot().jobs).forEach((job) => this.arm(job));
    this.sweep = setInterval(() => {
      for (const job of Object.values(this.store.snapshot().jobs)) {
        if (job.status === "waiting" && job.runAt && Date.parse(job.runAt) <= this.now())
          void this.fire(job.agentId, job.id).catch(report);
      }
    }, 30000);
  }
  async configure(id: string, preferences: Preferences) {
    if (!validTimezone(preferences.timezone))
      throw new Error("Enter a valid IANA timezone, such as Europe/London.");
    const turningOff = this.view(id).preferences.enabled && !preferences.enabled;
    if (turningOff) this.invalidate(id);
    return this.serial(id, async () => {
      await this.store.update((state) => {
        state.preferences[id] = preferences;
      });
      let job = this.view(id).job;
      if (turningOff && job) {
        const pending = ["waiting", "detected"].includes(job.status);
        job = {
          ...job,
          status: pending ? "canceled" : job.status,
          authorized: false,
          note: pending
            ? "Auto-resume is off. The pending recovery has been canceled."
            : "Auto-resume is off. No further attempts will be scheduled.",
        };
        await this.save(job);
      } else if (preferences.enabled && job?.status === "detected") {
        job = { ...job, authorized: true };
        if (job.resetAt && Date.parse(job.resetAt) > this.now()) this.setWaiting(job, preferences);
        await this.save(job);
      }
      return this.view(id);
    });
  }
  async detect(failure: Failure) {
    this.expectedStarts.delete(failure.agentId);
    return this.serial(failure.agentId, async () => {
      const generation = this.generations.get(failure.agentId) ?? 0;
      const view = this.view(failure.agentId);
      if (view.job?.failureKey === failure.key) return;
      const observation = await this.gateway.inspect(failure.agentId);
      if (observation.archived || observation.status === "running" || observation.permissions)
        return;
      const retry = view.job?.status === "resumed" && view.job.authorized;
      const attempts = retry ? view.job!.attempts : 0;
      const authorized = retry || view.preferences.enabled;
      const resetAt = parseReset(failure.text, this.now(), view.preferences.timezone);
      // Capture this once for headless restart validation. A failed capture does not
      // prevent normal SDK recovery; after restart it requires manual intervention.
      let transcriptHash: string | null = null;
      try {
        transcriptHash = await this.gateway.captureTranscript(failure.agentId);
      } catch {
        /* explicit fallback below */
      }
      if (generation !== (this.generations.get(failure.agentId) ?? 0)) return;
      const job: Job = {
        id: randomUUID(),
        agentId: failure.agentId,
        workspaceId: failure.workspaceId,
        provider: failure.provider,
        status: "detected",
        detectedAt: new Date(this.now()).toISOString(),
        resetAt,
        runAt: null,
        reason: failure.text.slice(0, 1500),
        note: resetAt
          ? "Quota limit detected. You can schedule a continuation after it resets."
          : "The reset time could not be determined. Please choose a time.",
        attempts,
        authorized,
        lastUserMessageAt: observation.lastUserMessageAt,
        transcriptHash,
        failureKey: failure.key,
      };
      if (authorized && attempts >= view.preferences.maxAttempts) {
        job.status = "attention";
        job.authorized = false;
        job.note =
          "The recovery attempt limit has been reached. Check your quota and continue manually.";
      } else if (authorized && resetAt) this.setWaiting(job, view.preferences);
      await this.save(job);
    });
  }
  async schedule(id: string, jobId: string, explicit?: string) {
    return this.serial(id, async () => {
      const { job, preferences } = this.view(id);
      if (!job || job.id !== jobId) throw new Error("This quota card is outdated. Please refresh.");
      if (!["detected", "waiting", "attention", "canceled"].includes(job.status))
        throw new Error("Recovery cannot be scheduled in the current state.");
      if (job.status === "attention" && job.note.includes("unknown"))
        throw new Error(
          "Check the conversation and continue manually to avoid duplicate messages.",
        );
      const resetAt = explicit ?? job.resetAt;
      if (
        !resetAt ||
        !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(resetAt) ||
        !Number.isFinite(Date.parse(resetAt)) ||
        Date.parse(resetAt) <= this.now() ||
        Date.parse(resetAt) - this.now() > 370 * 86400000
      )
        throw new Error("Choose a future reset time that includes a timezone.");
      const observation = await this.gateway.inspect(id);
      if (!this.unchanged(job, observation))
        throw new Error(
          "The conversation has continued, was archived, or needs approval. This recovery is no longer valid.",
        );
      job.resetAt = new Date(resetAt).toISOString();
      job.authorized = true;
      if (job.status === "attention" || job.status === "canceled") job.attempts = 0;
      this.setWaiting(job, preferences);
      await this.save(job);
      return this.view(id);
    });
  }
  async cancel(id: string, jobId?: string, note = "This recovery has been canceled.") {
    if (!jobId || this.view(id).job?.id === jobId) this.invalidate(id);
    this.expectedStarts.delete(id);
    return this.serial(id, async () => {
      const job = this.view(id).job;
      if (job && (!jobId || job.id === jobId) && job.status !== "sending")
        await this.save({ ...job, status: "canceled", authorized: false, note });
      return this.view(id);
    });
  }
  /** Called synchronously by the turn-start hook, before its async work is queued. */
  started(id: string) {
    if (this.expectedStarts.delete(id)) return Promise.resolve(this.view(id));
    this.invalidate(id);
    const job = this.view(id).job;
    if (job && ["waiting", "detected", "resumed"].includes(job.status))
      return this.cancel(
        id,
        job.id,
        "A new turn has started. The previous recovery has been canceled.",
      );
    return Promise.resolve(this.view(id));
  }
  async completed(id: string) {
    this.expectedStarts.delete(id);
    return this.serial(id, async () => {
      const job = this.view(id).job;
      if (job?.status === "resumed")
        await this.save({ ...job, authorized: false, note: "Resumed. The turn has finished." });
    });
  }
  private unchanged(job: Job, current: Observation): boolean {
    if (
      current.archived ||
      current.permissions ||
      !["idle", "error", "closed"].includes(current.status) ||
      current.provider !== job.provider
    )
      return false;
    if (current.transcriptHash !== undefined)
      return !!job.transcriptHash && current.transcriptHash === job.transcriptHash;
    return current.lastUserMessageAt === job.lastUserMessageAt;
  }
  private setWaiting(job: Job, preferences: Preferences) {
    job.status = "waiting";
    job.runAt = new Date(Date.parse(job.resetAt!) + preferences.bufferSeconds * 1000).toISOString();
    job.note = `The conversation will continue ${preferences.bufferSeconds} seconds after the reset time.`;
  }
  private arm(job: Job) {
    this.timers.get(job.agentId)?.stop();
    this.timers.delete(job.agentId);
    if (this.stopped || job.status !== "waiting" || !job.runAt || !job.authorized) return;
    const at = new Date(Math.max(Date.parse(job.runAt), this.now() + 1000));
    const timer = new Cron(at, { protect: true }, () => {
      void this.fire(job.agentId, job.id).catch(report);
    });
    this.timers.set(job.agentId, timer);
  }
  private async save(job: Job) {
    await this.store.update((state) => {
      state.jobs[job.agentId] = job;
    });
    this.arm(job);
    try {
      await this.gateway.publish(job);
    } catch {
      console.error(
        "Auto-resume card update failed; state remains available in the composer pill.",
      );
    }
  }
  fire(id: string, jobId: string): Promise<void> {
    return this.serial(id, async () => {
      const generation = this.generations.get(id) ?? 0;
      const { job, preferences } = this.view(id);
      if (
        !job ||
        job.id !== jobId ||
        job.status !== "waiting" ||
        !job.authorized ||
        !job.runAt ||
        Date.parse(job.runAt) > this.now()
      )
        return;
      if (job.attempts >= preferences.maxAttempts) {
        await this.save({
          ...job,
          status: "attention",
          authorized: false,
          note: "The recovery attempt limit has been reached.",
        });
        return;
      }
      try {
        const observation = await this.gateway.inspect(id);
        if (!this.unchanged(job, observation)) {
          await this.save({
            ...job,
            status: "canceled",
            authorized: false,
            note: "The conversation has changed or needs approval. No continuation was sent.",
          });
          return;
        }
      } catch {
        // A read failure cannot have submitted a prompt. Retry the read after one minute.
        await this.save({
          ...job,
          runAt: new Date(this.now() + 60000).toISOString(),
          note: "The conversation is temporarily unreachable. Checking again in one minute.",
        });
        return;
      }
      if (this.stopped || generation !== (this.generations.get(id) ?? 0)) return;
      const sending: Job = {
        ...job,
        status: "sending",
        attempts: job.attempts + 1,
        note: "Sending a continuation…",
      };
      // Persist the intent BEFORE sending. A crash/timeout must never cause a blind resend.
      await this.save(sending);
      if (this.stopped || generation !== (this.generations.get(id) ?? 0)) {
        await this.save({
          ...sending,
          status: "canceled",
          authorized: false,
          note: "Canceled before sending.",
        });
        return;
      }
      this.expectedStarts.add(id);
      try {
        await this.gateway.send(sending);
        await this.save({
          ...sending,
          status: "resumed",
          note: "Continuation sent. Waiting for the turn to finish.",
        });
      } catch {
        this.expectedStarts.delete(id);
        await this.save({
          ...sending,
          status: "attention",
          authorized: false,
          note: "The send result is unknown. Check the conversation and continue manually.",
        });
      }
    });
  }
  async stop() {
    this.stopped = true;
    if (this.sweep) clearInterval(this.sweep);
    this.timers.forEach((timer) => timer.stop());
    this.timers.clear();
    await Promise.allSettled(this.queues.values());
    await this.store.close();
  }
}
function report(error: unknown) {
  console.error(
    "Auto-resume task failed:",
    error instanceof Error ? error.message : "unknown error",
  );
}
