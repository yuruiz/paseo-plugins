import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { McpBrowser } from "./browser";
import { useServers } from "./query";

type Agent = { id: string; workspaceId?: string | null; archivedAt?: string | null };
type AgentList = Awaited<ReturnType<PluginClientContext["paseo"]["agents"]["list"]>>;

export function contributePills(client: PluginClientContext) {
  const pills = new Map<string, { workspaceId: string; registration: PluginButtonRegistration }>();
  const lifetime = new AbortController();
  let release: (() => Promise<void>) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 2000;
  let snapshotGeneration = 0;
  let snapshotChanges: Map<string, Agent | null> | null = null;
  function Content(props: PluginButtonContentProps) {
    if (props.context !== "agent") return null;
    return (
      <McpBrowser
        key={props.agentId}
        agentId={props.agentId}
        theme={props.theme}
        compact={props.layout.compact}
        frame="popover"
        onOpenTab={() => {
          client.openPanel("mcp-browser", {
            workspaceId: props.workspaceId,
            agentId: props.agentId,
          });
          props.close();
        }}
      />
    );
  }

  function remove(id: string) {
    pills.get(id)?.registration.remove();
    pills.delete(id);
  }
  function add(agent: Agent) {
    if (lifetime.signal.aborted) return;
    if (!agent.workspaceId || agent.archivedAt) {
      remove(agent.id);
      return;
    }
    if (pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    remove(agent.id);
    let registration: PluginButtonRegistration | undefined;
    function PillIcon(props: PluginButtonIconProps) {
      const query = useServers(agent.id);
      const label = query.data ? `MCP ${query.data.servers.length}` : "MCP";
      useEffect(() => {
        registration?.update({ label });
      }, [label]);
      return <Icon name="Plug" size={props.size} color={props.color} />;
    }
    registration = client.addComposerPill({
      id: "mcp",
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      button: {
        title: "MCP 配置与接口浏览器",
        label: "MCP",
        icon: PillIcon,
        behavior: { kind: "popover", Content },
      },
    });
    pills.set(agent.id, { workspaceId: agent.workspaceId, registration });
  }
  function reopen() {
    if (lifetime.signal.aborted || retry) return;
    snapshotGeneration++;
    snapshotChanges = null;
    void release?.().catch(() => undefined);
    release = undefined;
    retry = setTimeout(() => {
      retry = undefined;
      void open();
    }, delay);
    delay = Math.min(delay * 2, 60_000);
  }
  async function snapshot(list: AgentList) {
    if (lifetime.signal.aborted) return;
    delay = 2000;
    const generation = ++snapshotGeneration;
    const changes = new Map<string, Agent | null>();
    snapshotChanges = changes;
    const all = new Map(list.entries.map(({ agent }) => [agent.id, agent as Agent]));
    list.entries.forEach(({ agent }) => add(agent));
    const cursors = new Set<string>();
    let page = list;
    try {
      while (page.pageInfo.hasMore && page.pageInfo.nextCursor) {
        const cursor = page.pageInfo.nextCursor;
        if (cursors.has(cursor)) throw new Error("Repeated agent cursor");
        cursors.add(cursor);
        page = await client.paseo.agents.list({
          page: { limit: 200, cursor },
          signal: lifetime.signal,
        });
        if (lifetime.signal.aborted || generation !== snapshotGeneration) return;
        page.entries.forEach(({ agent }) => all.set(agent.id, agent));
      }
      if (lifetime.signal.aborted || generation !== snapshotGeneration) return;
      // Deltas received during pagination are newer than any bootstrap page.
      changes.forEach((agent, id) => {
        if (agent) all.set(id, agent);
        else all.delete(id);
      });
      snapshotChanges = null;
      for (const id of pills.keys()) if (!all.has(id)) remove(id);
      all.forEach(add);
    } catch {
      if (generation === snapshotGeneration) reopen();
    }
  }
  async function open() {
    try {
      const { subscription } = await client.paseo.agents.list({
        subscribe: {},
        signal: lifetime.signal,
      });
      if (lifetime.signal.aborted) {
        await subscription.release();
        return;
      }
      release = () => subscription.release();
      subscription.subscribe({
        snapshot(list) {
          void snapshot(list);
        },
        update(message) {
          if (lifetime.signal.aborted || message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") {
            snapshotChanges?.set(update.agentId, null);
            remove(update.agentId);
          } else {
            snapshotChanges?.set(update.agent.id, update.agent);
            add(update.agent);
          }
        },
        error: reopen,
      });
    } catch {
      reopen();
    }
  }
  void open();
  return () => {
    lifetime.abort();
    if (retry) clearTimeout(retry);
    void release?.().catch(() => undefined);
    pills.forEach((pill) => pill.registration.remove());
    pills.clear();
  };
}
