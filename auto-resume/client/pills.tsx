import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { ResumePopover } from "./controls";
import { useResumeStatus } from "./status";

type Agent = {
  provider?: string;
  id: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
};
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
      <ResumePopover agentId={props.agentId} theme={props.theme} compact={props.layout.compact} />
    );
  }

  function remove(id: string) {
    pills.get(id)?.registration.remove();
    pills.delete(id);
  }
  function add(agent: Agent) {
    if (lifetime.signal.aborted) return;
    if (
      !agent.workspaceId ||
      agent.archivedAt ||
      !["claude", "codex"].includes(agent.provider ?? "")
    ) {
      remove(agent.id);
      return;
    }
    if (pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    remove(agent.id);
    let registration: PluginButtonRegistration | undefined;
    function PillIcon(props: PluginButtonIconProps) {
      const query = useResumeStatus(agent.id);
      const label =
        query.data?.job?.status === "waiting"
          ? "Waiting for quota reset"
          : query.data?.preferences.enabled
            ? "Auto-resume: On"
            : "Auto-resume: Off";
      useEffect(() => {
        registration?.update({ label });
      }, [label]);
      return <Icon name="Clock" size={props.size} color={props.color} />;
    }
    registration = client.addComposerPill({
      id: "auto-resume",
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      button: {
        title: "Auto-resume",
        label: "Auto Resume",
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
        await subscription?.release();
        return;
      }
      if (!subscription) throw new Error("Agent observation unavailable");
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
