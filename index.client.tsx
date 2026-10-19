import type { PluginClientContext, PluginButtonRegistration } from "@getpaseo/plugin/client";
import { z } from "zod";
import { SecretsPopover, SecretsTimeline } from "./client/content.js";
import { RequestTimeline, OutputTimeline } from "./client/review.js";
import { openSecrets, mcpConnection } from "./shared/contracts.js";

export default function contribute(client: PluginClientContext) {
  // Prime the subprocess-owned Paseo API for requests from existing MCP sessions.
  void client.rpc(mcpConnection, {}).catch(() => undefined);
  client.addTimelineRenderer({
    kind: "secrets-request",
    version: 1,
    schema: z.object({ requestId: z.string().uuid() }),
    Component: RequestTimeline,
  });
  client.addTimelineRenderer({
    kind: "secrets-output",
    version: 1,
    schema: z.object({ outputId: z.string().uuid() }),
    Component: OutputTimeline,
  });
  client.addTimelineRenderer({
    kind: "secrets-input",
    version: 1,
    schema: z.object({ requestId: z.string() }),
    Component: SecretsTimeline,
  });
  client.addCommandCenterItem({
    id: "secrets",
    title: "Provide secrets",
    icon: "KeyRound",
    context: "agent",
    async onSelect({ agent, rpc }) {
      await rpc(openSecrets, { agentId: agent.id });
    },
  });
  client.addSlashCommand({
    name: "secrets",
    description: "Open the secure input dialog",
    argumentHint: "",
    context: "agent",
    async onSubmit({ agent, rpc }) {
      await rpc(openSecrets, { agentId: agent.id });
    },
  });
  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  function removeAll() {
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  }
  function register(agent: { id: string; workspaceId?: string | null }) {
    if (pills.has(agent.id)) return;
    if (!agent.workspaceId) return;
    const workspaceId = agent.workspaceId;
    pills.set(
      agent.id,
      client.addComposerPill({
        id: "secrets",
        workspaceId,
        agentId: agent.id,
        button: {
          title: "Provide secrets",
          label: "Secrets",
          icon: "KeyRound",
          behavior: {
            kind: "popover",
            Content: SecretsPopover,
          },
        },
      }),
    );
  }
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return undefined;
      subscription.subscribe({
        snapshot({ entries }) {
          removeAll();
          for (const { agent } of entries) register(agent);
        },
        update(message) {
          if (message.type !== "agent_update") return;
          if (message.payload.kind === "upsert") register(message.payload.agent);
          else {
            pills.get(message.payload.agentId)?.remove();
            pills.delete(message.payload.agentId);
          }
        },
      });
      return undefined;
    })
    .catch(() => undefined);
  return () => {
    lifetime.abort();
    removeAll();
  };
}
