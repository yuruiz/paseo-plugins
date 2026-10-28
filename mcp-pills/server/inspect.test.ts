import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, it, expect, vi } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { inspect, safeConnectionError } from "./inspect";
import { normalizeServer } from "./discovery";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});
async function listen(server: HttpServer) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  return `http://127.0.0.1:${address.port}/mcp`;
}

it("reads real MCP tools, pagination, resources, templates, prompts and capability metadata", async () => {
  const sdk = new Server(
    { name: "fixture", version: "1.0" },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: "Fixture instructions",
    },
  );
  const calls: string[] = [];
  sdk.setRequestHandler(ListToolsRequestSchema, async (request) => {
    calls.push("tools/list");
    return request.params?.cursor
      ? {
          tools: [
            {
              name: "write",
              description: "Write a file",
              inputSchema: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          ],
        }
      : { tools: [{ name: "read", inputSchema: { type: "object" } }], nextCursor: "next" };
  });
  sdk.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ name: "guide", uri: "file:///guide", mimeType: "text/plain" }],
  }));
  sdk.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [{ name: "file", uriTemplate: "file:///{path}" }],
  }));
  sdk.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: "review", arguments: [{ name: "code", required: true }] }],
  }));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => "fixture-session",
  });
  await sdk.connect(transport);
  cleanups.push(() => sdk.close());
  const url = await listen(
    createServer((req, res) => {
      void transport.handleRequest(req, res);
    }),
  );
  const result = await inspect(
    normalizeServer("fixture", { type: "http", url, disabled_tools: ["write"] }, "test", "user"),
    process.cwd(),
  );
  expect(result.status).toBe("connected");
  expect(result.warnings).toEqual([]);
  expect(result.entries.map((entry) => entry.kind)).toEqual([
    "tool",
    "tool",
    "resource",
    "template",
    "prompt",
  ]);
  expect(result.entries.find((entry) => entry.name === "write")).toMatchObject({
    configuredDisabled: true,
    details: { inputSchema: { required: ["path"] } },
  });
  expect(result.instructions).toBe("Fixture instructions");
  expect(calls).toEqual(["tools/list", "tools/list"]);
});

it("reports authentication failures without returning credential-bearing errors", async () => {
  const url = await listen(
    createServer((_req, res) => {
      res.writeHead(401).end("secret value");
    }),
  );
  const result = await inspect(
    normalizeServer(
      "auth",
      { type: "http", url: `${url}?token=secret`, headers: { Authorization: "Bearer secret" } },
      "test",
      "user",
    ),
    process.cwd(),
  );
  expect(result.status).toBe("auth-required");
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(safeConnectionError(new Error("connect secret URL"))).toEqual({
    status: "error",
    message: expect.not.stringContaining("secret"),
  });
});

it("does not start disabled services", async () => {
  const result = await inspect(
    normalizeServer("disabled", { command: "must-not-exist", enabled: false }, "test", "user"),
    process.cwd(),
  );
  expect(result.message).toContain("禁用");
});

it("starts a stdio fixture with redirected caches and closes its input after listing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-stdio-"));
  vi.stubEnv("PASEO_MCP_PILLS_DATA_DIR", root);
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const entry = path.join(root, "fixture.mjs");
  const ended = path.join(root, "ended");
  const sdkRoot = path.dirname(
    fileURLToPath(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js")),
  );
  await writeFile(
    entry,
    `import { Server } from ${JSON.stringify(path.join(sdkRoot, "index.js"))};
import { StdioServerTransport } from ${JSON.stringify(path.join(sdkRoot, "stdio.js"))};
import { ListToolsRequestSchema } from ${JSON.stringify(path.join(sdkRoot, "../types.js"))};
import { writeFileSync } from 'node:fs';
const server = new Server({name:'stdio-fixture',version:'1'}, {capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:[{name:'env',description:process.env.TMPDIR,inputSchema:{type:'object'}}]}));
process.stdin.on('end', () => {writeFileSync(${JSON.stringify(ended)}, 'closed'); process.exit(0);});
await server.connect(new StdioServerTransport());`,
  );
  const result = await inspect(
    normalizeServer("stdio", { command: process.execPath, args: [entry] }, "test", "user"),
    root,
  );
  expect(result.status).toBe("connected");
  expect(result.entries[0].description).toContain(".cache/mcp-pills/tmp");
  expect(await readFile(ended, "utf8")).toBe("closed");
});

it("supports SSE with configured headers on both event and message requests", async () => {
  const sdk = new Server({ name: "sse-fixture", version: "1" }, { capabilities: { tools: {} } });
  sdk.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  cleanups.push(() => sdk.close());
  let transport: SSEServerTransport;
  const methods: string[] = [];
  const url = await listen(
    createServer((req, res) => {
      if (req.headers.authorization !== "Bearer fixture") {
        res.writeHead(401).end();
        return;
      }
      methods.push(req.method ?? "");
      if (req.method === "GET") {
        transport = new SSEServerTransport("/messages", res);
        void sdk.connect(transport);
      } else {
        void transport.handlePostMessage(req, res);
      }
    }),
  );
  const result = await inspect(
    normalizeServer(
      "sse",
      { type: "sse", url, headers: { Authorization: "Bearer fixture" } },
      "test",
      "user",
    ),
    process.cwd(),
  );
  expect(result.status).toBe("connected");
  expect(result.warnings).toEqual([]);
  expect(methods).toContain("GET");
  expect(methods).toContain("POST");
});

it("preserves partial results and stops when a service repeats its cursor", async () => {
  const sdk = new Server(
    { name: "partial", version: "1" },
    { capabilities: { tools: {}, prompts: {} } },
  );
  sdk.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "read", inputSchema: { type: "object" } }],
    nextCursor: "same",
  }));
  sdk.setRequestHandler(ListPromptsRequestSchema, async () => {
    throw new Error("private server error");
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => "partial" });
  await sdk.connect(transport);
  cleanups.push(() => sdk.close());
  const url = await listen(
    createServer((req, res) => {
      void transport.handleRequest(req, res);
    }),
  );
  const result = await inspect(normalizeServer("partial", { url }, "test", "user"), process.cwd());
  expect(result.status).toBe("connected");
  expect(result.entries).toHaveLength(2);
  expect(result.warnings).toEqual([
    expect.stringContaining("重复分页"),
    expect.stringContaining("读取失败"),
  ]);
  expect(JSON.stringify(result)).not.toContain("private server error");
});

it("does not launch an inspection after plugin teardown", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await inspect(
    normalizeServer("cancelled", { command: "must-not-run" }, "test", "user"),
    process.cwd(),
    controller.signal,
  );
  expect(result.status).toBe("error");
  expect(result.message).toContain("超时");
});
