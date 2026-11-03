// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";
import { insertIntoSelectionComposer } from "./web";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const snippet = "> Selected reply\n\n";

function chat(id: string, composer = `<textarea data-composer-input id="${id}-input"></textarea>`) {
  return `<div id="${id}-panel">
    <main><div data-testid="agent-chat-scroll"><div data-bcselection id="${id}-text">Selected reply</div></div></main>
    <footer>${composer}</footer>
  </div>`;
}

function source(id: string): Element {
  return document.getElementById(`${id}-text`)!;
}

function input(id: string): HTMLTextAreaElement {
  return document.getElementById(`${id}-input`) as HTMLTextAreaElement;
}

beforeEach(() => {
  Platform.OS = "web";
  // jsdom has no layout; retain the browser's display:none behavior for these fixtures.
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    for (let element: Element | null = this; element; element = element.parentElement) {
      if (getComputedStyle(element).display === "none") return [] as unknown as DOMRectList;
    }
    return [new DOMRect(0, 0, 100, 20)] as unknown as DOMRectList;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("Add to chat ownership", () => {
  it("skips an earlier retained chat and publishes only the selected chat's draft", () => {
    document.body.innerHTML = `<section>${chat("old")}${chat("current")}</section>`;
    document.getElementById("old-panel")!.style.display = "none";
    input("old").value = "Keep this draft";
    const onInput = vi.fn();
    input("current").addEventListener("input", onInput);

    expect(insertIntoSelectionComposer(source("current"), snippet)).toBe(true);
    expect(input("current").value).toBe(snippet);
    expect(input("old").value).toBe("Keep this draft");
    expect(document.activeElement).toBe(input("current"));
    expect(onInput).toHaveBeenCalledOnce();
    expect(onInput.mock.calls[0]![0].bubbles).toBe(true);
  });

  it("uses the selected pane with two visible chats, regardless of input focus or DOM order", () => {
    document.body.innerHTML = `<section data-testid="workspace-pane-left">${chat("left")}</section>
      <section data-testid="workspace-pane-right">${chat("right")}</section>`;
    input("left").focus();
    expect(insertIntoSelectionComposer(source("right"), snippet)).toBe(true);
    expect(input("left").value).toBe("");
    expect(input("right").value).toBe(snippet);
  });

  it("does not cross into another chat when the selected chat has no composer", () => {
    document.body.innerHTML = `<section>${chat("other")}${chat("selected", "")}</section>`;
    expect(insertIntoSelectionComposer(source("selected"), snippet)).toBe(false);
    expect(input("other").value).toBe("");
  });

  it("does not cross a pane boundary into a new-conversation draft without a timeline", () => {
    document.body.innerHTML = `<section data-testid="workspace-pane-selected">${chat("selected", "")}</section>
      <section data-testid="workspace-pane-draft"><textarea data-composer-input id="draft-input"></textarea></section>`;
    expect(insertIntoSelectionComposer(source("selected"), snippet)).toBe(false);
    expect(input("draft").value).toBe("");
  });

  it.each(["disabled", "readonly", 'style="display:none"', 'style="visibility:hidden"'])(
    "does not write to or bypass an unavailable composer: %s",
    (attribute) => {
      document.body.innerHTML = `<section>${chat("other")}${chat("selected", `<textarea data-composer-input id="selected-input" ${attribute}></textarea>`)}</section>`;
      expect(insertIntoSelectionComposer(source("selected"), snippet)).toBe(false);
      expect(input("other").value).toBe("");
      expect(input("selected").value).toBe("");
    },
  );

  it("rejects a hidden or detached selection after switching tabs", () => {
    document.body.innerHTML = `<section>${chat("old")}${chat("current")}</section>`;
    const oldSource = source("old");
    document.getElementById("old-panel")!.style.display = "none";
    expect(insertIntoSelectionComposer(oldSource, snippet)).toBe(false);
    document.getElementById("old-panel")!.remove();
    expect(insertIntoSelectionComposer(oldSource, snippet)).toBe(false);
    expect(input("current").value).toBe("");
  });

  it("rejects ambiguous composers within the same chat panel", () => {
    document.body.innerHTML = chat("selected", '<textarea data-composer-input></textarea><textarea data-composer-input></textarea>');
    expect(insertIntoSelectionComposer(source("selected"), snippet)).toBe(false);
    expect(Array.from(document.querySelectorAll("textarea"), (element) => element.value)).toEqual(["", ""]);
  });

  it("supports a marked wrapper and preserves text around the draft selection", () => {
    document.body.innerHTML = chat("selected", '<div data-composer-input><textarea data-composer-input id="selected-input"></textarea></div>');
    input("selected").value = "Before replace after";
    input("selected").setSelectionRange(7, 14);
    expect(insertIntoSelectionComposer(source("selected"), snippet)).toBe(true);
    expect(input("selected").value).toBe(`Before \n\n${snippet} after`);
    expect(input("selected").selectionStart).toBe(9 + snippet.length);
  });

  it("does not execute a browser edit if focusing the composer redirects focus", () => {
    document.body.innerHTML = `<section>${chat("other")}${chat("selected")}</section>`;
    input("selected").addEventListener("focus", () => input("other").focus());
    expect(insertIntoSelectionComposer(source("selected"), snippet)).toBe(false);
    expect(input("other").value).toBe("");
    expect(input("selected").value).toBe("");
  });

  it("is a no-op on native platforms", () => {
    document.body.innerHTML = chat("selected");
    Platform.OS = "ios";
    expect(insertIntoSelectionComposer(source("selected"), snippet)).toBe(false);
    expect(input("selected").value).toBe("");
  });
});
