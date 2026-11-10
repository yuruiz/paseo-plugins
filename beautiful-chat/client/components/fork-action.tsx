import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { forkRpc } from "../../shared/fork-rpc";
import { Glyph } from "./glyph";
import type { ExtendedThemeTokens } from "./theme-tokens";

function newRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 3) | 8).toString(16);
  });
}

export function ForkAction({ hostId, agentId, messageId, tokens }: {
  hostId: string; agentId: string; messageId: string; tokens: ExtendedThemeTokens;
}) {
  const paseo = usePaseo();
  const fork = useRpc(forkRpc);
  const toast = useToast();
  const handle = useMemo(() => paseo.agents.ref(agentId), [paseo, agentId]);
  const provider = useQuery({
    queryKey: ["beautiful-chat", "fork-provider", hostId, agentId],
    queryFn: async () => (await handle.refresh())?.agent.provider ?? null,
    staleTime: 30_000,
    retry: false,
  });
  const requestId = useRef<string | null>(null);
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  async function submit() {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    try {
      requestId.current ??= newRequestId();
      const result = await fork({ hostId, agentId, messageId, requestId: requestId.current });
      setCreated(result.agentId);
      toast.show("Fork created in this workspace.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to fork conversation");
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  if (provider.data !== "codex" && provider.data !== "claude") return null;
  const label = pending ? "Forking…" : created ? "Open fork" : "Fork from this reply";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: pending, busy: pending }}
      ref={(node) => {
        if (Platform.OS === "web" && typeof HTMLElement !== "undefined" && node instanceof HTMLElement) {
          node.title = label;
        }
      }}
      disabled={pending}
      onPress={() => {
        if (created) {
          void Linking.openURL(`paseo://h/${encodeURIComponent(hostId)}/agent/${encodeURIComponent(created)}`)
            .catch(() => toast.error("Could not open the fork. It is available in this workspace."));
        } else void submit();
      }}
      style={{ paddingHorizontal: 6, paddingVertical: 3 }}
      hitSlop={6}
    >
      {pending ? <ActivityIndicator size={13} color={tokens.foregroundMuted} /> :
        <Glyph name={created ? "ExternalLink" : "GitFork"} size={13} color={tokens.foregroundMuted} />}
    </Pressable>
  );
}
