import {
  configureConnect,
  setConnectEnabled,
  deleteConnect,
  testConnect,
  connectStatus,
  listConnectVaults,
  listConnectItems,
} from "./shared/onepassword.js";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  getSecretRequest,
  declineSecretRequest,
  readSecretOutput,
  releaseSecretOutput,
  discardSecretOutput,
  listSecrets,
  mcpConnection,
  openSecrets,
  revokeSecrets,
  submitSecrets,
  submitSecretRequest,
} from "./shared/contracts.js";
import { startRuntime } from "./server/runtime.js";

export default function contribute(server: PluginServerContext) {
  const home = process.env.PASEO_HOME;
  if (!home) throw new Error("PASEO_HOME is required to locate the Secrets MCP endpoint.");
  let api: PluginHandlerContext["paseo"] | undefined;
  const runtime = startRuntime({
    stateDirectory: path.join(home, "plugin-state", "secrets-mcp"),
    async onRequest(input, requests) {
      if (!api) throw new Error("Paseo session unavailable");
      const agent = api.agents.ref(input.agentId);
      await agent.refresh();
      if (!agent.cwd || agent.archivedAt) throw new Error("Agent unavailable");
      const request = requests.create(input);
      try {
        await agent.timeline.append({
          type: "plugin",
          id: request.id,
          kind: "secrets-request",
          version: 1,
          data: { requestId: request.id },
        });
      } catch {
        requests.decline(input.agentId, request.id);
        throw new Error("Could not show private input");
      }
      return request;
    },
    async onOutput(outputId, agentId) {
      if (!api) return;
      await api.agents.ref(agentId).timeline.append({
        type: "plugin",
        id: outputId,
        kind: "secrets-output",
        version: 1,
        data: { outputId },
      });
    },
  });
  server.on("agent.turn_started", (_, { paseo }) => {
    api = paseo;
  });
  // Startup failures surface through RPC; no unhandled rejection or credential-bearing logging.
  void runtime.catch(() => undefined);
  server.handle(configureConnect, async (input) => {
    await (await runtime).connect.configure(input);
    return { configured: true as const };
  });
  server.handle(deleteConnect, async () => {
    await (await runtime).connect.remove();
    return { configured: false as const };
  });
  server.handle(setConnectEnabled, async ({ enabled }) => {
    await (await runtime).connect.setEnabled(enabled);
    return { enabled };
  });
  server.handle(testConnect, async () => (await runtime).connect.test());
  server.handle(listConnectVaults, async () => ({
    vaults: await (await runtime).connect.listVaults(),
  }));
  server.handle(listConnectItems, async (input) => ({
    items: await (await runtime).connect.listItems(input),
  }));
  server.handle(connectStatus, async () => (await runtime).connect.status());
  server.handle(mcpConnection, async (_, { paseo }) => {
    api = paseo;
    return { url: (await runtime).url };
  });
  server.before("agent.create", async ({ request }, { paseo }) => {
    api = paseo;
    // Other providers can opt in through their own MCP configuration.
    if (!["codex", "claude", "opencode", "copilot"].includes(request.config.provider))
      return request;
    if (request.config.internal) return request;
    const { url } = await runtime;
    const existing = request.config.mcpServers?.["paseo-secrets"];
    if (existing && (existing.type !== "http" || existing.url !== url)) {
      throw new Error("The paseo-secrets MCP server name is already configured.");
    }
    return {
      ...request,
      config: {
        ...request.config,
        mcpServers: { ...request.config.mcpServers, "paseo-secrets": { type: "http", url } },
      },
    };
  });
  server.handle(openSecrets, async ({ agentId }, { paseo }) => {
    api = paseo;
    await paseo.agents.ref(agentId).timeline.append({
      type: "plugin",
      id: "secrets-input",
      kind: "secrets-input",
      version: 1,
      data: { requestId: randomUUID() },
    });
    return { opened: true };
  });
  server.handle(submitSecrets, async ({ agentId, secrets, images, requestId }, { paseo }) => {
    api = paseo;
    const agent = paseo.agents.ref(agentId);
    await agent.refresh();
    const cwd = agent.cwd;
    if (!cwd || agent.archivedAt) throw new Error("Select an active agent before adding secrets.");
    const { broker, requests } = await runtime;
    const create = () => broker.submit({ agentId, cwd, secrets, images });
    const grant = requestId
      ? requests.fulfill(agentId, requestId, { secrets, images }, create)
      : create();
    return grant;
  });
  server.handle(
    submitSecretRequest,
    async ({ agentId, requestId, secrets, images, skipped }, { paseo }) => {
      api = paseo;
      const agent = paseo.agents.ref(agentId);
      await agent.refresh();
      const cwd = agent.cwd;
      if (!cwd || agent.archivedAt)
        throw new Error("Select an active agent before adding secrets.");
      const { broker, requests } = await runtime;
      return requests.submit(agentId, requestId, { secrets, images }, skipped, () =>
        broker.submit({ agentId, cwd, secrets, images }),
      );
    },
  );
  server.handle(listSecrets, async ({ agentId }, { paseo }) => {
    api = paseo;
    const { broker, requests } = await runtime;
    return {
      grants: broker.list(agentId),
      requests: requests.list(agentId),
      outputs: broker.outputs.list(agentId),
    };
  });
  server.handle(revokeSecrets, async ({ agentId, id }) => {
    const { broker } = await runtime;
    return { revoked: broker.revoke(agentId, id) };
  });
  server.handle(getSecretRequest, async ({ agentId, id }) =>
    (await runtime).requests.get(agentId, id),
  );
  server.handle(declineSecretRequest, async ({ agentId, id }) => ({
    declined: (await runtime).requests.decline(agentId, id),
  }));
  server.handle(readSecretOutput, async ({ agentId, id }) =>
    (await runtime).broker.outputs.review(agentId, id),
  );
  server.handle(releaseSecretOutput, async ({ agentId, id, text }) => {
    (await runtime).broker.outputs.release(agentId, id, text);
    return { released: true };
  });
  server.handle(discardSecretOutput, async ({ agentId, id }) => ({
    discarded: (await runtime).broker.outputs.discard(agentId, id),
  }));
  server.on("agent.archived", async ({ agent }) => {
    const { broker } = await runtime;
    broker.revokeAgent(agent.id);
    broker.outputs.removeAgent(agent.id);
    (await runtime).requests.removeAgent(agent.id);
  });
  return async () => {
    const active = await runtime.catch(() => null);
    await active?.close();
  };
}
