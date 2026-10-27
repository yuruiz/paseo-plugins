import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { createCommandsPopover } from "./popover";

interface Pill {
  workspaceId: string;
  registration: PluginButtonRegistration;
}

export function contributePills(client: PluginClientContext) {
  const lifetime = new AbortController();
  const pills = new Map<string, Pill>();
  const Popover = createCommandsPopover((target) => client.openPanel("commands", target));
  function remove(agentId: string) {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  }
  function register(agent: { id: string; workspaceId?: string | null }) {
    if (lifetime.signal.aborted) return;
    const workspaceId = agent.workspaceId;
    if (!workspaceId) {
      remove(agent.id);
      return;
    }
    if (pills.get(agent.id)?.workspaceId === workspaceId) return;
    remove(agent.id);
    const registration = client.addComposerPill({
      id: "commands",
      agentId: agent.id,
      workspaceId,
      button: {
        title: "Commands",
        label: "Commands",
        icon: "Terminal",
        behavior: {
          kind: "popover",
          Content: Popover,
        },
      },
    });
    pills.set(agent.id, { workspaceId, registration });
  }
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          const listed = new Set(entries.map(({ agent }) => agent.id));
          for (const id of pills.keys()) if (!listed.has(id)) remove(id);
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") register(update.agent);
          else remove(update.agentId);
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("Commands: could not observe agents", error);
    });
  return () => {
    lifetime.abort();
    for (const id of pills.keys()) remove(id);
  };
}
