import type { PluginRpcContract } from "@getpaseo/plugin";
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
