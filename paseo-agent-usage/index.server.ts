import { usageSnapshotRpc } from "./shared/snapshot";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createUsageService } from "./server/service";
import { checkForUpdate } from "./server/update-check";
import { usageAgentRpc, usageAgentsGetRpc, usageAgentsSetRpc, usageHostsListRpc, usageHostsSetRpc, usageHostsTestRpc, usagePrefsGetRpc, usagePrefsSetRpc, usageRefreshRpc, usageReportRpc, usageUpdateCheckRpc } from "./shared/usage";

export default function contribute(server: PluginServerContext) {
  const service = createUsageService();
  server.handle(usageSnapshotRpc, () => service.snapshot());
  server.handle(usageReportRpc, (input) => service.report(input.range, input.origin, input.from || input.to ? { from: input.from, to: input.to } : undefined, input.granularity));
  server.handle(usageRefreshRpc, () => service.refresh());
  server.handle(usageAgentRpc, (input) => service.agentReport(input.agent, input.range, input.origin, input.from || input.to ? { from: input.from, to: input.to } : undefined, input.granularity));
  server.handle(usageHostsListRpc, () => service.hostsList());
  server.handle(usageHostsSetRpc, (input) => service.hostsSet(input.hosts));
  server.handle(usageHostsTestRpc, (input) => service.hostTest(input.host));
  server.handle(usageAgentsGetRpc, () => service.agentsGet());
  server.handle(usageAgentsSetRpc, (input) => service.agentsSet(input.agents));
  server.handle(usagePrefsGetRpc, (input) => service.prefsGet(input.locale));
  server.handle(usagePrefsSetRpc, (input) => service.prefsSet(input));
  server.handle(usageUpdateCheckRpc, () => checkForUpdate());
  const offTurnEnded = server.on("agent.turn_ended", () => {
    service.markDirty();
  });
  return () => {
    offTurnEnded();
    service.stop();
  };
}
