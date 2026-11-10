import React, { useMemo, useRef, useState, type RefObject } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { copyText, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { rewindOptions, rewindRpc, type RewindMode } from "../../shared/rewind-rpc";
import { prepareRewindComposerRestore } from "../web";
import { Glyph } from "./glyph";
import type { ExtendedThemeTokens } from "./theme-tokens";

export function RewindAction({ hostId, agentId, messageId, text, surface, tokens }: {
  hostId: string;
  agentId: string;
  messageId: string;
  text: string;
  surface: RefObject<View | null>;
  tokens: ExtendedThemeTokens;
}) {
  const paseo = usePaseo();
  const rewind = useRpc(rewindRpc);
  const toast = useToast();
  const handle = useMemo(() => paseo.agents.ref(agentId), [paseo, agentId]);
  const capabilities = useQuery({
    queryKey: ["beautiful-chat", "rewind-capabilities", hostId, agentId],
    queryFn: async () => (await handle.refresh())?.agent.capabilities ?? null,
    staleTime: 30_000,
    retry: false,
  });
  const options = rewindOptions(capabilities.data);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<RewindMode | null>(null);
  const locked = useRef(false);

  async function submit(mode: RewindMode) {
    if (locked.current) return;
    locked.current = true;
    setPending(mode);
    const restore = prepareRewindComposerRestore(surface.current);
    try {
      await rewind({ hostId, agentId, messageId, mode });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rewind agent");
      locked.current = false;
      setPending(null);
      return;
    }
    setOpen(false);
    try {
      if (mode !== "files" && !restore(text)) {
        await copyText(text);
        toast.show("Prompt copied. Paste it into the composer to edit.");
      }
    } catch {
      toast.error("Rewound successfully, but the prompt could not be restored or copied.");
    } finally {
      locked.current = false;
      setPending(null);
    }
  }

  if (options.length === 0) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Rewind to this message"
        onPress={() => setOpen(true)}
        disabled={pending !== null}
        style={{ paddingHorizontal: 4, paddingVertical: 2 }}
      >
        <Glyph name="Undo2" size={13} color={tokens.userTextMuted} />
      </Pressable>
      <Modal title="Rewind to this message" open={open} onOpenChange={(next) => {
        if (!locked.current) setOpen(next);
      }}>
        <Modal.Content>
          <Text style={{ color: tokens.foregroundMuted }}>This action cannot be undone.</Text>
          {options.map(({ mode, label }) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: pending !== null, busy: pending === mode }}
              disabled={pending !== null}
              onPress={() => void submit(mode)}
              style={{ padding: 12, borderRadius: 8, backgroundColor: tokens.surface2 }}
            >
              <Text style={{ color: tokens.foreground }}>{pending === mode ? "Rewinding…" : label}</Text>
            </Pressable>
          ))}
        </Modal.Content>
      </Modal>
    </>
  );
}
