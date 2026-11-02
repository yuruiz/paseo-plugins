import type { PluginClientContext } from "@getpaseo/plugin/client";
import { showCard } from "../shared/contracts";
import { needsLogin } from "../shared/detection";

type Agent = { id: string; status: string; lastError?: string; archivedAt?: string | null };
// Covers startup failures and failures that predate plugin installation. The server verifies
// the current snapshot again; client-provided error text never creates a card.
export function observeFailures(client: PluginClientContext): () => void {
  const lifetime = new AbortController();
  const seen = new Set<string>();
  let release: (() => Promise<void>) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 2000;
  let generation = 0;
  function inspect(agent: Agent) {
    if (lifetime.signal.aborted) return;
    if (agent.archivedAt || agent.status !== "error" || !needsLogin(agent.lastError ?? "")) {
      seen.delete(agent.id);
      return;
    }
    if (seen.has(agent.id)) return;
    seen.add(agent.id);
    void client
      .rpc(showCard, { agentId: agent.id, automatic: true })
      .catch(() => seen.delete(agent.id));
  }
  function reopen() {
    generation++;
    void release?.().catch(() => undefined);
    release = undefined;
    if (lifetime.signal.aborted || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      void open();
    }, delay);
    delay = Math.min(delay * 2, 30000);
  }
  async function open() {
    try {
      const result = await client.paseo.agents.list({
        subscribe: {},
        filter: { includeArchived: false },
        signal: lifetime.signal,
      });
      if (lifetime.signal.aborted) {
        await result.subscription.release();
        return;
      }
      release = () => result.subscription.release();
      result.subscription.subscribe({
        snapshot(first) {
          const epoch = ++generation;
          seen.clear();
          delay = 2000;
          void (async () => {
            let page: Awaited<ReturnType<typeof client.paseo.agents.list>> = first;
            const cursors = new Set<string>();
            while (!lifetime.signal.aborted && epoch === generation) {
              for (const { agent } of page.entries) inspect(agent);
              const cursor = page.pageInfo.nextCursor;
              if (!page.pageInfo.hasMore || !cursor || cursors.has(cursor)) return;
              cursors.add(cursor);
              page = await client.paseo.agents.list({
                page: { limit: 200, cursor },
                filter: { includeArchived: false },
                signal: lifetime.signal,
              });
            }
          })().catch(reopen);
        },
        update(message) {
          if (message.type === "agent_update") {
            if (message.payload.kind === "remove") seen.delete(message.payload.agentId);
            else inspect(message.payload.agent);
          }
        },
        error: reopen,
      });
    } catch {
      reopen();
    }
  }
  void open();
  return () => {
    lifetime.abort();
    generation++;
    if (retry) clearTimeout(retry);
    void release?.().catch(() => undefined);
    seen.clear();
  };
}
