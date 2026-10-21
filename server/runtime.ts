import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SecretsBroker, SecretsError } from "./broker.js";

import { OnePasswordConnect, registerConnectTools } from "./connect.js";
import { SecretRequests } from "./requests.js";
import {
  requestInputSchema,
  type SecretRequestInput,
  type SecretRequest,
} from "../shared/contracts.js";

const executionSchema = {
  grantId: z.string().uuid().describe("The one-use grant ID supplied by the user in Paseo."),
  executable: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes("\0")),
  args: z
    .array(
      z
        .string()
        .max(16_384)
        .refine((value) => !value.includes("\0")),
    )
    .max(256)
    .default([]),
};
const endpointSchema = z.object({ port: z.number().int().min(1).max(65535) });

interface RuntimeOptions {
  stateDirectory: string;
  onRequest?(input: SecretRequestInput, requests: SecretRequests): Promise<SecretRequest>;
  onOutput?(outputId: string, agentId: string): Promise<void>;
}

export async function startRuntime({ stateDirectory, onRequest, onOutput }: RuntimeOptions) {
  if (process.platform === "win32") throw new Error("Secrets requires a macOS or Linux host.");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const endpointFile = path.join(stateDirectory, "endpoint.json");
  let port = 0;
  try {
    port = endpointSchema.parse(JSON.parse(await readFile(endpointFile, "utf8"))).port;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const imageDirectory = path.join(stateDirectory, "images");
  const broker = new SecretsBroker({ imageDirectory });
  const requests = new SecretRequests();
  const connect = await OnePasswordConnect.open(path.join(stateDirectory, "connect"));
  const server = createServer((request, response) => {
    void handleRequest({ request, response, broker, requests, connect, onRequest, onOutput }).catch(
      () => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const expiry = setInterval(() => {
    requests.prune();
    broker.outputs.prune();
  }, 30_000);
  expiry.unref();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Secrets MCP could not listen.");
  const url = `http://127.0.0.1:${address.port}/mcp`;
  async function close() {
    clearInterval(expiry);
    await connect.close();
    requests.close();
    await broker.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      server.closeAllConnections();
    });
  }
  // Persist only the port so existing MCP configurations can reconnect after reload.
  try {
    await rm(imageDirectory, { recursive: true, force: true });
    const temporaryFile = `${endpointFile}.${randomUUID()}.tmp`;
    await writeFile(temporaryFile, JSON.stringify({ port: address.port }), { mode: 0o600 });
    await rename(temporaryFile, endpointFile);
  } catch (error) {
    await close();
    throw error;
  }
  return { broker, requests, connect, url, close };
}

interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  broker: SecretsBroker;
  requests: SecretRequests;
  connect: OnePasswordConnect;
  onRequest?: RuntimeOptions["onRequest"];
  onOutput?: RuntimeOptions["onOutput"];
}

async function handleRequest({
  request,
  response,
  broker,
  requests,
  connect,
  onRequest,
  onOutput,
}: RequestContext) {
  const expectedHost = `127.0.0.1:${request.socket.localPort}`;
  if (request.url !== "/mcp" || request.headers.origin || request.headers.host !== expectedHost) {
    response.writeHead(403).end();
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" }).end();
    return;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 65_536) {
      response.writeHead(413).end();
      return;
    }
    chunks.push(buffer);
  }
  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    response.writeHead(400).end();
    return;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  response.once("close", cancel);
  const mcp = new McpServer({ name: "paseo-secrets", version: "0.4.1" });
  mcp.registerTool(
    "request_secrets",
    {
      title: "Request private input",
      description:
        "Ask the user for sensitive text or images in their current Paseo conversation. Supply this Paseo agent ID (read PASEO_AGENT_ID from your environment), a clear purpose and named fields. Text becomes an environment value; image becomes a private file path in the named environment variable. Returns pending immediately. Finish your turn and wait for the user's grant notification; do not poll. Never ask the user to paste private data into chat. Image output requires user review before release.",
      inputSchema: requestInputSchema,
    },
    async (requestInput) => {
      try {
        if (!onRequest) throw new Error("unavailable");
        const pending = await onRequest(requestInput, requests);
        const result = { requestId: pending.id, status: "pending", expiresAt: pending.expiresAt };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Could not open private input. Check the agent ID and open Secrets in the Paseo client before retrying.",
            },
          ],
        };
      }
    },
  );
  mcp.registerTool(
    "read_secret_output",
    {
      title: "Read reviewed output",
      description:
        "Read only the output explicitly released by the user. Pending output remains withheld. Wait for the user's release notification instead of polling.",
      inputSchema: { outputId: z.string().uuid() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ outputId }) => {
      try {
        const result = broker.outputs.read(outputId);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch {
        return {
          isError: true,
          content: [{ type: "text", text: "Output unavailable or expired." }],
        };
      }
    },
  );
  mcp.registerTool(
    "run_with_secrets",
    {
      title: "Run with secrets",
      description:
        "Execute a command with the user's one-use Paseo secrets grant. Values are injected into the child environment, never returned directly. Runs in the grant's agent working directory. Text-only output is buffered and exact values are masked. For grants containing images, ALL output is held for user review; only status and outputId are returned. Image paths are injected as environment variables and deleted after execution. The grant is consumed even on failure. Maximum execution: 120 seconds, 1 MiB output. Do not print, persist, encode or inspect credentials. Supply executable and argv; explicitly use sh -c for shell syntax. No interactive input or background services.",
      inputSchema: executionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ grantId, executable, args }, extra) => {
      extra.signal.addEventListener("abort", cancel, { once: true });
      if (extra.signal.aborted) controller.abort();
      try {
        const result = await broker.execute({
          id: grantId,
          executable,
          args,
          signal: controller.signal,
        });
        if (result.outputId && onOutput) {
          // Publication failure must not disclose output or undo a consumed grant.
          await onOutput(result.outputId, broker.outputs.agentId(result.outputId)).catch(
            () => undefined,
          );
        }
        return {
          isError: result.exitCode !== 0,
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: { ...result },
        };
      } catch (error) {
        const message = error instanceof SecretsError ? error.message : "Secrets execution failed.";
        return { isError: true, content: [{ type: "text", text: message }] };
      } finally {
        extra.signal.removeEventListener("abort", cancel);
      }
    },
  );
  registerConnectTools(mcp, connect);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await mcp.connect(transport);
    response.setHeader("Cache-Control", "no-store");
    await transport.handleRequest(request, response, input);
  } finally {
    response.removeListener("close", cancel);
    await mcp.close();
  }
}
