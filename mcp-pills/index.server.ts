import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { listServers, inspectServer } from "./shared/contracts";
import { discover } from "./server/discovery";
import { inspect } from "./server/inspect";

async function load(agentId: string, { paseo }: PluginHandlerContext) {
  const handle = paseo.agents.ref(agentId);
  const snapshot = await handle.refresh();
  const agent = snapshot?.agent ?? handle.current();
  if (!agent) throw new Error("找不到当前 agent。");
  return { agent, ...(await discover({ id: agentId, provider: agent.provider, cwd: agent.cwd })) };
}

export default function contribute(server: PluginServerContext) {
  const pending = new Map<string, Promise<Awaited<ReturnType<typeof inspect>>>>();
  const lifetime = new AbortController();
  server.handle(listServers, async ({ agentId }, context) => {
    const { agent, servers, warnings } = await load(agentId, context);
    return { provider: agent.provider, servers: servers.map((server) => server.entry), warnings };
  });
  server.handle(inspectServer, async ({ agentId, serverId, revision }, context) => {
    const { agent, servers } = await load(agentId, context);
    const target = servers.find((server) => server.entry.id === serverId);
    if (!target || target.entry.revision !== revision)
      throw new Error("配置已变化，请刷新服务列表后重试。");
    const key = `${agentId}:${serverId}:${revision}`;
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= 4) throw new Error("正在浏览的服务较多，请稍后重试。");
    const work = inspect(target, agent.cwd, lifetime.signal).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  });
  return async () => {
    lifetime.abort();
    await Promise.allSettled(pending.values());
  };
}
