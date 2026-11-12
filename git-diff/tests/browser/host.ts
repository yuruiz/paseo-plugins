import type { PluginRpcContract } from "@getpaseo/plugin";
import { type SettingsDefinition, settingsRpc } from "@getpaseo/plugin";
import type { PluginComposer, SettingsState } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import type { input, output, ZodType } from "zod";

export async function openExternalUrl(url: string) {
  const host = globalThis as unknown as {
    open(url: string, target: string, features: string): { opener: unknown } | null;
  };
  const opened = host.open(url, "_blank", "noopener,noreferrer");
  // A noopener window intentionally has no handle; the real host uses its platform opener.
  if (opened) opened.opener = null;
}

export function useRpc<I extends ZodType, O extends ZodType>(contract: PluginRpcContract<I, O>) {
  return useCallback(
    async (value: input<I>): Promise<output<O>> => {
      const response = await fetch("/api/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: contract.name, input: value }),
      });
      const result = (await response.json()) as { error?: string; data?: unknown };
      if (!response.ok) throw new Error(result.error ?? "RPC failed");
      return contract.output.parse(result.data);
    },
    [contract],
  );
}
// The acceptance entry renders WorkspaceChanges directly; the real plugin reads Paseo's cache.
export function useWorkspace() {
  throw new Error("Use the real Paseo host for workspace selection.");
}

// Model the public composer API; browser checks never send agent messages.
const listeners = new Set<() => void>();
let revision = 0;
let agentIds = ["fixture-agent", "fixture-other", "foreign-agent"];
const models = new Map<string, PluginComposer>();
function notify() {
  revision++;
  for (const listener of listeners) listener();
}
function model(id: string): PluginComposer {
  let composer = models.get(id);
  if (!composer) {
    composer = {
      context: "agent",
      prompt: "existing prompt",
      attachments: [],
      agent: {
        provider: "codex",
        model: null,
        mode: null,
        thinking: null,
        options: {},
        metadata: {},
      },
      setPrompt(prompt) {
        models.set(id, { ...model(id), prompt });
        notify();
      },
      insertText(text) {
        models.set(id, { ...model(id), prompt: model(id).prompt + text });
        notify();
      },
      focus: async () => {},
      setProvider: async () => {},
      setModel: async () => {},
      setMode: async () => {},
      setThinking: async () => {},
      setOptions: async () => {},
      setMetadata: async () => {},
      addAttachment(input) {
        if ((globalThis as unknown as { composerFailure?: boolean }).composerFailure)
          throw new Error("Fixture attachment failure");
        const current = model(id);
        if (
          !current.attachments.some(
            (item) => item.sourceId === input.sourceId && item.item.id === input.item.id,
          )
        ) {
          models.set(id, { ...current, attachments: [...current.attachments, input] });
          notify();
        }
      },
      removeAttachment(input) {
        const current = model(id);
        if (
          current.attachments.some(
            (item) => item.sourceId === input.sourceId && item.item.id === input.itemId,
          )
        ) {
          models.set(id, {
            ...current,
            attachments: current.attachments.filter(
              (item) => item.sourceId !== input.sourceId || item.item.id !== input.itemId,
            ),
          });
          notify();
        }
      },
    } as PluginComposer;
    models.set(id, composer);
  }
  return composer;
}
function useRevision() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => revision,
  );
}
export function useComposers(selector: { agentId: string }) {
  useRevision();
  return agentIds.includes(selector.agentId) ? [model(selector.agentId)] : [];
}
export function useAgents(
  query: {
    where?(agent: { id: string; workspaceId: string; cwd: string; hostId: string }): boolean;
  } = {},
) {
  useRevision();
  const cwd = (globalThis as unknown as { fixtureDirectory: string }).fixtureDirectory;
  return agentIds
    .filter(
      (id) =>
        !query.where ||
        query.where({
          id,
          workspaceId: id === "foreign-agent" ? "foreign" : "fixture",
          cwd: id === "foreign-agent" ? "/foreign" : cwd,
          hostId: "fixture-host",
        }),
    )
    .map((id) => ({ kind: "agent" as const, id, hostId: "fixture-host", key: id }));
}
(globalThis as unknown as { composerFixture: unknown }).composerFixture = {
  get(id = "fixture-agent") {
    return model(id);
  },
  addAgent(id: string) {
    agentIds = [...agentIds, id];
    notify();
  },
};

export function useSettings<Schema extends ZodType>(
  definition: SettingsDefinition<Schema>,
): SettingsState<Schema> {
  const contracts = settingsRpc(definition.id);
  const read = useRpc(contracts.read);
  const write = useRpc(contracts.write);
  const client = useQueryClient();
  const key = ["fixture-settings", definition.id];
  const query = useQuery({ queryKey: key, queryFn: () => read({}) });
  return {
    ...(query.data ?? { status: "loading" as const }),
    saving: false,
    saveError: null,
    save: async (values: output<Schema>, revision: string) => {
      const result = await write(contracts.write.input.parse({ values, revision }));
      if (result.status !== "saved") return false;
      client.setQueryData(key, { ...result, status: "ready" });
      return true;
    },
    reset: async () => false,
    reload: async () => {
      await query.refetch();
    },
  } as SettingsState<Schema>;
}
