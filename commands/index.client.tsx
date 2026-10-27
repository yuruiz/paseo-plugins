import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CommandsPanel } from "./client/panel";
import { contributePills } from "./client/pills";

export default function contribute(client: PluginClientContext) {
  client.addAgentPanel({
    id: "commands",
    title: "Commands",
    icon: "Terminal",
    Component: CommandsPanel,
  });
  client.addCommandCenterItem({
    id: "open-commands",
    title: "Commands",
    icon: "Terminal",
    context: "agent",
    keywords: ["commands", "prompts", "slash", "命令"],
    onSelect: ({ openPanel }) => openPanel("commands"),
  });
  return contributePills(client);
}
