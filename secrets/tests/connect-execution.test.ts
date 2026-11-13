import { afterEach, expect, test } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import { startRuntime } from "../server/runtime.js";
import { privateAgentTools } from "../server/agent-tools.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.toReversed()) await cleanup();
  cleanups.length = 0;
});

test("native and MCP execute Connect references without Share or plaintext permission", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "connect-execution-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const value = "canary-direct-connect-327894";
  let reads = 0;
  const fixture = createServer((req, res) => {
    reads++;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        id: "item",
        vault: { id: "vault" },
        fields: [
          { id: "credential", label: "Token", value },
          { id: "username", label: "Username", value: "test-user" },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  });
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error();
  const runtime = await startRuntime({ stateDirectory: directory });
  cleanups.push(() => runtime.close());
  await runtime.connect.configure({
    url: `http://127.0.0.1:${address.port}`,
    token: "fixture-token",
  });
  expect(runtime.connect.status().plaintextEnabled).toBe(false);
  const tools = privateAgentTools({
    broker: runtime.broker,
    connect: runtime.connect,
    request: async () => {
      throw new Error("Share must not be requested");
    },
    output: async () => undefined,
  });
  const context = {
    agent: { id: "native-agent", cwd: directory },
    signal: new AbortController().signal,
  } as AgentToolContext;
  const native = async (name: string, input: unknown) => {
    const tool = tools.find((t) => t.name === name)!;
    return tool.execute(tool.input.parse(input), context);
  };
  const client = new Client({ name: "direct-test", version: "1" });
  cleanups.push(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url)));
  const refs = [
    { vaultId: "vault", itemId: "item", fieldId: "credential", name: "TOKEN" },
    { vaultId: "vault", itemId: "item", fieldId: "username", name: "USER" },
  ];
  const input = {
    connect: refs,
    executable: process.execPath,
    args: [
      "-e",
      "if(process.env.USER !== 'test-user')process.exit(2); process.stdout.write(process.env.TOKEN); process.stderr.write(process.env.TOKEN)",
    ],
  };
  const fields = await native("onepassword_list_fields", { vaultId: "vault", itemId: "item" });
  expect(fields.text).toContain("credential");
  expect(JSON.stringify(fields)).not.toContain(value);
  const before = reads;
  for (const result of [
    await native("run_with_secrets", input),
    await client.callTool({ name: "run_with_secrets", arguments: input }),
  ]) {
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      exitCode: 0,
      stdout: "[REDACTED]",
      stderr: "[REDACTED]",
    });
    expect(JSON.stringify(result)).not.toContain(value);
  }
  expect(reads - before).toBe(2);
  expect(runtime.broker.list("native-agent")).toEqual([]);
  expect(
    (
      await native("run_with_secrets", {
        ...input,
        args: ["-e", "process.stdout.write(process.cwd())"],
      })
    ).structuredContent,
  ).toMatchObject({ stdout: directory });
  for (const invalid of [
    { ...input, connect: [{ ...refs[0], fieldId: "missing" }] },
    { ...input, connect: [refs[0], refs[0]] },
    { ...input, grantId: "87f6a873-8aac-44ee-8c0f-5d0cbdf3bcd3" },
    { executable: process.execPath },
    { ...input, connect: [{ ...refs[0], itemId: "wrong" }] },
  ])
    expect((await native("run_with_secrets", invalid)).isError).toBe(true);
  expect(runtime.broker.list("native-agent")).toEqual([]);
  await runtime.connect.setEnabled(false);
  const stopped = reads;
  expect((await native("run_with_secrets", input)).isError).toBe(true);
  expect((await client.callTool({ name: "run_with_secrets", arguments: input })).isError).toBe(
    true,
  );
  expect(reads).toBe(stopped);
});
