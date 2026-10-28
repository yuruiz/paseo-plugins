import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { OnePasswordConnect } from "../server/connect.js";
import { SecretsBroker } from "../server/broker.js";
import { sendConnectItem } from "../server/connect-share.js";

let fixture: Server;
let directory: string;
let connect: OnePasswordConnect;
let broker: SecretsBroker;
let response: unknown;
let paths: string[];
const input = { agentId: "agent-a", cwd: process.cwd(), vaultId: "vault", itemId: "item" };

beforeEach(async () => {
  response = {
    id: "item",
    vault: { id: "vault" },
    title: "Database",
    fields: [
      { label: "User name", value: "test-user-value" },
      { label: "Password", value: "test-secret-value" },
      { label: "Password", value: "second-secret-value" },
      { label: "2fa", value: "test-otp-value" },
      { label: "Empty", value: "" },
    ],
  };
  paths = [];
  fixture = createServer((request, reply) => {
    paths.push(request.url!);
    reply.setHeader("Content-Type", "application/json");
    reply.end(JSON.stringify(response));
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  directory = await mkdtemp(path.join(tmpdir(), "connect-share-"));
  connect = await OnePasswordConnect.open(directory);
  await connect.configure({ url: `http://127.0.0.1:${address.port}`, token: "fixture-token" });
  broker = new SecretsBroker();
});

afterEach(async () => {
  await broker.close();
  await connect.close();
  fixture.closeAllConnections();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

test("sharing uses the existing one-use grant and sends only metadata", async () => {
  const send = vi.fn(async (_message: string) => undefined);
  const result = await sendConnectItem(connect, broker, input, send);
  expect(paths).toEqual(["/v1/vaults/vault/items/item"]);
  expect(result.grant.names).toEqual(["USER_NAME", "PASSWORD", "PASSWORD_2", "FIELD_2FA"]);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0]).toContain(result.grant.id);
  expect(send.mock.calls[0][0]).toContain("run_with_secrets");
  for (const value of [
    "test-user-value",
    "test-secret-value",
    "second-secret-value",
    "test-otp-value",
  ]) {
    expect(JSON.stringify(result)).not.toContain(value);
    expect(send.mock.calls[0][0]).not.toContain(value);
  }
  expect(broker.list("agent-b")).toEqual([]);
  expect(broker.list(input.agentId)).toEqual([result.grant]);
  const execution = {
    id: result.grant.id,
    executable: process.execPath,
    args: [
      "-e",
      "if (process.env.PASSWORD === 'test-secret-value' && process.env.PASSWORD_2 === 'second-secret-value' && process.env.USER_NAME === 'test-user-value') process.stdout.write('ok');",
    ],
  };
  expect((await broker.execute(execution)).stdout).toBe("ok");
  await expect(broker.execute(execution)).rejects.toThrow("Grant unavailable");
});

test("failed notification revokes the new grant and returns a sanitized error", async () => {
  const send = vi.fn(async () => {
    throw new Error("test-secret-value");
  });
  await expect(sendConnectItem(connect, broker, input, send)).rejects.toThrow(
    "Could not share the secret.",
  );
  expect(broker.list(input.agentId)).toEqual([]);
});

test("disabled Connect cannot create or share a grant", async () => {
  await connect.setEnabled(false);
  const send = vi.fn(async () => undefined);
  await expect(sendConnectItem(connect, broker, input, send)).rejects.toThrow(
    "Could not share the secret.",
  );
  expect(send).not.toHaveBeenCalled();
  expect(paths).toEqual([]);
  expect(broker.list(input.agentId)).toEqual([]);
});

test.each([
  { id: "other", vault: { id: "vault" }, fields: [{ value: "test-secret-value" }] },
  { id: "item", vault: { id: "other" }, fields: [{ value: "test-secret-value" }] },
  { id: "item", vault: { id: "vault" }, fields: [] },
  { id: "item", vault: { id: "vault" }, fields: [{ value: "a\0b" }] },
])("invalid items create no grant or notification (%#)", async (invalid) => {
  response = invalid;
  const send = vi.fn(async () => undefined);
  await expect(sendConnectItem(connect, broker, input, send)).rejects.toThrow(
    "Could not share the secret.",
  );
  expect(send).not.toHaveBeenCalled();
  expect(broker.list(input.agentId)).toEqual([]);
});
