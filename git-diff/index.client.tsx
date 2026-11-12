import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { ChangesPanel } from "./client/changes-panel";
import { reviewCommentSource } from "./shared/review-comments";

function Editor(client: PluginClientContext, props: PluginWorkspacePanelProps) {
  return (
    <ChangesPanel
      {...props}
      presentation="editor"
      onOpenSidebar={() =>
        client.openPanel("review", { workspaceId: props.workspaceId, location: "explorer" })
      }
    />
  );
}
function Sidebar(client: PluginClientContext, props: PluginWorkspacePanelProps) {
  const openDiff = () =>
    client.openPanel("changes", { workspaceId: props.workspaceId, location: "workspace" });
  return <ChangesPanel {...props} presentation="sidebar" onOpenDiff={openDiff} />;
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addAttachmentSource(reviewCommentSource),
    client.addWorkspacePanel({
      id: "changes",
      title: "Git Diff",
      icon: "GitCompare",
      context: "workspace",
      locations: ["workspace"],
      Component: Editor.bind(null, client),
    }),
    client.addWorkspacePanel({
      id: "review",
      title: "Git Review",
      icon: "GitBranch",
      context: "workspace",
      locations: ["explorer"],
      Component: Sidebar.bind(null, client),
    }),
    client.addCommandCenterItem({
      id: "open-changes",
      title: "Git Diff · 分支与提交 Review",
      icon: "GitCompare",
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel("review", { location: "explorer" });
        openPanel("changes", { location: "workspace" });
      },
    }),
  ];
  return () => {
    for (const remove of removers.reverse()) remove();
  };
}
