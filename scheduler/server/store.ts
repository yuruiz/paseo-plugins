import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { stateSchema, type State } from "../shared/model";

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  private compromised: Error | null = null;
  private closed = false;

  private constructor(
    private directory: string,
    private state: State,
    private unlock: () => Promise<void>,
  ) {}

  static async open(directory: string, daemonHome?: string): Promise<Store> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let store: Store | null = null;
    let lockError: Error | null = null;
    const unlock = await lockfile.lock(directory, {
      retries: 0,
      stale: 30000,
      update: 10000,
      onCompromised(error) {
        lockError = error;
        if (store) store.compromised = error;
      },
    });
    try {
      if (daemonHome) {
        const target = await realpath(daemonHome);
        if ((await realpath(directory)) === target)
          throw new Error("The scheduler data directory must differ from the daemon home");
        const binding = join(directory, "daemon-home");
        try {
          if ((await readFile(binding, "utf8")).trim() !== target)
            throw new Error(
              "This data directory is bound to another daemon; choose a separate directory",
            );
        } catch (error) {
          if (!isMissing(error)) throw error;
          await writeFile(binding, `${target}\n`, { flag: "wx", mode: 0o600 });
        }
      }
      let state: State;
      try {
        state = stateSchema.parse(
          JSON.parse(await readFile(join(directory, "state.json"), "utf8")),
        );
      } catch (error) {
        if (!isMissing(error)) throw error;
        state = { version: 1, revision: 0, jobs: [], calendars: [], runs: [] };
      }
      for (const records of [state.jobs, state.calendars, state.runs]) {
        if (new Set(records.map((item) => item.id)).size !== records.length)
          throw new Error("Stored data contains duplicate IDs");
      }
      store = new Store(directory, state, unlock);
      store.compromised = lockError;
      return store;
    } catch (error) {
      await unlock();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("The scheduler is stopping");
    if (this.compromised) throw this.compromised;
  }

  snapshot(): State {
    this.assertOpen();
    return structuredClone(this.state);
  }

  update(change: (state: State) => void): Promise<State> {
    const operation = this.queue.then(async () => {
      this.assertOpen();
      const next = structuredClone(this.state);
      change(next);
      next.revision += 1;
      const checked = stateSchema.parse(next);
      const temporary = join(this.directory, `.state-${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(checked, null, 2));
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        this.assertOpen();
        await rename(temporary, join(this.directory, "state.json"));
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      this.state = checked;
      return this.snapshot();
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async close(): Promise<void> {
    await this.queue;
    if (this.closed) return;
    this.closed = true;
    await this.unlock();
  }
}
