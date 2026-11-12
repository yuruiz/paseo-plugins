import type { PluginServerContext } from "@getpaseo/plugin/server";
import { fileCapabilities } from "./server/files";
import { mermaidRuntime } from "./server/generated/mermaid";
import { GitChangesService } from "./server/service";
import { compareFileDiffRpc, compareRpc } from "./shared/compare-contracts";
import {
  changesRpc,
  fileCapabilitiesRpc,
  fileContentRpc,
  fileDiffRpc,
  mermaidRuntimeRpc,
  resolveLinkRpc,
  revealFileRpc,
} from "./shared/contracts";
import { commitFileDiffRpc, commitRpc, historyRpc } from "./shared/history-contracts";
import { reviewDraftSettings, searchReviewComments } from "./shared/review-comments";
import { panelSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const service = new GitChangesService();
  server.registerSettings(panelSettings);
  server.registerSettings(reviewDraftSettings);
  server.handle(searchReviewComments, () => ({ items: [] }));
  server.handle(changesRpc, (input) => service.snapshot(input));
  server.handle(compareRpc, (input) => service.compare(input));
  server.handle(compareFileDiffRpc, (input) => service.compareDiff(input));
  server.handle(historyRpc, (input) => service.history(input));
  server.handle(commitRpc, (input) => service.commit(input));
  server.handle(commitFileDiffRpc, (input) => service.commitDiff(input));
  server.handle(fileDiffRpc, (input) => service.diff(input));
  server.handle(fileContentRpc, (input) => service.content(input));
  server.handle(fileCapabilitiesRpc, () => fileCapabilities());
  server.handle(revealFileRpc, (input) => service.reveal(input));
  server.handle(resolveLinkRpc, (input) => service.resolveLink(input));
  server.handle(mermaidRuntimeRpc, () => mermaidRuntime);
  return () => service.close();
}
