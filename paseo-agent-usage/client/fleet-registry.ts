import type { UsageSnapshot } from "../shared/snapshot";

export interface FleetEndpoint {
  key: number;
  read(): Promise<UsageSnapshot>;
  refresh(): Promise<unknown>;
  cached?: UsageSnapshot;
}

export function createFleetRegistry() {
  let nextKey = 0;
  let entries: readonly FleetEndpoint[] = [];
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => entries,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    register(read: () => Promise<UsageSnapshot>, refresh: () => Promise<unknown>) {
      let active = true;
      let pending: Promise<UsageSnapshot> | undefined;
      const entry: FleetEndpoint = {
        key: ++nextKey, refresh,
        read() {
          if (!active) return Promise.reject(new Error("Usage source removed"));
          if (pending) return pending;
          pending = withDeadline(read).then((snapshot) => {
            if (active) entry.cached = snapshot;
            return snapshot;
          }).finally(() => { pending = undefined; });
          return pending;
        },
      };
      entries = [...entries, entry];
      notify();
      return () => {
        if (!active) return;
        active = false;
        entries = entries.filter((candidate) => candidate !== entry);
        entry.cached = undefined;
        notify();
      };
    },
  };
}

export async function withDeadline<T>(call: () => Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Usage source unavailable")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Paseo evaluates every installation in the same app JS runtime. A versioned symbol
// shares only this plugin's own RPC callbacks, without private host APIs or sockets.
// Each installation registers at entry time, including hosts with no visible surface.
const key = Symbol.for("paseo-agent-usage.fleet.v1");
export const fleetRegistry: ReturnType<typeof createFleetRegistry> =
  Reflect.get(globalThis, key) ?? createFleetRegistry();
Reflect.set(globalThis, key, fleetRegistry);
