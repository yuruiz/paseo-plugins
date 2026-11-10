import type { PluginHostProps } from "@getpaseo/plugin/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { SyncPanel } from "./sync-panel";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  apply: vi.fn(),
  status: vi.fn(),
  save: vi.fn(),
  settings: {} as Record<string, unknown>,
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => "/workspace",
  useRpc: (contract: { name: string }) =>
    contract.name === "skills.sync.compare"
      ? mocks.compare
      : contract.name === "skills.sync.status"
        ? mocks.status
        : mocks.apply,
  useSettings: () => mocks.settings,
}));
vi.mock("react-native", () =>
  Object.fromEntries(
    ["ActivityIndicator", "Pressable", "ScrollView", "Text", "TextInput", "View"].map((name) => [
      name,
      name,
    ]),
  ),
);

let renderer: ReactTestRenderer;
let queries: QueryClient;
const theme = {
  colors: {
    foreground: "#fff",
    foregroundMuted: "#aaa",
    accent: "#6af",
    surface0: "#111",
    surface1: "#222",
    statusDanger: "#f44",
  },
} as PluginHostProps["theme"];
const plan = {
  token: "preview",
  repository: "owner/private",
  branch: "main",
  commit: "a".repeat(40),
  destination: "/home/skills",
  rows: [
    {
      name: "changed",
      status: "different",
      localHash: "a",
      remoteHash: "b",
      localPath: "/local/changed",
      changes: [{ path: "SKILL.md", kind: "modified" }],
      error: null,
    },
    {
      name: "local",
      status: "local-only",
      localHash: "a",
      remoteHash: null,
      localPath: "/local/local",
      changes: [],
      error: null,
    },
    {
      name: "remote",
      status: "remote-only",
      localHash: null,
      remoteHash: "b",
      localPath: "/local/remote",
      changes: [],
      error: null,
    },
  ],
};

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}
function button(label: string) {
  const found = renderer.root.findAll(
    (node) => String(node.type) === "Pressable" && text(node).startsWith(label),
  );
  expect(found).toHaveLength(1);
  return found[0];
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function press(label: string) {
  await act(async () => {
    button(label).props.onPress();
  });
  await settle();
  await settle();
}
async function mount(compact = false) {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queries}>
        <SyncPanel agentId="agent" theme={theme} compact={compact} />
      </QueryClientProvider>,
    );
  });
  await settle();
  await settle();
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.compare.mockReset().mockResolvedValue(plan);
  mocks.status.mockReset().mockResolvedValue(null);
  mocks.apply.mockReset().mockImplementation(async (input) => {
    mocks.status.mockResolvedValue({
      jobId: "job",
      direction: input.direction,
      state: "finished",
      result: { completed: input.names, backups: [], error: null },
    });
    return { jobId: "job" };
  });
  mocks.save.mockReset().mockResolvedValue(true);
  mocks.settings = {
    status: "ready",
    values: { repository: "owner/private", branch: "" },
    revision: "revision-1",
    saving: false,
    saveError: null,
    save: mocks.save,
  };
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  queries.clear();
});

test("compares on opening without transferring, and requires a second click before replacement", async () => {
  await mount();
  expect(mocks.compare).toHaveBeenCalledWith({
    agentId: "agent",
    repository: "owner/private",
    branch: "",
  });
  expect(mocks.apply).not.toHaveBeenCalled();
  await press("Select up to 50");
  await press("Upload selected (2)");
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(text(renderer.root)).toContain("Replace the GitHub version of changed?");
  await press("Confirm replacement (2)");
  expect(mocks.apply).toHaveBeenCalledWith({
    agentId: "agent",
    token: "preview",
    names: ["changed", "local"],
    direction: "upload",
    overwrite: true,
  });
});

test("changing direction clears selected skills and replacement approval in compact layout", async () => {
  await mount(true);
  await press("Select up to 50");
  await press("Upload selected (2)");
  await press("Download to this machine");
  expect(button("Download selected (0)").props.disabled).toBe(true);
  expect(text(renderer.root)).not.toContain("Replace the GitHub version");
  await press("☐ remote");
  await press("Download selected (1)");
  expect(mocks.apply).toHaveBeenCalledWith(
    expect.objectContaining({ direction: "download", names: ["remote"], overwrite: false }),
  );
});

test("a refreshed comparison clears the previous selection", async () => {
  await mount();
  await press("Select up to 50");
  mocks.compare.mockResolvedValue({ ...plan, token: "new-preview" });
  await press("Check for updates");
  expect(button("Upload selected (0)").props.disabled).toBe(true);
});

test("saves repository drafts using the revision captured when editing began", async () => {
  await mount();
  await press("Repository settings");
  const input = renderer.root.findByProps({ accessibilityLabel: "GitHub repository" });
  await act(async () => input.props.onChangeText("owner/another"));
  mocks.settings = { ...mocks.settings, revision: "revision-2" };
  await press("Save and compare");
  expect(mocks.save).toHaveBeenCalledWith(
    { repository: "owner/another", branch: "" },
    "revision-1",
  );
});

test("failed refresh hides stale transfer actions", async () => {
  await mount();
  mocks.compare.mockRejectedValue(new Error("GitHub access denied"));
  await press("Check for updates");
  expect(text(renderer.root)).toContain("GitHub access denied");
  expect(
    renderer.root.findAll(
      (node) => String(node.type) === "Pressable" && text(node).startsWith("Upload selected"),
    ),
  ).toHaveLength(0);
});

test("reopening while a server job runs shows progress and disables transfers", async () => {
  mocks.status.mockResolvedValue({
    jobId: "running-job",
    direction: "download",
    state: "running",
    result: null,
  });
  await mount();
  expect(text(renderer.root)).toContain("Sync in progress");
  expect(button("Repository settings").props.disabled).toBe(true);
  expect(mocks.compare).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
});
