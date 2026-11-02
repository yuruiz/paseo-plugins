import { mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { stateSchema, type State } from "../shared/contracts";
import { englishNote } from "./legacy-notes";

export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private compromised: Error | null = null;
  private constructor(
    private directory: string,
    private state: State,
    private unlock: () => Promise<void>,
  ) {}
  static async open(directory: string, daemonHome: string): Promise<Store> {
    // Resolve the existing home before creating anything. Never invent a missing daemon home.
    const home = await realpath(daemonHome);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await realpath(directory)) === home)
      throw new Error("Use a separate auto-resume data directory");
    let store: Store | undefined;
    const unlock = await lockfile.lock(directory, {
      retries: 0,
      stale: 30000,
      update: 10000,
      onCompromised(error) {
        if (store) store.compromised = error;
      },
    });
    try {
      const binding = join(directory, "daemon-home");
      try {
        if ((await readFile(binding, "utf8")).trim() !== home)
          throw new Error("Auto-resume data belongs to another daemon");
      } catch (error) {
        if (!missing(error)) throw error;
        await import("node:fs/promises").then((fs) =>
          fs.writeFile(binding, home, { flag: "wx", mode: 0o600 }),
        );
      }
      let state: State = { version: 1, preferences: {}, jobs: {} };
      try {
        state = stateSchema.parse(
          JSON.parse(await readFile(join(directory, "state.json"), "utf8")),
        );
      } catch (error) {
        if (!missing(error)) throw error;
      }
      for (const job of Object.values(state.jobs)) job.note = englishNote(job.note);
      store = new Store(directory, state, unlock);
      return store;
    } catch (error) {
      await unlock();
      throw error;
    }
  }
  snapshot(): State {
    return structuredClone(this.state);
  }
  update(change: (next: State) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.closed) throw new Error("Auto-resume is stopping");
      if (this.compromised) throw this.compromised;
      const next = this.snapshot();
      change(next);
      stateSchema.parse(next);
      const temporary = join(this.directory, `.state-${randomUUID()}.tmp`);
      try {
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify(next));
          await file.sync();
        } finally {
          await file.close();
        }
        if (this.compromised) throw this.compromised;
        await rename(temporary, join(this.directory, "state.json"));
        this.state = next;
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async close() {
    if (this.closed) return;
    await this.queue;
    if (this.closed) return;
    this.closed = true;
    await this.unlock();
  }
}
function missing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
