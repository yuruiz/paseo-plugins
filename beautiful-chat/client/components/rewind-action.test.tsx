// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewindAction } from "./rewind-action";
import type { ExtendedThemeTokens } from "./theme-tokens";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), rewind: vi.fn(), restore: vi.fn(), copy: vi.fn(), error: vi.fn(), show: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => ({ agents: { ref: () => ({ refresh: mocks.refresh }) } }),
  useRpc: () => mocks.rewind,
}));
vi.mock("react-native", () => ({
  View: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: React.PropsWithChildren<{
    onPress(): void; disabled?: boolean; accessibilityLabel: string;
  }>) => <button onClick={onPress} disabled={disabled} aria-label={accessibilityLabel}>{children}</button>,
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  copyText: mocks.copy,
  useToast: () => ({ error: mocks.error, show: mocks.show }),
  Modal: Object.assign(
    ({ open, children, onOpenChange }: React.PropsWithChildren<{ open: boolean; onOpenChange(open: boolean): void }>) =>
      open ? <div role="dialog">{children}<button onClick={() => onOpenChange(false)}>Close</button></div> : null,
    { Content: ({ children }: React.PropsWithChildren) => <div>{children}</div> },
  ),
}));
vi.mock("../web", () => ({ prepareRewindComposerRestore: () => mocks.restore }));
vi.mock("./glyph", () => ({ Glyph: () => null }));

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
const allCapabilities = {
  supportsRewindConversation: true, supportsRewindFiles: true, supportsRewindBoth: true,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  mocks.refresh.mockResolvedValue({ agent: { capabilities: allCapabilities } });
  mocks.rewind.mockResolvedValue({});
  mocks.restore.mockReturnValue(true);
  mocks.copy.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <RewindAction hostId="selected-host" agentId="selected-agent" messageId="original-message"
        text="Original prompt" surface={{ current: null }} tokens={{} as ExtendedThemeTokens} />
    </QueryClientProvider>,
  ));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button"))
    .find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(found, label).toBeDefined();
  return found!;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

describe("prompt rewind action", () => {
  it("opens the warning and supported choices without rewinding", async () => {
    await render();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click("Rewind to this message");
    expect(container.textContent).toContain("This action cannot be undone.");
    expect(button("Rewind conversation")).toBeDefined();
    expect(button("Rewind files")).toBeDefined();
    expect(button("Rewind conversation and files")).toBeDefined();
    await click("Close");
    expect(mocks.rewind).not.toHaveBeenCalled();
  });

  it("hides rewind when the provider has no capability", async () => {
    mocks.refresh.mockResolvedValue({ agent: { capabilities: {} } });
    await render();
    expect(container.querySelector("button")).toBeNull();
  });

  it("offers only provider-supported modes", async () => {
    mocks.refresh.mockResolvedValue({ agent: { capabilities: { supportsRewindFiles: true } } });
    await render();
    await click("Rewind to this message");
    expect(button("Rewind files")).toBeDefined();
    expect(container.textContent).not.toContain("Rewind conversation");
  });

  it.each([
    ["Rewind conversation", "conversation"],
    ["Rewind files", "files"],
    ["Rewind conversation and files", "both"],
  ])("%s targets the original host, agent and message", async (label, mode) => {
    await render();
    await click("Rewind to this message");
    await click(label!);
    expect(mocks.rewind).toHaveBeenCalledExactlyOnceWith({
      hostId: "selected-host", agentId: "selected-agent", messageId: "original-message", mode,
    });
    if (mode === "files") expect(mocks.restore).not.toHaveBeenCalled();
    else expect(mocks.restore).toHaveBeenCalledExactlyOnceWith("Original prompt");
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("locks duplicate clicks and closing until the request settles", async () => {
    let finish!: () => void;
    mocks.rewind.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    await render();
    await click("Rewind to this message");
    await act(async () => {
      button("Rewind conversation").click();
      button("Rewind conversation").click();
    });
    expect(mocks.rewind).toHaveBeenCalledOnce();
    expect(button("Rewind files").disabled).toBe(true);
    await click("Close");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mocks.restore).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(mocks.restore).toHaveBeenCalledOnce();
  });

  it("leaves the draft untouched and allows retry after a failure", async () => {
    mocks.rewind.mockRejectedValueOnce(new Error("Checkpoint missing"));
    await render();
    await click("Rewind to this message");
    await click("Rewind conversation");
    expect(mocks.error).toHaveBeenCalledWith("Checkpoint missing");
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click("Rewind conversation");
    expect(mocks.rewind).toHaveBeenCalledTimes(2);
    expect(mocks.restore).toHaveBeenCalledOnce();
  });

  it("copies the prompt when composer restoration is unavailable", async () => {
    mocks.restore.mockReturnValue(false);
    await render();
    await click("Rewind to this message");
    await click("Rewind conversation");
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("Original prompt");
    expect(mocks.show).toHaveBeenCalledOnce();
  });

  it("reports clipboard failure as restoration failure without retrying rewind", async () => {
    mocks.restore.mockReturnValue(false);
    mocks.copy.mockRejectedValue(new Error("Clipboard denied"));
    await render();
    await click("Rewind to this message");
    await click("Rewind conversation");
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Rewound successfully"));
    expect(mocks.rewind).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
