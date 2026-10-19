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
