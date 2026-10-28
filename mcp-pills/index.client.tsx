import type { PluginClientContext, PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { McpBrowser } from "./client/browser";
import { contributePills } from "./client/pills";

function Panel({ agentId, theme, layout }: PluginAgentPanelProps) {
  return (
    <McpBrowser
      key={agentId}
      agentId={agentId}
      theme={theme}
      compact={layout.compact}
      frame="panel"
    />
  );
}
export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "mcp-browser",
    title: "MCP",
    icon: "Plug",
    context: "agent",
    Component: Panel,
  });
  client.addCommandCenterItem({
    id: "open-mcp",
    title: "MCP 配置与接口浏览器",
    icon: "Plug",
    context: "agent",
    keywords: ["mcp", "tools", "resources", "prompts"],
    onSelect: ({ openPanel }) => openPanel("mcp-browser"),
  });
  return contributePills(client);
}
