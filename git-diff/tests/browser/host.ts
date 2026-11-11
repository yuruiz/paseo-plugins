import type { PluginRpcContract } from "@getpaseo/plugin";
import { type SettingsDefinition, settingsRpc } from "@getpaseo/plugin";
import type { SettingsState } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
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

// Capture feedback locally; browser checks never send messages to real agents.
export function usePaseo() {
  return {
    agents: {
      list: async () => ({
        entries: [
          {
            agent: {
              id: "fixture-agent",
              title: "UI fixture",
              cwd: (globalThis as unknown as { fixtureDirectory: string }).fixtureDirectory,
            },
          },
        ],
        pageInfo: { hasMore: false, nextCursor: null },
      }),
      ref: (id: string) => ({
        send: async (message: string, options: unknown) => {
          if ((globalThis as unknown as { feedbackFailure?: boolean }).feedbackFailure)
            throw new Error("Fixture feedback failure");
          (globalThis as unknown as { reviewFeedback?: unknown }).reviewFeedback = {
            id,
            message,
            options,
          };
        },
      }),
    },
  };
}

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
