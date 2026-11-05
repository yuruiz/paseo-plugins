import { expect, test, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  PluginServerContext,
  AgentToolDefinition,
  AgentToolContext,
} from "@getpaseo/plugin/server";
import type { z } from "zod";
import contribute from "../index.server.js";
import { sealValue } from "../shared/sealing.js";

test("native tools use caller identity and no private input reaches RPC results, timeline, logs or state files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "secrets-native-"));
  vi.stubEnv("PASEO_HOME", directory);
  const captured: unknown[] = [];
  const logged: unknown[] = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const)
    vi.spyOn(console, method).mockImplementation((...args) => {
      logged.push(args);
    });
  type Handler = (input: never, context: never) => unknown;
  const handlers = new Map<string, { input: z.ZodType; output: z.ZodType; handle: Handler }>();
  const hooks = new Map<string, Handler>();
  const host: Pick<PluginServerContext, "handle" | "addHook"> = {
    handle(contract, handler) {
      handlers.set(contract.name, { ...contract, handle: handler as Handler });
    },
    addHook(name, handler) {
      hooks.set(name, handler as Handler);
      return () => undefined;
    },
  };
  const agentId = "c7e7884f-4b52-459c-b723-8566284c6349";
  const otherId = "e0b36cd2-8c99-4fae-8c1e-1b19cc5f9883";
  let idle = true;
  const paseo = {
    agents: {
      ref(id: string) {
        return {
          id,
          cwd: directory,
          archivedAt: null,
          status: idle ? "idle" : "running",
          refresh: async () => undefined,
          send: async (text: string) => {
            captured.push({ message: text });
          },
          timeline: {
            append: async (item: unknown) => {
              captured.push(item);
            },
          },
        };
      },
    },
    config: { get: async () => ({ config: { providers: {} } }) },
  };
  const context = { paseo, signal: new AbortController().signal };
  const dispose = contribute(host as PluginServerContext);
  const rpc = async (name: string, input: unknown) => {
    const entry = handlers.get(name)!;
    const result = entry.output.parse(
      await entry.handle(entry.input.parse(input) as never, context as never),
    );
    captured.push(result);
    return result as Record<string, unknown>;
  };
  try {
    await rpc("secrets.mcp.connection", {});
    const opened = (await hooks.get("agent.open.before")!(
      {
        request: {
          agentId,
          provider: "codex",
          purpose: "interactive",
          tools: [],
          env: {},
          mcpServers: {},
        },
      } as never,
      context as never,
    )) as { tools: AgentToolDefinition[]; mcpServers: object };
    expect(opened.mcpServers).toEqual({});
    expect(opened.tools.map((tool) => tool.name)).toContain("request_secrets");
    const tool = async (name: string, input: unknown, id = agentId) => {
      const definition = opened.tools.find((entry) => entry.name === name)!;
      const result = await definition.execute(definition.input.parse(input), {
        ...context,
        agent: { id, cwd: directory },
      } as unknown as AgentToolContext);
      captured.push(result);
      return result;
    };
    const request = await tool("request_secrets", {
      purpose: "Test credential file",
      fields: [{ name: "CONFIG", kind: "file", format: "json" }],
    });
    const requestId = (request.structuredContent as { requestId: string }).requestId;
    const ticket = await rpc("secrets.submission.begin", { agentId, requestId });
    const canary = "canary-private-native-493857";
    const data = Buffer.from(JSON.stringify({ token: canary })).toString("base64");
    const envelope = sealValue(ticket as never, {
      secrets: [],
      images: [],
      files: [{ name: "CONFIG", data, format: "json" }],
      skipped: [],
    });
    const input = { agentId, requestId, ticketId: ticket.id, envelope };
    const receipt = await rpc("secrets.submission.complete", input);
    expect(await rpc("secrets.submission.complete", input)).toEqual(receipt);
    const grantId = (receipt.grant as { id: string }).id;
    const command = {
      grantId,
      executable: process.execPath,
      args: ["-e", "process.stdout.write(require('node:fs').readFileSync(process.env.CONFIG))"],
    };
    expect((await tool("run_with_secrets", command, otherId)).isError).toBe(true);
    const execution = await tool("run_with_secrets", command);
    const output = execution.structuredContent as { stdout: string; outputId: string };
    expect(output.stdout).toBe("");
    expect((await tool("read_secret_output", { outputId: output.outputId }, otherId)).isError).toBe(
      true,
    );
    expect(
      (await tool("read_secret_output", { outputId: output.outputId })).structuredContent,
    ).toEqual({ status: "awaiting_review" });
    idle = false;
    expect(
      await rpc("secrets.output.release", { agentId, id: output.outputId, text: "Safe result" }),
    ).toEqual({ released: true, queued: true });
    const notice = {
      message: `Reviewed output is ready. Use read_secret_output with outputId "${output.outputId}".`,
    };
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(captured).not.toContainEqual(notice);
    idle = true;
    await hooks.get("agent.turn.after")!({} as never, context as never);
    await vi.waitFor(() => expect(captured).toContainEqual(notice));
    await rpc("secrets.output.notify", { agentId, id: output.outputId });
    expect(captured.filter((item) => JSON.stringify(item) === JSON.stringify(notice))).toHaveLength(
      1,
    );
    expect(
      (await tool("read_secret_output", { outputId: output.outputId })).structuredContent,
    ).toEqual({ status: "released", text: "Safe result" });
    expect((await tool("run_with_secrets", command)).isError).toBe(true);
    async function scan(folder: string): Promise<void> {
      for (const file of await readdir(folder, { withFileTypes: true })) {
        const filename = path.join(folder, file.name);
        if (file.isDirectory()) await scan(filename);
        else captured.push((await readFile(filename)).toString("utf8"));
      }
    }
    await scan(directory);
    expect(captured.length).toBeGreaterThan(10);
    const exposed = JSON.stringify([captured, logged]);
    for (const value of [canary, canary.slice(0, 18), Buffer.from(canary).toString("base64"), data])
      expect(exposed).not.toContain(value);
    expect(handlers.has("secrets.submit")).toBe(false);
    expect(handlers.has("secrets.request.submit")).toBe(false);
  } finally {
    await dispose();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
