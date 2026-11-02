import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { AuthPanel } from "./auth-panel";
import type { AuthView } from "../shared/contracts";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  TextInput: "TextInput",
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => (input: unknown) => state.rpc(contract.name, input),
  openExternalUrl: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({ copyText: vi.fn() }));
const props = {
  scope: { provider: "codex", agentId: "agent" },
  host: { id: "host", label: "Mac mini" },
  theme: {
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface0: "#111",
      accent: "#55f",
      accentForeground: "#fff",
      border: "#444",
    },
  },
  layout: { compact: true, platform: "ios" },
} as PluginHostProps & { scope: { provider: "codex"; agentId: string } };
const blocked: AuthView = {
  provider: "codex",
  phase: "idle",
  status: "unsupported",
  message: "The configuration uses OPENAI_API_KEY",
  canLogin: false,
  expectsCode: false,
};
const checked = (view: AuthView, at = 1000): AuthView => ({
  ...view,
  lastCheck: {
    at,
    kind: view.status === "unsupported" ? "skipped" : "checked",
    status: view.status,
    message: view.message,
  },
});
let client: QueryClient;
let tree: ReactTestRenderer;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
async function mount() {
  await act(async () => {
    tree = create(
      <QueryClientProvider client={client}>
        <AuthPanel {...props} />
      </QueryClientProvider>,
    );
  });
  await flush();
}
function button(label: string) {
  return tree.root
    .findAllByType("Pressable" as any)
    .find((n) => n.props.accessibilityLabel === label)!;
}
function text() {
  return JSON.stringify(tree.toJSON());
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.clearAllMocks();
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  client.clear();
});

describe("status check with the real QueryClient", () => {
  it("keeps a visible explanation when a fast check returns the same unsupported status", async () => {
    let saved = blocked;
    state.rpc.mockImplementation(async (method: string) => {
      if (method === "auth.check") saved = checked(blocked);
      return saved;
    });
    await mount();
    expect(text()).not.toContain("CLI check skipped");
    await act(async () => {
      button("Check status").props.onPress();
    });
    await flush();
    expect(text()).toContain("CLI check skipped");
    expect(text()).toContain("Checked at: ");
    expect(text()).toContain("OPENAI_API_KEY");
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["auth"] });
    });
    await flush();
    expect(text()).toContain("CLI check skipped");
    await act(async () => tree.unmount());
    await mount();
    expect(text()).toContain("CLI check skipped");
  });
  it("shows checking progress, disables repeated clicks, and reports an unchanged successful status", async () => {
    const reply = deferred<AuthView>();
    let saved: AuthView = {
      ...blocked,
      status: "authenticated",
      canLogin: true,
      message: "The CLI found saved sign-in credentials",
    };
    state.rpc.mockImplementation((method: string) =>
      method === "auth.check" ? reply.promise : Promise.resolve(saved),
    );
    await mount();
    await act(async () => {
      button("Check status").props.onPress();
    });
    await flush();
    expect(button("Checking…").props.disabled).toBe(true);
    expect(text()).toContain("Checking CLI sign-in status…");
    saved = checked(saved);
    await act(async () => reply.resolve(saved));
    await flush();
    expect(text()).toContain("Check complete: Sign-in credentials found");
    expect(button("Check status").props.disabled).toBe(false);
  });
  it("does not let an older in-flight state read erase the check result", async () => {
    let saved = blocked;
    const oldRead = deferred<AuthView>();
    let delayNextRead = false;
    state.rpc.mockImplementation((method: string) => {
      if (method === "auth.check") saved = checked(blocked);
      if (method === "auth.state" && delayNextRead) {
        delayNextRead = false;
        return oldRead.promise;
      }
      return Promise.resolve(saved);
    });
    await mount();
    delayNextRead = true;
    const pending = client.refetchQueries({
      queryKey: ["auth", "host", "codex", "agent"],
      exact: true,
    });
    await act(async () => {
      button("Check status").props.onPress();
    });
    await flush();
    await act(async () => {
      oldRead.resolve(blocked);
      await pending;
    });
    await flush();
    expect(text()).toContain("CLI check skipped");
    expect(client.getQueryData<AuthView>(["auth", "host", "codex", "agent"])?.lastCheck?.kind).toBe(
      "skipped",
    );
  });
  it("shows RPC failure instead of silently resetting the button", async () => {
    state.rpc.mockImplementation(async (method: string) => {
      if (method === "auth.check") throw new Error("Connection lost. Please try again");
      return blocked;
    });
    await mount();
    await act(async () => {
      button("Check status").props.onPress();
    });
    await flush();
    expect(text()).toContain("Connection lost. Please try again");
    expect(button("Check status").props.disabled).toBe(false);
  });
});
