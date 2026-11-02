import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { AuthPanel } from "./auth-panel";
import type { AuthView } from "../shared/contracts";
const state = vi.hoisted(() => ({
  view: {} as AuthView,
  rpc: vi.fn(),
  open: vi.fn(),
  copy: vi.fn(),
  mutation: undefined as any,
  invalid: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  TextInput: "TextInput",
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => (input: unknown) => state.rpc(contract.name, input),
  openExternalUrl: state.open,
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({ copyText: state.copy }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: state.view, isError: false }),
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    invalidateQueries: state.invalid,
    cancelQueries: vi.fn().mockResolvedValue(undefined),
  }),
  useMutation: (options: any) => {
    state.mutation = options;
    return {
      isPending: false,
      error: null,
      mutate: (action: string) => options.mutationFn(action),
    };
  },
}));
const props = {
  scope: { provider: "claude", agentId: "agent" },
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
  host: { id: "host", label: "Mac mini" },
  layout: { compact: true, platform: "ios" },
} as PluginHostProps & { scope: { provider: "claude"; agentId: string } };
let tree: ReactTestRenderer | undefined;
async function mount(view: Partial<AuthView>) {
  state.view = {
    provider: "claude",
    phase: "idle",
    status: "unchecked",
    message: "",
    canLogin: true,
    expectsCode: false,
    ...view,
  };
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    tree = create(<AuthPanel {...props} />);
  });
}
function buttons() {
  return tree!.root.findAllByType("Pressable" as any).map((node) => node.props.accessibilityLabel);
}
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  vi.clearAllMocks();
});

describe("inline login card", () => {
  it("opens an official authorization page only on a user press", async () => {
    await mount({
      phase: "waiting",
      sessionId: "session",
      url: "https://claude.com/cai/oauth/authorize?state=test",
    });
    expect(state.open).not.toHaveBeenCalled();
    const button = tree!.root
      .findAllByType("Pressable" as any)
      .find((n) => n.props.accessibilityLabel === "Open authorization page")!;
    await act(async () => button.props.onPress());
    expect(state.open).toHaveBeenCalledWith(state.view.url);
    expect(buttons()).toContain("Cancel sign-in");
  });
  it("shows a secure code field only when the CLI requests it and clears on submit", async () => {
    await mount({ phase: "waiting", sessionId: "session", expectsCode: true });
    const input = tree!.root.findByType("TextInput" as any);
    expect(input.props.secureTextEntry).toBe(true);
    await act(async () => input.props.onChangeText("code#state"));
    await act(async () => {
      await state.mutation.mutationFn("code");
    });
    expect(state.rpc).toHaveBeenCalledWith("auth.code", {
      provider: "claude",
      agentId: "agent",
      sessionId: "session",
      code: "code#state",
    });
    expect(tree!.root.findByType("TextInput" as any).props.value).toBe("");
  });
  it("separates login, reload and continue without automatic requests", async () => {
    await mount({ phase: "succeeded", status: "authenticated", sessionId: "session" });
    expect(buttons()).toContain("Reload current session");
    expect(buttons()).not.toContain("Continue task");
    expect(state.rpc).not.toHaveBeenCalled();
    state.view = { ...state.view, reloaded: true };
    await act(async () => tree!.update(<AuthPanel {...props} />));
    expect(buttons()).toContain("Continue task");
    expect(buttons()).not.toContain("Reload current session");
    state.view = { ...state.view, continued: true };
    await act(async () => tree!.update(<AuthPanel {...props} />));
    expect(buttons()).not.toContain("Continue task");
  });
  it("keeps the credential target visible in compact layouts", async () => {
    await mount({ phase: "waiting" });
    expect(JSON.stringify(tree!.toJSON())).toContain("Mac mini");
    expect(tree!.root.findAllByType("TextInput" as any)).toHaveLength(0);
  });
});
