import type { RpcInput } from "@getpaseo/plugin";
import { rewindRpc } from "../shared/rewind-rpc";
import { withDaemon } from "./daemon";

export async function rewindAgent(input: RpcInput<typeof rewindRpc>) {
  return withDaemon(input.hostId, async (client) => {
    await client.rewindAgent(input.agentId, input.messageId, input.mode);
    return {};
  });
}
