import { useAgent, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { listCommands } from "../shared/commands";

export function useCommandCatalog(agentId: string) {
  const agent = useAgent(agentId, ({ title, provider, cwd }) => ({ title, provider, cwd }));
  const list = useRpc(listCommands);
  const query = useQuery({
    queryKey: ["commands", "list", agentId, agent?.cwd, agent?.provider],
    queryFn: () => list({ agentId }),
    enabled: agent !== null,
    retry: false,
    staleTime: 10_000,
  });
  return { agent, query };
}
