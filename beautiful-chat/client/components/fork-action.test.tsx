// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForkAction } from "./fork-action";
import type { ExtendedThemeTokens } from "./theme-tokens";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fork: vi.fn(), error: vi.fn(), show: vi.fn(), openURL: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => ({ agents: { ref: () => ({ refresh: mocks.refresh }) } }),
  useRpc: () => mocks.fork,
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ useToast: () => ({ error: mocks.error, show: mocks.show }) }));
vi.mock("./glyph", () => ({ Glyph: ({ name }: { name: string }) => <svg data-icon={name} /> }));
vi.mock("react-native", () => ({
  Linking: { openURL: mocks.openURL },
  Platform: { OS: "web" },
  ActivityIndicator: () => <span role="progressbar" />,
  Pressable: ({ children, onPress, disabled, accessibilityLabel, accessibilityState, ref }: React.PropsWithChildren<{
    onPress(): void; disabled?: boolean; accessibilityLabel: string; ref?: React.Ref<HTMLButtonElement>; accessibilityState?: { busy: boolean };
  }>) => <button ref={ref} onClick={onPress} disabled={disabled} aria-label={accessibilityLabel}
    aria-busy={accessibilityState?.busy}>{children}</button>,
}));

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  mocks.refresh.mockResolvedValue({ agent: { provider: "codex" } });
  mocks.fork.mockResolvedValue({ agentId: "new-agent", workspaceId: "workspace" });
  mocks.openURL.mockResolvedValue(undefined);
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
  await act(async () => root.render(<QueryClientProvider client={queryClient}>
    <ForkAction hostId="host" agentId="source" messageId="reply" tokens={{} as ExtendedThemeTokens} />
  </QueryClientProvider>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function click() { await act(async () => container.querySelector("button")!.click()); }

describe("native fork action", () => {
  it.each(["codex", "claude"])("forks the exact %s reply and opens the new conversation", async (provider) => {
    mocks.refresh.mockResolvedValue({ agent: { provider } });
    await render();
    expect(container.querySelector('[data-icon="GitFork"]')).not.toBeNull();
    expect(container.querySelector("button")!.title).toBe("Fork from this reply");
    expect(container.textContent).toBe("");
    await click();
    expect(mocks.fork).toHaveBeenCalledWith({ hostId: "host", agentId: "source", messageId: "reply", requestId: expect.any(String) });
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Open fork");
    expect(container.querySelector('[data-icon="ExternalLink"]')).not.toBeNull();
    await click();
    expect(mocks.openURL).toHaveBeenCalledWith("paseo://h/host/agent/new-agent");
    expect(mocks.fork).toHaveBeenCalledOnce();
  });
  it("hides native fork for unsupported providers", async () => {
    mocks.refresh.mockResolvedValue({ agent: { provider: "custom" } });
    await render();
    expect(container.querySelector("button")).toBeNull();
  });
  it("uses the same request ID after failure", async () => {
    mocks.fork.mockRejectedValueOnce(new Error("Import failed"));
    await render();
    await click();
    expect(mocks.error).toHaveBeenCalledWith("Import failed");
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Fork from this reply");
    await click();
    expect(mocks.fork.mock.calls[0]![0]).toEqual(mocks.fork.mock.calls[1]![0]);
  });
  it("prevents duplicate clicks while forking", async () => {
    let finish!: (value: { agentId: string }) => void;
    mocks.fork.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render();
    await act(async () => { container.querySelector("button")!.click(); container.querySelector("button")!.click(); });
    expect(mocks.fork).toHaveBeenCalledOnce();
    expect(container.querySelector("button")!.disabled).toBe(true);
    expect(container.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    await act(async () => finish({ agentId: "new-agent" }));
  });
  it("does not repeat a successful fork after a navigation failure", async () => {
    await render();
    await click();
    mocks.openURL.mockRejectedValue(new Error("Unavailable"));
    await click();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("available in this workspace"));
    expect(mocks.fork).toHaveBeenCalledOnce();
  });
});
