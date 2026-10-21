import { SecretRequests } from "../server/requests.js";
import { SecretOutputs } from "../server/outputs.js";
import { afterEach, expect, test } from "vitest";
import { SecretsBroker } from "../server/broker.js";
import { startRuntime } from "../server/runtime.js";
import { createSecretForm } from "../client/form.js";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const brokers: SecretsBroker[] = [];
afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.close()));
});

function grantFor(broker: SecretsBroker) {
  return broker.submit({
    agentId: "agent-a",
    cwd: process.cwd(),
    secrets: [{ name: "TOKEN", value: "ephemeral-test-value" }],
  });
}

test("expired and revoked grants cannot execute, including across agents", async () => {
  let now = 0;
  const broker = new SecretsBroker({ now: () => now });
  brokers.push(broker);
  const expired = grantFor(broker);
  now = expired.expiresAt;
  await expect(
    broker.execute({ id: expired.id, executable: process.execPath, args: [] }),
  ).rejects.toThrow("Grant unavailable");
  const revoked = grantFor(broker);
  expect(broker.revoke("agent-b", revoked.id)).toBe(false);
  expect(broker.revoke("agent-a", revoked.id)).toBe(true);
  await expect(
    broker.execute({ id: revoked.id, executable: process.execPath, args: [] }),
  ).rejects.toThrow("Grant unavailable");
});

test("concurrent requests cannot claim the same grant twice", async () => {
  const broker = new SecretsBroker();
  brokers.push(broker);
  const grant = grantFor(broker);
  const options = {
    id: grant.id,
    executable: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
  };
  const first = broker.execute(options);
  await expect(broker.execute(options)).rejects.toThrow("Grant unavailable");
  expect((await first).stdout).toBe("ok");
});

test("split UTF-8 output, multiple secrets and both output streams are masked before delivery", async () => {
  const broker = new SecretsBroker();
  brokers.push(broker);
  const grant = broker.submit({
    agentId: "a",
    cwd: process.cwd(),
    secrets: [
      { name: "FIRST", value: "测试-token-long" },
      { name: "SECOND", value: "测试-token" },
    ],
  });
  const result = await broker.execute({
    id: grant.id,
    executable: process.execPath,
    args: [
      "-e",
      `
    const value = Buffer.from(process.env.FIRST);
    process.stdout.write(value.subarray(0, 2));
    setTimeout(() => { process.stdout.write(value.subarray(2)); process.stderr.write(process.env.SECOND); }, 10);
  `,
    ],
  });
  expect(result.stdout).toBe("[REDACTED]");
  expect(result.stderr).toBe("[REDACTED]");
});

test("excess output is discarded without returning an incomplete secret prefix", async () => {
  const broker = new SecretsBroker();
  brokers.push(broker);
  const grant = grantFor(broker);
  const result = await broker.execute({
    id: grant.id,
    executable: process.execPath,
    args: [
      "-e",
      "process.stdout.write('x'.repeat(1024 * 1024) + process.env.TOKEN); setInterval(() => {}, 1000)",
    ],
  });
  expect(result.reason).toBe("output_limit");
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

test("execution has a deadline and closing the broker cancels live commands", async () => {
  const timed = new SecretsBroker({ executionTimeoutMs: 50 });
  const broker = new SecretsBroker();
  brokers.push(timed, broker);
  const args = ["-e", "setInterval(() => {}, 1000)"];
  const result = await timed.execute({
    id: grantFor(timed).id,
    executable: process.execPath,
    args,
  });
  expect(result.reason).toBe("timeout");
  const pending = broker.execute({ id: grantFor(broker).id, executable: process.execPath, args });
  await broker.close();
  expect((await pending).reason).toBe("canceled");
  expect(() => grantFor(broker)).toThrow("Secrets plugin is stopped");
});

test("spawn errors never echo input and consume the grant", async () => {
  const broker = new SecretsBroker();
  brokers.push(broker);
  const grant = grantFor(broker);
  const result = await broker.execute({
    id: grant.id,
    executable: "/missing/ephemeral-test-value",
    args: [],
  });
  expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "", reason: "spawn_failed" });
  expect(broker.list("agent-a")).toEqual([]);
});

test("ordinary descendants cannot keep pipes open after their parent exits", async () => {
  const broker = new SecretsBroker({ executionTimeoutMs: 1500 });
  brokers.push(broker);
  const result = await broker.execute({
    id: grantFor(broker).id,
    executable: process.execPath,
    args: [
      "-e",
      "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }).unref(); process.stdout.write('done')",
    ],
  });
  expect(result).toEqual({ exitCode: 0, stdout: "done", stderr: "", reason: "exited" });
});

test("MCP discovers the execution tool and returns only redacted output from the real broker", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "secrets-mcp-test-"));
  const runtime = await startRuntime({ stateDirectory });
  const client = new Client({ name: "secrets-test", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url)));
    const inventory = await client.listTools();
    expect(inventory.tools.map((tool) => tool.name)).toEqual([
      "request_secrets",
      "read_secret_output",
      "run_with_secrets",
      "onepassword_list_vaults",
      "onepassword_list_items",
      "onepassword_get_item",
      "onepassword_create_item",
      "onepassword_replace_item",
    ]);
    const grant = grantFor(runtime.broker);
    const args = {
      grantId: grant.id,
      executable: process.execPath,
      args: ["-e", "process.stdout.write(process.env.TOKEN)"],
    };
    const result = await client.callTool({ name: "run_with_secrets", arguments: args });
    expect(result.structuredContent).toEqual({
      exitCode: 0,
      stdout: "[REDACTED]",
      stderr: "",
      reason: "exited",
    });
    expect(JSON.stringify(result)).not.toContain("ephemeral-test-value");
    expect((await client.callTool({ name: "run_with_secrets", arguments: args })).isError).toBe(
      true,
    );
  } finally {
    await client.close();
    await runtime.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("plugin reload reuses the MCP address but does not retain grants or values", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "secrets-mcp-reload-"));
  const first = await startRuntime({ stateDirectory });
  const grant = grantFor(first.broker);
  const url = first.url;
  await first.close();
  const second = await startRuntime({ stateDirectory });
  const client = new Client({ name: "reload-test", version: "1" });
  try {
    expect(second.url).toBe(url);
    expect(second.broker.list("agent-a")).toEqual([]);
    const persisted = JSON.parse(
      await readFile(path.join(stateDirectory, "endpoint.json"), "utf8"),
    );
    expect(persisted).toEqual({ port: Number(new URL(url).port) });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const result = await client.callTool({
      name: "run_with_secrets",
      arguments: { grantId: grant.id, executable: process.execPath, args: [] },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("ephemeral-test-value");
  } finally {
    await client.close();
    await second.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("form values are cleared on submit, failures are safe and a retry requires re-entry", async () => {
  let calls = 0;
  const form = createSecretForm(async () => {
    calls++;
    throw new Error("do-not-show-input");
  });
  form.edit(1, "name", "TOKEN");
  form.edit(1, "value", "do-not-show-input");
  const pending = form.save();
  expect(form.getState().fields[0].value).toBe("");
  expect(form.getState().status).toBe("saving");
  await pending;
  expect(form.getState().status).toBe("editing");
  expect(form.getState().error).toContain("Check pending grants");
  expect(JSON.stringify(form.getState())).not.toContain("do-not-show-input");
  await form.save();
  expect(calls).toBe(1);
  form.close();
  expect(form.getState().fields).toEqual([]);
});

test("form submission validates duplicate names and supports multiple variables", async () => {
  const submitted: string[][] = [];
  const form = createSecretForm(async (secrets) => {
    submitted.push(secrets.map(({ name }) => name));
  });
  form.edit(1, "name", "FIRST");
  form.edit(1, "value", "value-a");
  form.add();
  form.edit(2, "name", "FIRST");
  form.edit(2, "value", "value-b");
  await form.save();
  expect(submitted).toEqual([]);
  form.edit(2, "name", "SECOND");
  await form.save();
  expect(submitted).toEqual([["FIRST", "SECOND"]]);
  expect(form.getState().status).toBe("saved");
});

test("a one-use grant injects only into its child and masks stdout and stderr", async () => {
  const broker = new SecretsBroker();
  brokers.push(broker);
  const value = "test-credential-" + crypto.randomUUID();
  const grant = broker.submit({
    agentId: "agent-a",
    cwd: process.cwd(),
    secrets: [{ name: "PASEO_TEST_SECRET", value }],
  });
  expect(JSON.stringify(broker.list("agent-a"))).not.toContain(value);
  expect(broker.list("agent-b")).toEqual([]);
  const result = await broker.execute({
    id: grant.id,
    executable: process.execPath,
    args: [
      "-e",
      "process.stdout.write(process.env.PASEO_TEST_SECRET); process.stderr.write(process.env.PASEO_TEST_SECRET)",
    ],
  });
  expect(result).toEqual({
    exitCode: 0,
    stdout: "[REDACTED]",
    stderr: "[REDACTED]",
    reason: "exited",
  });
  expect(process.env.PASEO_TEST_SECRET).toBeUndefined();
  expect(broker.list("agent-a")).toEqual([]);
  await expect(
    broker.execute({ id: grant.id, executable: process.execPath, args: [] }),
  ).rejects.toThrow("Grant unavailable");
});

const testImage = {
  name: "DOCUMENT",
  mimeType: "image/png" as const,
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z1sAAAAASUVORK5CYII=",
};

test("private requests enforce requested types, one submission, decline and expiry", () => {
  let now = 0;
  const requests = new SecretRequests(() => now);
  const input = {
    agentId: "a",
    purpose: "Read the document",
    fields: [{ name: "DOCUMENT", kind: "image" as const }],
  };
  const request = requests.create(input);
  const grant = { id: "grant", names: ["DOCUMENT"], expiresAt: 600_000 };
  expect(() => requests.get("b", request.id)).toThrow();
  expect(() =>
    requests.fulfill(
      "a",
      request.id,
      { secrets: [{ name: "DOCUMENT", value: "wrong-kind" }], images: [] },
      () => grant,
    ),
  ).toThrow();
  expect(
    requests.fulfill("a", request.id, { secrets: [], images: [testImage] }, () => grant),
  ).toEqual(grant);
  expect(JSON.stringify(requests.list("a"))).not.toContain(testImage.data);
  expect(() =>
    requests.fulfill("a", request.id, { secrets: [], images: [testImage] }, () => grant),
  ).toThrow();
  const declined = requests.create(input);
  requests.decline("a", declined.id);
  expect(() =>
    requests.fulfill("a", declined.id, { secrets: [], images: [testImage] }, () => grant),
  ).toThrow();
  const expired = requests.create(input);
  now = expired.expiresAt;
  expect(requests.get("a", expired.id).status).toBe("expired");
});

test("image execution keeps all output behind review and cleans private files", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "secrets-image-test-"));
  const runtime = await startRuntime({
    stateDirectory,
    onRequest: async (input, requests) => requests.create(input),
  });
  const client = new Client({ name: "image-test", version: "1" });
  const agentId = crypto.randomUUID();
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url)));
    const request = await client.callTool({
      name: "request_secrets",
      arguments: {
        agentId,
        purpose: "Extract document",
        fields: [{ name: "DOCUMENT", kind: "image" }],
      },
    });
    expect(request.structuredContent).toMatchObject({ status: "pending" });
    const grant = runtime.broker.submit({
      agentId,
      cwd: process.cwd(),
      secrets: [],
      images: [testImage],
    });
    const result = await client.callTool({
      name: "run_with_secrets",
      arguments: {
        grantId: grant.id,
        executable: process.execPath,
        args: [
          "-e",
          `
      const fs = require('node:fs');
      const file = process.env.DOCUMENT;
      if ((fs.statSync(file).mode & 511) !== 384 || (fs.statSync(require('node:path').dirname(file)).mode & 511) !== 448) process.exit(2);
      if (fs.readFileSync(file).toString('base64') !== '${testImage.data}') process.exit(3);
      process.stdout.write('private-ocr-text'); process.stderr.write('private-diagnostic');
    `,
        ],
      },
    });
    expect(result.structuredContent).toMatchObject({
      exitCode: 0,
      stdout: "",
      stderr: "",
      outputStatus: "awaiting_review",
    });
    expect(JSON.stringify(result)).not.toContain("private-ocr-text");
    const outputId = String(result.structuredContent?.outputId);
    const withheld = await client.callTool({ name: "read_secret_output", arguments: { outputId } });
    expect(withheld.structuredContent).toEqual({ status: "awaiting_review" });
    expect(runtime.broker.outputs.preview(agentId, outputId)).toContain("private-ocr-text");
    expect(runtime.broker.outputs.preview(agentId, outputId)).toContain("private-diagnostic");
    expect(() => runtime.broker.outputs.release("other-agent", outputId, "bad")).toThrow();
    runtime.broker.outputs.release(agentId, outputId, "Approved summary");
    const released = await client.callTool({ name: "read_secret_output", arguments: { outputId } });
    expect(released.structuredContent).toEqual({ status: "released", text: "Approved summary" });
    expect(JSON.stringify(released)).not.toContain("private-ocr-text");
    expect(await readdir(path.join(stateDirectory, "images"))).toEqual([]);
    const failed = runtime.broker.submit({
      agentId,
      cwd: process.cwd(),
      secrets: [],
      images: [testImage],
    });
    expect(
      (
        await runtime.broker.execute({
          id: failed.id,
          executable: "/missing/image-consumer",
          args: [],
        })
      ).reason,
    ).toBe("spawn_failed");
    expect(await readdir(path.join(stateDirectory, "images"))).toEqual([]);
    const canceled = runtime.broker.submit({
      agentId,
      cwd: process.cwd(),
      secrets: [],
      images: [testImage],
    });
    const pending = runtime.broker.execute({
      id: canceled.id,
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    });
    await runtime.broker.close();
    expect((await pending).reason).toBe("canceled");
    expect(await readdir(path.join(stateDirectory, "images"))).toEqual([]);
  } finally {
    await client.close();
    await runtime.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("malformed images are rejected and held output expires or is discarded", () => {
  const broker = new SecretsBroker();
  brokers.push(broker);
  expect(() =>
    broker.submit({
      agentId: "a",
      cwd: process.cwd(),
      secrets: [],
      images: [{ ...testImage, data: Buffer.from("not an image").toString("base64") }],
    }),
  ).toThrow("Invalid secret");
  expect(() =>
    broker.submit({
      agentId: "a",
      cwd: process.cwd(),
      secrets: [],
      images: [{ ...testImage, mimeType: "image/jpeg" }],
    }),
  ).toThrow("Invalid secret");
  let now = 0;
  const outputs = new SecretOutputs(() => now);
  const id = outputs.hold("a", "private");
  expect(() => outputs.preview("b", id)).toThrow();
  outputs.discard("a", id);
  expect(() => outputs.read(id)).toThrow();
  const expired = outputs.hold("a", "private");
  now = 600_000;
  expect(() => outputs.read(expired)).toThrow();
});

test("image form clears bytes before submission and after failure", async () => {
  const form = createSecretForm(
    async (_, images) => {
      expect(images[0].data).toBe(testImage.data);
      throw new Error("private");
    },
    [{ name: "DOCUMENT", kind: "image" }],
  );
  form.setImage(1, testImage);
  const pending = form.save();
  expect(form.getState().fields[0].image).toBeUndefined();
  await pending;
  expect(JSON.stringify(form.getState())).not.toContain(testImage.data);
  expect(form.getState().status).toBe("editing");
  form.close();
});

test("missing requested inputs identify the field and preserve entered values until submission", async () => {
  let submissions = 0;
  const form = createSecretForm(async () => {
    submissions++;
  }, [
    { name: "TEST_SECRET", kind: "text" },
    { name: "TEST_IMAGE", kind: "image" },
  ]);
  await form.save();
  expect(form.getState().error).toBe(
    "Enter a secret value for TEST_SECRET. This field is required.",
  );
  form.edit(1, "value", "test-value-to-preserve");
  await form.save();
  expect(submissions).toBe(0);
  expect(form.getState().error).toBe("Choose an image for TEST_IMAGE. This field is required.");
  expect(form.getState().error).not.toContain("test-value-to-preserve");
  expect(form.getState().fields[0].value).toBe("test-value-to-preserve");
  form.setImage(2, testImage);
  expect(form.getState().error).toBeNull();
  await form.save();
  expect(submissions).toBe(1);
  expect(form.getState().status).toBe("saved");
  expect(form.getState().fields[0].value).toBe("");
  expect(form.getState().fields[1].image).toBeUndefined();
  form.close();
});

test("question steps require an answer before advancing and retain private input when revisiting", async () => {
  const form = createSecretForm(
    async () => undefined,
    [
      { name: "TOKEN", kind: "text" },
      { name: "DOCUMENT", kind: "image" },
    ],
  );
  form.next();
  expect(form.getState().activeIndex).toBe(0);
  form.edit(1, "value", "private-step-value");
  form.next();
  expect(form.getState().activeIndex).toBe(1);
  form.setImage(2, testImage);
  form.select(0);
  expect(form.getState().fields[0].value).toBe("private-step-value");
  form.next();
  expect(form.getState().fields[1].image?.data).toBe(testImage.data);
  await form.save();
  expect(form.getState().activeIndex).toBe(0);
  expect(JSON.stringify(form.getState())).not.toContain("private-step-value");
  expect(form.getState().fields[1].image).toBeUndefined();
  form.close();
});

test("skipping clears an input, permits revisiting, and submits only provided fields", async () => {
  let result: unknown;
  const form = createSecretForm(
    async (secrets, images, skipped) => {
      result = structuredClone({ secrets, images, skipped });
    },
    [
      { name: "TOKEN", kind: "text" },
      { name: "DOCUMENT", kind: "image" },
    ],
  );
  form.edit(1, "value", "discard-this-value");
  form.skip();
  expect(form.getState().activeIndex).toBe(1);
  expect(form.getState().fields[0].value).toBe("");
  expect(form.getState().fields[0].skipped).toBe(true);
  form.select(0);
  form.restore(1);
  expect(form.getState().fields[0].value).toBe("");
  form.edit(1, "value", "keep-this-value");
  form.next();
  form.setImage(2, testImage);
  form.skip();
  form.setImage(2, testImage); // A file read completing after Skip must not reattach its bytes.
  expect(form.getState().fields[1].image).toBeUndefined();
  await form.save();
  expect(result).toEqual({
    secrets: [{ name: "TOKEN", value: "keep-this-value" }],
    images: [],
    skipped: ["DOCUMENT"],
  });
  expect(JSON.stringify(form.getState())).not.toContain("keep-this-value");
  form.close();
});

test("request completion requires an exact provided/skipped partition and never grants empty input", async () => {
  const requests = new SecretRequests();
  const input = {
    agentId: "a",
    purpose: "Test skip",
    fields: [
      { name: "TOKEN", kind: "text" as const },
      { name: "DOCUMENT", kind: "image" as const },
    ],
  };
  const request = requests.create(input);
  let creates = 0;
  const create = () => {
    creates++;
    return { id: "grant", names: ["TOKEN"], expiresAt: 600_000 };
  };
  const bundle = { secrets: [{ name: "TOKEN", value: "private" }], images: [] };
  for (const skipped of [[], ["UNKNOWN"], ["TOKEN"], ["DOCUMENT", "DOCUMENT"]]) {
    expect(() => requests.submit("a", request.id, bundle, skipped, create)).toThrow();
  }
  expect(creates).toBe(0);
  const partial = requests.submit("a", request.id, bundle, ["DOCUMENT"], create);
  expect(partial.grant?.names).toEqual(["TOKEN"]);
  expect(partial.grant?.skippedNames).toEqual(["DOCUMENT"]);
  expect(() => requests.submit("a", request.id, bundle, ["DOCUMENT"], create)).toThrow();
  const empty = requests.create(input);
  expect(
    requests.submit("a", empty.id, { secrets: [], images: [] }, ["TOKEN", "DOCUMENT"], create),
  ).toEqual({ grant: null, skipped: ["TOKEN", "DOCUMENT"] });
  expect(creates).toBe(1);
  expect(requests.get("a", empty.id).status).toBe("skipped");
});

test("the form can finish an all-skipped request without creating any secret fields", async () => {
  let result: unknown;
  const form = createSecretForm(
    async (secrets, images, skipped) => {
      result = structuredClone({ secrets, images, skipped });
    },
    [{ name: "TOKEN", kind: "text" }],
  );
  form.skip();
  await form.save();
  expect(result).toEqual({ secrets: [], images: [], skipped: ["TOKEN"] });
  expect(form.getState().status).toBe("saved");
  form.close();
});

test("Connect tools perform list, read, create and replace through HTTP and disconnect closes access", async () => {
  const { createServer } = await import("node:http");
  const received: { method: string; url: string; authorization: string; body: unknown }[] = [];
  const fixture = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");
      received.push({
        method: request.method!,
        url: request.url!,
        authorization: request.headers.authorization!,
        body: text ? JSON.parse(text) : null,
      });
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/v1/vaults/denied/items") {
        response.writeHead(403).end(JSON.stringify({ message: "sensitive-upstream-error" }));
      } else if (request.url === "/v1/vaults/redirect/items") {
        response.writeHead(302, { Location: "/v1/vaults" }).end();
      } else {
        response.end(JSON.stringify({ id: "item", fields: [{ value: "fixture-value" }] }));
      }
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "secrets-connect-test-"));
  const runtime = await startRuntime({ stateDirectory });
  const client = new Client({ name: "connect-test", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url)));
    expect(
      (await client.callTool({ name: "onepassword_list_vaults", arguments: {} })).isError,
    ).toBe(true);
    expect(received).toEqual([]);
    await runtime.connect.configure({
      url: `http://127.0.0.1:${address.port}/`,
      token: "fixture-token",
    });
    expect(runtime.connect.status()).toEqual({
      configured: true,
      proxyUrl: null,
      enabled: true,
      error: null,
      url: `http://127.0.0.1:${address.port}/`,
    });
    await client.callTool({ name: "onepassword_list_vaults", arguments: {} });
    await client.callTool({
      name: "onepassword_list_items",
      arguments: { vaultId: "vault", filter: 'title eq "Database"' },
    });
    const read = await client.callTool({
      name: "onepassword_get_item",
      arguments: { vaultId: "vault", itemId: "item" },
    });
    expect(read.content).toEqual([
      { type: "text", text: JSON.stringify({ id: "item", fields: [{ value: "fixture-value" }] }) },
    ]);
    const item = {
      title: "Test",
      category: "LOGIN",
      fields: [{ id: "password", value: "fixture-value" }],
      vault: { id: "wrong-vault" },
    };
    const created = await client.callTool({
      name: "onepassword_create_item",
      arguments: { vaultId: "vault", item },
    });
    expect(created.isError).not.toBe(true);
    const replaced = await client.callTool({
      name: "onepassword_replace_item",
      arguments: { vaultId: "vault", itemId: "item", item },
    });
    expect(replaced.isError).not.toBe(true);
    expect(received).toEqual([
      { method: "GET", url: "/v1/vaults", authorization: "Bearer fixture-token", body: null },
      {
        method: "GET",
        url: "/v1/vaults/vault/items?filter=title%20eq%20%22Database%22",
        authorization: "Bearer fixture-token",
        body: null,
      },
      {
        method: "GET",
        url: "/v1/vaults/vault/items/item",
        authorization: "Bearer fixture-token",
        body: null,
      },
      {
        method: "POST",
        url: "/v1/vaults/vault/items",
        authorization: "Bearer fixture-token",
        body: { ...item, vault: { id: "vault" } },
      },
      {
        method: "PUT",
        url: "/v1/vaults/vault/items/item",
        authorization: "Bearer fixture-token",
        body: { ...item, id: "item", vault: { id: "vault" } },
      },
    ]);
    const denied = await client.callTool({
      name: "onepassword_list_items",
      arguments: { vaultId: "denied" },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain("HTTP 403");
    expect(JSON.stringify(denied)).not.toContain("sensitive-upstream-error");
    const redirected = await client.callTool({
      name: "onepassword_list_items",
      arguments: { vaultId: "redirect" },
    });
    expect(redirected.isError).toBe(true);
    expect(received).toHaveLength(7);
    const invalid = await client.callTool({
      name: "onepassword_get_item",
      arguments: { vaultId: "../vault", itemId: "item" },
    });
    expect(invalid.isError).toBe(true);
    expect(received).toHaveLength(7);
    await runtime.connect.remove();
    expect(runtime.connect.status()).toEqual({
      configured: false,
      proxyUrl: null,
      enabled: false,
      url: null,
      error: null,
    });
    expect(
      (await client.callTool({ name: "onepassword_list_vaults", arguments: {} })).isError,
    ).toBe(true);
    expect(received).toHaveLength(7);
    const disk = await readFile(path.join(stateDirectory, "endpoint.json"), "utf8");
    expect(disk).not.toContain("fixture-token");
  } finally {
    await client.close();
    await runtime.close();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("Connect disconnect cancels an outstanding HTTP request and invalid configuration preserves the previous connection", async () => {
  const { OnePasswordConnect } = await import("../server/connect.js");
  const { createServer } = await import("node:http");
  let reached: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const fixture = createServer(() => reached());
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const directory = await mkdtemp(path.join(tmpdir(), "connect-cancel-"));
  const connect = await OnePasswordConnect.open(directory);
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await connect.configure({ url, token: "fixture-token" });
    await expect(
      connect.configure({ url: "https://user:password@example.com", token: "replacement-token" }),
    ).rejects.toThrow("Invalid Connect URL or token.");
    expect(connect.status()).toEqual({
      configured: true,
      proxyUrl: null,
      enabled: true,
      url,
      error: null,
    });
    const pending = connect.request("GET", "vaults", undefined, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow("1Password Connect request failed");
    await requested;
    await connect.remove();
    await rejected;
    expect(connect.status()).toEqual({
      configured: false,
      proxyUrl: null,
      enabled: false,
      url: null,
      error: null,
    });
  } finally {
    await connect.remove();
    await connect.close();
    await rm(directory, { recursive: true, force: true });
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});

test("Connect persists credentials privately across restart, disable/enable and deletion", async () => {
  const { stat, chmod, writeFile } = await import("node:fs/promises");
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "secrets-connect-persist-"));
  let runtime = await startRuntime({ stateDirectory });
  const url = "https://connect.example.com";
  const directory = path.join(stateDirectory, "connect");
  const file = path.join(directory, "configuration.json");
  try {
    await runtime.connect.configure({ url, token: "persisted-test-token" });
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      version: 1,
      proxyUrl: null,
      enabled: true,
      url,
      token: "persisted-test-token",
    });
    expect(runtime.connect.status()).toEqual({
      configured: true,
      proxyUrl: null,
      enabled: true,
      url,
      error: null,
    });
    await runtime.close();
    const legacy = JSON.parse(await readFile(file, "utf8"));
    delete legacy.proxyUrl;
    await writeFile(file, JSON.stringify(legacy));
    await chmod(directory, 0o755);
    await chmod(file, 0o644);
    runtime = await startRuntime({ stateDirectory });
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(runtime.connect.status()).toEqual({
      configured: true,
      proxyUrl: null,
      enabled: true,
      url,
      error: null,
    });
    await runtime.connect.setEnabled(false);
    await runtime.close();
    runtime = await startRuntime({ stateDirectory });
    expect(runtime.connect.status()).toEqual({
      configured: true,
      proxyUrl: null,
      enabled: false,
      url,
      error: null,
    });
    await expect(
      runtime.connect.request("GET", "vaults", undefined, new AbortController().signal),
    ).rejects.toThrow("disabled");
    await runtime.connect.setEnabled(true);
    expect(runtime.connect.status()).toEqual({
      configured: true,
      proxyUrl: null,
      enabled: true,
      url,
      error: null,
    });
    await runtime.connect.remove();
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    await runtime.close();
    runtime = await startRuntime({ stateDirectory });
    expect(runtime.connect.status()).toEqual({
      configured: false,
      proxyUrl: null,
      enabled: false,
      url: null,
      error: null,
    });
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await runtime.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("Connect preserves corrupt files for recovery and never exposes stored credentials in status", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { OnePasswordConnect } = await import("../server/connect.js");
  const directory = await mkdtemp(path.join(tmpdir(), "connect-recovery-"));
  const file = path.join(directory, "configuration.json");
  const damaged = '{"token":"private-corrupt-value",';
  await writeFile(file, damaged);
  const connect = await OnePasswordConnect.open(directory);
  try {
    expect(connect.status()).toEqual({
      configured: false,
      proxyUrl: null,
      enabled: false,
      url: null,
      error: "Stored Connect configuration could not be read. Replace or delete it.",
    });
    expect(await readFile(file, "utf8")).toBe(damaged);
    await connect.configure({
      url: "https://connect.example.com",
      token: "private-replacement-value",
    });
    expect(connect.status()).toEqual({
      configured: true,
      proxyUrl: null,
      enabled: true,
      url: "https://connect.example.com",
      error: null,
    });
    const previous = await readFile(file, "utf8");
    // Make the destination unusable to exercise a real rename failure, even when tests run as root.
    await rm(file);
    await mkdir(file);
    await expect(
      connect.configure({ url: "https://changed.example.com", token: "failed-replacement-value" }),
    ).rejects.toThrow("Could not save Connect configuration");
    expect(connect.status()).toEqual({
      configured: true,
      proxyUrl: null,
      enabled: true,
      url: "https://connect.example.com",
      error: null,
    });
    expect(await readdir(directory)).toEqual(["configuration.json"]);
    await rm(file, { recursive: true });
    await writeFile(file, previous);
    await connect.setEnabled(false);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      version: 1,
      proxyUrl: null,
      enabled: false,
      url: "https://connect.example.com",
      token: "private-replacement-value",
    });
  } finally {
    await connect.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Connect serializes saves and waits for the last accepted write during shutdown", async () => {
  const { OnePasswordConnect } = await import("../server/connect.js");
  const directory = await mkdtemp(path.join(tmpdir(), "connect-writes-"));
  const connect = await OnePasswordConnect.open(directory);
  try {
    const first = connect.configure({ url: "https://first.example.com", token: "first-token" });
    const second = connect.configure({ url: "https://second.example.com", token: "second-token" });
    const disable = connect.setEnabled(false);
    const closing = connect.close();
    await Promise.all([first, second, disable, closing]);
    await expect(
      connect.configure({ url: "https://late.example.com", token: "late-token" }),
    ).rejects.toThrow("stopped");
    const restored = await OnePasswordConnect.open(directory);
    expect(restored.status()).toEqual({
      configured: true,
      proxyUrl: null,
      enabled: false,
      url: "https://second.example.com",
      error: null,
    });
    await restored.remove();
    await restored.close();
  } finally {
    await connect.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Connect connection tests use saved credentials without enabling access or returning vault metadata", async () => {
  const { createServer } = await import("node:http");
  const { OnePasswordConnect } = await import("../server/connect.js");
  const requests: { method: string; url: string; authorization: string }[] = [];
  const fixture = createServer((request, response) => {
    requests.push({
      method: request.method!,
      url: request.url!,
      authorization: request.headers.authorization!,
    });
    response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization === "Bearer rejected-token") {
      response.writeHead(401).end(JSON.stringify({ message: "rejected-token" }));
    } else {
      response.end(JSON.stringify([{ id: "vault-id", name: "Private vault name" }]));
    }
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const directory = await mkdtemp(path.join(tmpdir(), "connect-test-action-"));
  let connect = await OnePasswordConnect.open(directory);
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await connect.configure({ url, token: "accepted-token" });
    await connect.setEnabled(false);
    await connect.close();
    connect = await OnePasswordConnect.open(directory);
    expect(await connect.test()).toEqual({ vaultCount: 1 });
    expect(connect.status()).toEqual({
      configured: true,
      proxyUrl: null,
      enabled: false,
      url,
      error: null,
    });
    expect(requests).toEqual([
      { method: "GET", url: "/v1/vaults", authorization: "Bearer accepted-token" },
    ]);
    await connect.configure({ url, token: "rejected-token" });
    await expect(connect.test()).rejects.toThrow("HTTP 401");
  } finally {
    await connect.close();
    await rm(directory, { recursive: true, force: true });
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});

test("client Connect browsing returns only list metadata, including while agent access is disabled", async () => {
  const { createServer } = await import("node:http");
  const { OnePasswordConnect } = await import("../server/connect.js");
  const paths: string[] = [];
  const fixture = createServer((request, response) => {
    paths.push(request.url!);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/vaults") {
      response.end(
        JSON.stringify([{ id: "vault", name: "Engineering", description: "private-description" }]),
      );
    } else if (request.url === "/v1/vaults/vault/items") {
      response.end(
        JSON.stringify([
          {
            id: "item",
            title: "Database",
            category: "DATABASE",
            tags: ["production"],
            updatedAt: "2026-10-21T00:00:00Z",
            fields: [{ value: "never-return-this-value" }],
            notesPlain: "private-note",
          },
        ]),
      );
    } else if (request.url === "/v1/vaults/empty/items") {
      response.end("[]");
    } else {
      response.writeHead(403).end('{"message":"private-error"}');
    }
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const directory = await mkdtemp(path.join(tmpdir(), "connect-browser-"));
  const connect = await OnePasswordConnect.open(directory);
  try {
    await expect(connect.listVaults()).rejects.toThrow("Configure");
    await connect.configure({ url: `http://127.0.0.1:${address.port}`, token: "test-token" });
    await connect.setEnabled(false);
    expect(await connect.listVaults()).toEqual([{ id: "vault", name: "Engineering" }]);
    expect(await connect.listItems({ vaultId: "vault" })).toEqual([
      {
        id: "item",
        title: "Database",
        category: "DATABASE",
        tags: ["production"],
        updatedAt: "2026-10-21T00:00:00Z",
      },
    ]);
    expect(await connect.listItems({ vaultId: "empty" })).toEqual([]);
    await expect(connect.listItems({ vaultId: "denied" })).rejects.toThrow("HTTP 403");
    await expect(connect.listItems({ vaultId: "../other" })).rejects.toThrow("Invalid vault ID");
    expect(paths).toEqual([
      "/v1/vaults",
      "/v1/vaults/vault/items",
      "/v1/vaults/empty/items",
      "/v1/vaults/denied/items",
    ]);
    expect(connect.status().enabled).toBe(false);
    await connect.remove();
    await expect(connect.listVaults()).rejects.toThrow("Configure");
  } finally {
    await connect.close();
    await rm(directory, { recursive: true, force: true });
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});

test("Secrets state directory follows Paseo's default and custom home rules without requiring PASEO_HOME", async () => {
  const { homedir } = await import("node:os");
  const { resolveStateDirectory } = await import("../server/state-directory.js");
  expect(resolveStateDirectory({})).toBe(
    path.join(homedir(), ".paseo", "plugin-state", "secrets-mcp"),
  );
  expect(resolveStateDirectory({ PASEO_HOME: "/custom/daemon" })).toBe(
    path.join("/custom/daemon", "plugin-state", "secrets-mcp"),
  );
  expect(resolveStateDirectory({ PASEO_HOME: "~/custom-daemon" })).toBe(
    path.join(homedir(), "custom-daemon", "plugin-state", "secrets-mcp"),
  );
  expect(resolveStateDirectory({ PASEO_HOME: "~" })).toBe(
    path.join(homedir(), "plugin-state", "secrets-mcp"),
  );
  expect(resolveStateDirectory({ PASEO_HOME: ".dev/paseo-home" })).toBe(
    path.resolve(".dev/paseo-home", "plugin-state", "secrets-mcp"),
  );
});

test("Connect uses an explicit HTTP proxy for metadata and writes, persists it, and never falls back to direct", async () => {
  const { createServer } = await import("node:http");
  const { OnePasswordConnect } = await import("../server/connect.js");
  const seen: { method: string; url: string; authorization: string; body: string }[] = [];
  const proxy = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      seen.push({
        method: request.method!,
        url: request.url!,
        authorization: request.headers.authorization!,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.setHeader("Content-Type", "application/json");
      response.end(
        request.method === "GET" ? '[{"id":"vault","name":"Test"}]' : '{"id":"created"}',
      );
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Missing proxy address");
  const directory = await mkdtemp(path.join(tmpdir(), "connect-proxy-"));
  let connect = await OnePasswordConnect.open(directory);
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  try {
    await connect.configure({ url: "http://connect.invalid", token: "proxy-test-token", proxyUrl });
    expect(await connect.listVaults()).toEqual([{ id: "vault", name: "Test" }]);
    expect(
      await connect.request(
        "POST",
        "vaults/vault/items",
        { title: "Test" },
        new AbortController().signal,
      ),
    ).toEqual({ id: "created" });
    expect(seen).toEqual([
      {
        method: "GET",
        url: "http://connect.invalid/v1/vaults",
        authorization: "Bearer proxy-test-token",
        body: "",
      },
      {
        method: "POST",
        url: "http://connect.invalid/v1/vaults/vault/items",
        authorization: "Bearer proxy-test-token",
        body: '{"title":"Test"}',
      },
    ]);
    await connect.setEnabled(false);
    await connect.close();
    connect = await OnePasswordConnect.open(directory);
    expect(connect.status().proxyUrl).toBe(proxyUrl);
    expect(await connect.test()).toEqual({ vaultCount: 1 });
    await connect.setProxy(null);
    expect(connect.status().enabled).toBe(false);
    expect(connect.status().proxyUrl).toBeNull();
    await connect.setProxy(proxyUrl);
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await expect(connect.test()).rejects.toThrow("request failed");
    expect(
      JSON.parse(await readFile(path.join(directory, "configuration.json"), "utf8")).token,
    ).toBe("proxy-test-token");
  } finally {
    await connect.close();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test.each([
  { scheme: "socks5h", host: "connect.invalid" },
  { scheme: "socks5", host: "127.0.0.1" },
])(
  "Connect sends requests through $scheme and resolves names on the requested side",
  async ({ scheme, host }) => {
    const net = await import("node:net");
    const { createServer } = await import("node:http");
    const { once } = await import("node:events");
    const { OnePasswordConnect } = await import("../server/connect.js");
    const upstream = createServer((request, response) => {
      expect(request.headers.authorization).toBe("Bearer socks-test-token");
      response.setHeader("Content-Type", "application/json");
      response.end('[{"id":"vault","name":"Via SOCKS"}]');
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const target = upstream.address();
    if (!target || typeof target === "string") throw new Error("Missing target address");
    const sockets = new Set<import("node:net").Socket>();
    const destinations: { host: string; port: number }[] = [];
    const proxy = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      void handshake(socket).catch(() => socket.destroy());
    });
    async function handshake(socket: import("node:net").Socket) {
      async function read(size: number): Promise<Buffer> {
        let chunk = socket.read(size);
        while (chunk === null) {
          await once(socket, "readable");
          if (socket.destroyed) throw new Error("Socket closed");
          chunk = socket.read(size);
        }
        return Buffer.from(chunk);
      }
      const greeting = await read(2);
      await read(greeting[1]);
      socket.write(Buffer.from([5, 0]));
      const header = await read(4);
      let destination: string;
      if (header[3] === 3) {
        const length = await read(1);
        destination = (await read(length[0])).toString("utf8");
      } else {
        destination = [...(await read(4))].join(".");
      }
      const port = (await read(2)).readUInt16BE();
      destinations.push({ host: destination, port });
      const outgoing = net.createConnection({ host: "127.0.0.1", port: target.port });
      sockets.add(outgoing);
      outgoing.on("close", () => sockets.delete(outgoing));
      await once(outgoing, "connect");
      socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
      outgoing.on("error", () => socket.destroy());
      socket.on("error", () => outgoing.destroy());
      socket.pipe(outgoing).pipe(socket);
    }
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("Missing proxy address");
    const directory = await mkdtemp(path.join(tmpdir(), "connect-socks-"));
    const connect = await OnePasswordConnect.open(directory);
    try {
      await connect.configure({
        url: `http://${host}:${target.port}`,
        token: "socks-test-token",
        proxyUrl: `${scheme}://127.0.0.1:${address.port}`,
      });
      expect(await connect.listVaults()).toEqual([{ id: "vault", name: "Via SOCKS" }]);
      expect(destinations).toEqual([{ host, port: target.port }]);
      await expect(connect.setProxy("file:///tmp/socket")).rejects.toThrow(
        "Invalid Connect proxy URL",
      );
      await expect(connect.setProxy("http://user:password@127.0.0.1:1055")).rejects.toThrow(
        "Invalid Connect proxy URL",
      );
      expect(connect.status().proxyUrl).toBe(`${scheme}://127.0.0.1:${address.port}`);
    } finally {
      await connect.close();
      for (const socket of sockets) socket.destroy();
      upstream.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => proxy.close(() => resolve())),
        new Promise<void>((resolve) => upstream.close(() => resolve())),
      ]);
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("Connect aborts a stalled HTTPS proxy tunnel when its proxy configuration changes", async () => {
  const { createServer } = await import("node:http");
  const { OnePasswordConnect } = await import("../server/connect.js");
  let arrived: () => void = () => {};
  let disconnected: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  const requests: { method: string; url: string; authorization: string | undefined }[] = [];
  const sockets = new Set<import("node:stream").Duplex>();
  const proxy = createServer();
  proxy.on("connect", (request, socket) => {
    requests.push({
      method: request.method!,
      url: request.url!,
      authorization: request.headers.authorization,
    });
    sockets.add(socket);
    socket.on("data", () => {});
    socket.once("end", () => socket.end());
    socket.once("close", disconnected);
    arrived();
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Missing proxy address");
  const directory = await mkdtemp(path.join(tmpdir(), "connect-proxy-abort-"));
  const connect = await OnePasswordConnect.open(directory);
  try {
    await connect.configure({
      url: "https://connect.invalid",
      token: "must-not-be-sent-before-tls",
      proxyUrl: `http://127.0.0.1:${address.port}`,
    });
    const pending = expect(connect.test()).rejects.toThrow("request failed");
    await opened;
    await connect.setProxy(null);
    await pending;
    await closed;
    expect(requests).toEqual([
      { method: "CONNECT", url: "connect.invalid:443", authorization: undefined },
    ]);
  } finally {
    await connect.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("Connect rejects untrusted TLS certificates through an HTTP proxy", async () => {
  const { execFileSync } = await import("node:child_process");
  const { createServer } = await import("node:http");
  const { createServer: createTlsServer } = await import("node:https");
  const { createConnection } = await import("node:net");
  const { OnePasswordConnect } = await import("../server/connect.js");
  const directory = await mkdtemp(path.join(tmpdir(), "connect-proxy-tls-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      path.join(directory, "key.pem"),
      "-out",
      path.join(directory, "cert.pem"),
      "-subj",
      "/CN=localhost",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  let requests = 0;
  const upstream = createTlsServer(
    {
      key: await readFile(path.join(directory, "key.pem")),
      cert: await readFile(path.join(directory, "cert.pem")),
    },
    (_, response) => {
      requests++;
      response.end("[]");
    },
  );
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const target = upstream.address();
  if (!target || typeof target === "string") throw new Error("Missing target address");
  const sockets = new Set<import("node:stream").Duplex>();
  const proxy = createServer();
  proxy.on("connect", (_, socket, head) => {
    const outgoing = createConnection({ host: "127.0.0.1", port: target.port }, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) outgoing.write(head);
      socket.pipe(outgoing).pipe(socket);
    });
    sockets.add(socket);
    sockets.add(outgoing);
    outgoing.on("error", () => socket.destroy());
    socket.on("error", () => outgoing.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Missing proxy address");
  const connect = await OnePasswordConnect.open(path.join(directory, "state"));
  try {
    await connect.configure({
      url: `https://localhost:${target.port}`,
      token: "not-sent-to-untrusted-server",
      proxyUrl: `http://127.0.0.1:${address.port}`,
    });
    await expect(connect.test()).rejects.toThrow("request failed");
    expect(requests).toBe(0);
  } finally {
    await connect.close();
    for (const socket of sockets) socket.destroy();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => upstream.close(() => resolve())),
    ]);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Connect does not bypass a failing proxy even when its destination is directly reachable", async () => {
  const { createServer } = await import("node:http");
  const { OnePasswordConnect } = await import("../server/connect.js");
  let directRequests = 0;
  const target = createServer((_, response) => {
    directRequests++;
    response.end("[]");
  });
  const proxy = createServer((_, response) => response.writeHead(503).end("private-proxy-error"));
  await Promise.all([
    new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve)),
  ]);
  const targetAddress = target.address();
  const proxyAddress = proxy.address();
  if (
    !targetAddress ||
    typeof targetAddress === "string" ||
    !proxyAddress ||
    typeof proxyAddress === "string"
  )
    throw new Error("Missing addresses");
  const directory = await mkdtemp(path.join(tmpdir(), "connect-no-proxy-bypass-"));
  const connect = await OnePasswordConnect.open(directory);
  try {
    await connect.configure({
      url: `http://127.0.0.1:${targetAddress.port}`,
      token: "proxy-only-token",
      proxyUrl: `http://127.0.0.1:${proxyAddress.port}`,
    });
    await expect(connect.test()).rejects.toThrow("HTTP 503");
    expect(directRequests).toBe(0);
    await connect.setProxy(null);
    expect(await connect.test()).toEqual({ vaultCount: 0 });
    expect(directRequests).toBe(1);
  } finally {
    await connect.close();
    proxy.closeAllConnections();
    target.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => target.close(() => resolve())),
    ]);
    await rm(directory, { recursive: true, force: true });
  }
});
