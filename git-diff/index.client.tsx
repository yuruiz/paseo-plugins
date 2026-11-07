import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ChangesPanel } from "./client/changes-panel";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: "changes",
    title: "Git Changes",
    icon: "GitCompare",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: ChangesPanel,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "open-changes",
    title: "Git Diff · 分支与提交 Review",
    icon: "GitCompare",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("changes");
    },
  });
  return () => {
    removeCommand();
    removePanel();
  };
}
