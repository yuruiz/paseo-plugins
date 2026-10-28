import { useAgent, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { listServers, inspectServer, type ServerEntry, type Inspection } from "../shared/contracts";

export function inspectionOptions(
  agentId: string,
  server: Pick<ServerEntry, "id" | "revision">,
  inspect: (input: { agentId: string; serverId: string; revision: string }) => Promise<Inspection>,
) {
  return {
    queryKey: ["mcp-inspect", agentId, server.id, server.revision],
    queryFn: () => inspect({ agentId, serverId: server.id, revision: server.revision }),
    enabled: false,
    retry: false,
    staleTime: Infinity,
  } as const;
}

/** Rows observe the same manual inspection as details, without opening connections. */
export function useInspection(agentId: string, server: ServerEntry) {
  const inspect = useRpc(inspectServer);
  return useQuery(inspectionOptions(agentId, server, inspect));
}

export function useServers(agentId: string) {
  const agent = useAgent(agentId, (snapshot) => ({
    cwd: snapshot.cwd,
    provider: snapshot.provider,
  }));
  const list = useRpc(listServers);
  return useQuery({
    queryKey: ["mcp-config", agentId, agent?.cwd, agent?.provider],
    queryFn: () => list({ agentId }),
    enabled: Boolean(agent?.cwd),
    staleTime: 30_000,
    retry: false,
  });
}
