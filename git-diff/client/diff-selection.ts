/// <reference lib="dom" />
import { type RefObject, useEffect, useRef, useState } from "react";
import { Platform, type View } from "react-native";
import type { DiffLine, FileDiff } from "../shared/contracts";

type Side = "old" | "new";
type CodeSelection = { line: DiffLine; side: Side; left: number; top: number };

export function useDiffSelection(
  rootRef: RefObject<View | null>,
  source: FileDiff,
  onComment?: (line: DiffLine, side: Side, source: FileDiff) => void,
) {
  const [selected, setSelected] = useState<CodeSelection | null>(null);
  const current = useRef({ source, onComment });
  current.current = { source, onComment };
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const root = rootRef.current as unknown as HTMLElement | null;
    if (!root) return;
    setSelected(null);
    let side: string | null = null;
    let dragging = false;
    const codeAt = (node: Node | null) =>
      (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(
        "[data-diff-line]",
      );
    function pieces() {
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return [];
      const anchor = codeAt(selection.anchorNode);
      if (!anchor || !root?.contains(anchor)) return [];
      const chosen = side ?? anchor.dataset.diffSide;
      const range = selection.getRangeAt(0);
      return Array.from(root.querySelectorAll<HTMLElement>("[data-diff-line]"))
        .filter((node) => node.dataset.diffSide === chosen && range.intersectsNode(node))
        .flatMap((node) => {
          const part = range.cloneRange();
          part.selectNodeContents(node);
          if (node.contains(range.startContainer))
            part.setStart(range.startContainer, range.startOffset);
          if (node.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
          const text = part.toString();
          return text ? [{ node, text }] : [];
        });
    }
    function update() {
      if (dragging) return;
      const parts = pieces();
      const first = parts[0];
      if (!first || !current.current.onComment) {
        setSelected(null);
        return;
      }
      const chosen = first.node.dataset.diffSide as Side;
      const number = Number(first.node.dataset.diffLine);
      const line = source.hunks
        .flatMap((hunk) => hunk.lines)
        .find(
          (line) =>
            (chosen === "old" ? line.oldLine : line.newLine) === number && line.kind !== "meta",
        );
      const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      if (!line || !rect || !root) {
        setSelected(null);
        return;
      }
      const bounds = root.getBoundingClientRect();
      setSelected({
        line,
        side: chosen,
        left: Math.max(4, Math.min(bounds.width - 110, rect.right - bounds.left)),
        top: Math.max(4, Math.min(bounds.height - 32, rect.bottom - bounds.top + 4)),
      });
    }
    function down(event: PointerEvent) {
      if (event.button !== 0) return;
      if ((event.target as Element).closest('[data-testid="diff-selection-comment"]')) return;
      const code = codeAt(event.target as Node);
      side = code?.dataset.diffSide ?? null;
      if (side) root?.setAttribute("data-selection-side", side);
      dragging = true;
      setSelected(null);
    }
    function up() {
      dragging = false;
      update();
    }
    function copy(event: ClipboardEvent) {
      const parts = pieces();
      if (!parts.length || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", parts.map((part) => part.text).join("\n"));
    }
    function scroll() {
      setSelected(null);
    }
    root.addEventListener("pointerdown", down);
    root.addEventListener("copy", copy);
    root.addEventListener("scroll", scroll, true);
    document.addEventListener("pointerup", up);
    document.addEventListener("selectionchange", update);
    return () => {
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("copy", copy);
      root.removeEventListener("scroll", scroll, true);
      root.removeAttribute("data-selection-side");
      document.removeEventListener("pointerup", up);
      document.removeEventListener("selectionchange", update);
    };
  }, [rootRef, source]);
  return {
    selected,
    comment() {
      if (!selected) return;
      current.current.onComment?.(selected.line, selected.side, current.current.source);
      if (Platform.OS === "web") window.getSelection()?.removeAllRanges();
      setSelected(null);
    },
  };
}
