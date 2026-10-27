import type { Command } from "../shared/commands";
import { defaultRoots, discoverCommands, type CommandRoots } from "./discovery";
import { invocationText } from "./invocation";

interface ReportedCommand {
  name: string;
  description: string;
  argumentHint?: string;
  kind?: string;
}

export interface CommandAgent {
  cwd: string;
  provider: string;
  busy: boolean;
  archived: boolean;
  commands(): Promise<{ commands: ReportedCommand[]; error?: string | null }>;
  send(text: string): Promise<void>;
}

export async function commandCatalog(agent: CommandAgent, roots: CommandRoots = defaultRoots()) {
  const discovered = await discoverCommands({ cwd: agent.cwd, provider: agent.provider, roots });
  let reported: ReportedCommand[] = [];
  try {
    const response = await agent.commands();
    if (response.error) discovered.warnings.push(`Session commands: ${response.error}`);
    else reported = response.commands.filter((command) => command.kind !== "skill");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    discovered.warnings.push(`Session commands: ${message}`);
  }
  const live = new Map(reported.map((command) => [command.name.replace(/^\//, ""), command]));
  const claimed = new Map<string, string>();
  const commands: Command[] = discovered.files.map((file) => {
    const { body: _body, nativeName, ...command } = file;
    const key = `${nativeName === null ? "template" : "native"}:${command.name}`;
    const winner = claimed.get(key);
    if (winner) return { ...command, shadowedBy: winner };
    claimed.set(key, command.path);
    const native = nativeName !== null && live.has(nativeName);
    if (!native) return command;
    live.delete(nativeName);
    return { ...command, mode: "native" };
  });
  for (const [name, command] of live) {
    commands.push({
      id: `session:${name}`,
      name,
      description: command.description,
      argumentHint: command.argumentHint ?? "",
      scope: "session",
      path: null,
      mode: "native",
      shadowedBy: null,
    });
  }
  return {
    cwd: agent.cwd,
    provider: agent.provider,
    commands,
    directories: discovered.directories,
    warnings: discovered.warnings,
  };
}

export async function commandBody(
  agent: CommandAgent,
  commandId: string,
  roots: CommandRoots = defaultRoots(),
): Promise<string> {
  const { files } = await discoverCommands({ cwd: agent.cwd, provider: agent.provider, roots });
  const file = files.find((entry) => entry.id === commandId);
  if (!file) throw new Error("Command file is no longer available. Refresh the list.");
  return file.body;
}

interface InvokeInput {
  commandId: string;
  args: string;
  mode: Command["mode"];
}

export async function sendCommand(
  agent: CommandAgent,
  input: InvokeInput,
  roots: CommandRoots = defaultRoots(),
) {
  if (agent.archived) throw new Error("This agent is archived.");
  if (agent.busy)
    throw new Error("Wait for the agent to finish its current turn before running a command.");
  const catalog = await commandCatalog(agent, roots);
  const command = catalog.commands.find((entry) => entry.id === input.commandId);
  if (!command) throw new Error("Command is no longer available. Refresh the list.");
  if (command.mode !== input.mode)
    throw new Error("Command availability changed. Refresh the list before sending.");
  const body = command.mode === "template" ? await commandBody(agent, command.id, roots) : "";
  const text = invocationText(command, body, input.args);
  await agent.send(text);
  return { message: `Sent ${command.name} to the agent.` };
}
