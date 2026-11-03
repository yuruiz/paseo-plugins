import { Platform } from "react-native";

const CHAT_SELECTOR = '[data-testid="agent-chat-scroll"]';
const PANE_SELECTOR = '[data-testid^="workspace-pane-"]';
const COMPOSER_SELECTOR = "[data-composer-input]";

type ComposerInput = HTMLTextAreaElement | HTMLInputElement;

function isVisible(element: Element): boolean {
  return (
    element.isConnected &&
    element.getClientRects().length > 0 &&
    !element.closest('[inert], [aria-hidden="true"]') &&
    getComputedStyle(element).visibility === "visible"
  );
}

function composerForSelection(surface: Element): ComposerInput | null {
  if (!isVisible(surface)) return null;
  const chat = surface.closest(CHAT_SELECTOR);
  if (!chat) return null;
  const pane = chat.closest(PANE_SELECTOR);

  // The stream and composer are siblings inside one retained chat panel.
  for (let scope = chat.parentElement; scope; scope = scope.parentElement) {
    if (scope === pane || scope === document.body || scope === document.documentElement) return null;
    const chats = scope.querySelectorAll(CHAT_SELECTOR);
    // Count hidden chats too: climbing into their common parent loses ownership.
    if (chats.length !== 1 || chats[0] !== chat) return null;

    const inputs = new Set<ComposerInput>();
    for (const marked of scope.querySelectorAll(COMPOSER_SELECTOR)) {
      if (chat.contains(marked)) continue;
      if (marked instanceof HTMLTextAreaElement || marked instanceof HTMLInputElement) {
        inputs.add(marked);
      } else {
        for (const input of marked.querySelectorAll<ComposerInput>("textarea, input")) {
          inputs.add(input);
        }
      }
    }
    if (inputs.size === 0) continue;
    if (inputs.size !== 1) return null;
    const input = inputs.values().next().value;
    return input && isVisible(input) && !input.matches(":disabled") && !input.readOnly
      ? input
      : null;
  }
  return null;
}

export function insertIntoSelectionComposer(surface: Element, snippet: string): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return false;
  const input = composerForSelection(surface);
  if (!input) return false;

  const before = input.value;
  const start = input.selectionStart ?? before.length;
  const end = input.selectionEnd ?? start;
  const head = before.slice(0, start);
  const lead =
    head.length === 0 || head.endsWith("\n\n") ? "" : head.endsWith("\n") ? "\n" : "\n\n";
  const insert = lead + snippet;
  const next = head + insert + before.slice(end);
  const caret = head.length + insert.length;

  input.focus();
  if (document.activeElement !== input || !isVisible(surface) || !isVisible(input)) return false;
  input.setSelectionRange(start, end);
  if (document.execCommand?.("insertText", false, insert) && input.value === next) {
    input.setSelectionRange(caret, caret);
    return true;
  }

  // The native setter and input event also update Paseo's draft, not just the DOM.
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setValue) return false;

  setValue.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (input.value !== next) return false;
  input.setSelectionRange(caret, caret);
  return true;
}
