import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { commandBody, commandCatalog, sendCommand, type CommandAgent } from "./server/commands";
import { defaultRoots } from "./server/discovery";
import { resolveProvider } from "./server/provider";
import { invokeCommand, listCommands, readCommand } from "./shared/commands";

export async function loadAgent(
  agentId: string,
  { paseo }: PluginHandlerContext,
): Promise<CommandAgent> {
  const handle = paseo.agents.ref(agentId);
  const refreshed = await handle.refresh();
  const agent = refreshed?.agent;
  if (!agent) throw new Error("Agent is unavailable. Reopen Commands from an active agent.");
  const { config } = await paseo.config.get();
  const resolved = resolveProvider(agent.provider, config.providers);
  return {
    cwd: agent.cwd,
    provider: agent.provider,
    discoveryProvider: resolved.provider,
    roots: defaultRoots(resolved.env),
    busy: agent.status === "running" || agent.status === "initializing",
    archived: Boolean(agent.archivedAt),
    commands: () => handle.commands(),
    send: (text) => handle.send(text),
  };
}

export default function contribute(server: PluginServerContext) {
  server.handle(listCommands, async ({ agentId }, context) =>
    commandCatalog(await loadAgent(agentId, context)),
  );
  server.handle(readCommand, async ({ agentId, commandId }, context) => ({
    body: await commandBody(await loadAgent(agentId, context), commandId),
  }));
  server.handle(invokeCommand, async (input, context) =>
    sendCommand(await loadAgent(input.agentId, context), input),
  );
  return () => {};
}
