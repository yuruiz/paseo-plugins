import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { statusRpc } from "../shared/contracts";
export const statusKey = (agentId: string) => ["auto-resume", agentId] as const;
export function useResumeStatus(agentId: string) {
  const read = useRpc(statusRpc);
  return useQuery({
    queryKey: statusKey(agentId),
    queryFn: () => read({ agentId }),
    refetchInterval: 5000,
    staleTime: 2000,
  });
}
