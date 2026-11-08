import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const dir = await mkdtemp(join(tmpdir(), "usage-runtime-test-"));
const registryKey = Symbol.for("paseo-agent-usage.fleet.v1");
const rpcKey = Symbol.for("paseo-agent-usage.test-rpc");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const cleanups = [];
let renderer;
try {
  const hostUi = `export const SidebarRow = "SidebarRow", TextInput = "TextInput", Icon = "Icon", ExternalLink = "ExternalLink";
    export const useToast = () => ({ error() {} });`;
  const result = await build({
    stdin: { contents: `export { default } from "./index.client"; export { useUsageReport, useAgentReport } from "./client/data";`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, platform: "browser", format: "cjs", write: false,
    plugins: [{ name: "test-host-runtime", setup(build) {
      build.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client(?:\/ui|\/react-native)?)$/ }, (args) => ({ path: args.path, namespace: "test-host" }));
      build.onLoad({ filter: /.*/, namespace: "test-host" }, (args) => ({ contents:
        args.path === "react-native" ? 'export const Platform={OS:"web"}, Text="Text", View="View", Pressable="Pressable", ScrollView="ScrollView", TextInput="TextInput", Switch="Switch";' :
        args.path === "@getpaseo/plugin/client" ? `import { useCallback } from "react";
          export const useRpc = contract => useCallback(input => globalThis[Symbol.for("paseo-agent-usage.test-rpc")](contract, input), [contract]);
          export async function openExternalUrl() {}` : hostUi,
      }));
      build.onResolve({ filter: /^(react(?:\/jsx-runtime)?|@tanstack\/react-query|@getpaseo\/plugin|zod)$/ }, (args) => ({ path: require.resolve(args.path), external: true }));
    } }],
  });
  // Each host evaluates its own bundle, as Paseo does. There is no module cache shared
  // between these files; only the plugin's explicitly versioned registry is shared.
  const code = result.outputFiles[0].text;
  await Promise.all([writeFile(join(dir, "host-a.cjs"), code), writeFile(join(dir, "host-b.cjs"), code)]);
  const a = require(join(dir, "host-a.cjs"));
  const b = require(join(dir, "host-b.cjs"));
  const snapshots = [1, 2].map((n) => ({
    version: 1, sourceId: `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`,
    label: `Example host ${n}`, generatedAt: Date.now(), lastScanAt: Date.now(),
    scanning: false, scanDone: 0, scanTotal: 0, scanError: null,
    buckets: { [`${new Date().toISOString()}\u0001codex\u0001test\u0001acme-project`]: { r: 1, i: n * 100, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0 } },
    recent: {}, sessions: {},
  }));
  let failSecond = false;
  const reads = [0, 0];
  function context(index) {
    const contributions = {};
    const rpc = async (contract, input) => {
      let output;
      if (contract.name === "usage.snapshot") {
        reads[index]++;
        if (index === 1 && failSecond) throw new Error("offline");
        output = snapshots[index];
      } else if (contract.name === "usage.prefs.get") output = { language: "en", refreshMinutes: 30, coCreateDismissed: true };
      else if (contract.name === "usage.refresh") output = { started: true };
      else throw new Error(`Unexpected RPC: ${contract.name}`);
      contract.input.parse(input);
      return contract.output.parse(output);
    };
    const capture = (kind) => (value) => { contributions[kind] = value; return () => {}; };
    return { rpc, contributions, addScreen: capture("screen"), addSidebarFooterItem: capture("footer"), addSettingsScreen: capture("settings"), addCommandCenterItem: capture("command") };
  }
  const hostA = context(0), hostB = context(1);
  cleanups.push(a.default(hostA), b.default(hostB));
  const registry = Reflect.get(globalThis, registryKey);
  assert.equal(registry.getSnapshot().length, 2, "hidden host entry registers before its surface mounts");
  globalThis[rpcKey] = hostA.rpc;
  let report, agent;
  function Probe() {
    report = a.useUsageReport("7d", "paseo:all");
    agent = a.useAgentReport("codex", "7d", true, "paseo:all");
    return null;
  }
  const themes = [
    { colors: { foreground: "#111111", foregroundMuted: "#555555", surface1: "#eeeeee" } },
    { colors: { foreground: "#ffffff", foregroundMuted: "#bbbbbb", surface1: "#222222" } },
  ];
  let opened = 0;
  const render = (compact, theme) => React.createElement(QueryClientProvider, { client: queryClient },
    React.createElement(React.Fragment, null, React.createElement(Probe),
      React.createElement(hostA.contributions.footer.Component, {
        theme, host: { id: "example-host", label: "Example" }, layout: { compact, platform: compact ? "ios" : "web" },
        currentScreen: null, openScreen: () => { opened++; },
      })));
  await act(async () => { renderer = TestRenderer.create(render(false, themes[0])); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  assert.equal(report.data?.totals.input, 300, "dashboard hooks include both hosts");
  assert.equal(agent.data?.totals.input, 300, "agent detail hooks include both hosts");
  assert.deepEqual(reads, [1, 1], "footer and both dashboard hooks share requests");

  for (const compact of [false, true]) {
    for (const theme of themes) {
      await act(async () => { renderer.update(render(compact, theme)); });
      const texts = renderer.root.findAllByType("Text");
      assert.deepEqual(texts.map(text => text.props.children), ["300", "24h", "300", "7d", "300", "30d"]);
      for (let index = 0; index < texts.length; index++) {
        assert.equal(texts[index].props.numberOfLines, 1);
        assert.equal(texts[index].props.style.color, index % 2 === 0 ? theme.colors.foreground : theme.colors.foregroundMuted);
      }
      assert.equal(renderer.root.findAllByType("SidebarRow").length, 0, "footer has no navigation title row");
      for (const text of texts) assert(Object.values(theme.colors).includes(text.props.style.color), "footer text follows theme");
      const row = renderer.root.findByType("Pressable");
      const idle = row.props.style({ pressed: false, hovered: false });
      assert.equal(idle.flexDirection, "row");
      assert.equal(idle.gap, 8);
      assert.equal(idle.paddingHorizontal, 8);
      assert.equal(idle.backgroundColor, "transparent");
      assert.equal(row.props.style({ pressed: false, hovered: true }).backgroundColor, theme.colors.surface1);
      assert.equal(row.props.style({ pressed: true }).backgroundColor, theme.colors.surface1);
      await act(async () => { row.props.onPress(); });
    }
  }
  assert.equal(opened, 4);
  failSecond = true;
  await act(async () => { await queryClient.refetchQueries({ queryKey: ["agent-usage-fleet"] }); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(report.data?.totals.input, 300, "offline host retains the last successful snapshot");
  assert.deepEqual(renderer.root.findAllByType("Text").map(text => text.props.children), ["300", "24h", "300", "7d", "300", "30d"], "offline status does not add footer content");
  assert.equal(report.fleet.partial, true, "partial status remains available to the dashboard");
  failSecond = false;
  snapshots[1] = { ...snapshots[1], generatedAt: Date.now() };
  await act(async () => { await queryClient.refetchQueries({ queryKey: ["agent-usage-fleet"] }); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(report.fleet.partial, false, "reconnect clears dashboard partial status");
  await act(async () => { cleanups.pop()(); });
  assert.equal(report.data?.totals.input, 100, "unloading a host removes its contribution");
  console.log("runtime checks passed (independent host bundles, real React hooks, shared requests, footer, themes, compact layout, offline/reconnect, cleanup)");
} finally {
  if (renderer) await act(async () => renderer.unmount());
  for (const cleanup of cleanups) cleanup();
  queryClient.clear();
  Reflect.deleteProperty(globalThis, registryKey);
  Reflect.deleteProperty(globalThis, rpcKey);
  await rm(dir, { recursive: true, force: true });
}
