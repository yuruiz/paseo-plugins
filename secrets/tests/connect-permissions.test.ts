import { expect, test, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { OnePasswordConnect, connectTools } from "../server/connect.js";
import { sendConnectItem } from "../server/connect-share.js";
import { SecretsBroker } from "../server/broker.js";

test("plaintext permission defaults off, protects reads and writes, and does not prevent grant sharing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "connect-permissions-"));
  const requests: string[] = [];
  const value = "canary-connect-493875";
  const fixture = createServer((req, res) => {
    requests.push(req.method + " " + req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/vaults")
      res.end(JSON.stringify([{ id: "vault", name: "Vault", fields: [{ value }] }]));
    else if (req.url === "/v1/vaults/vault/items" && req.method === "GET")
      res.end(
        JSON.stringify([{ id: "item", title: "Item", category: "LOGIN", fields: [{ value }] }]),
      );
    else
      res.end(
        JSON.stringify({ id: "item", vault: { id: "vault" }, fields: [{ label: "Token", value }] }),
      );
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error();
  let connect = await OnePasswordConnect.open(directory);
  const broker = new SecretsBroker();
  const signal = new AbortController().signal;
  try {
    await connect.configure({
      url: `http://127.0.0.1:${address.port}`,
      token: "fixture-setup-token",
    });
    const call = (name: string, input: unknown) =>
      connectTools(connect)
        .find((tool) => tool.name === name)!
        .run(input, signal);
    for (const name of [
      "onepassword_get_item",
      "onepassword_create_item",
      "onepassword_replace_item",
    ]) {
      expect(
        (
          await call(name, {
            vaultId: "vault",
            itemId: "item",
            item: { title: "Item", category: "LOGIN" },
          })
        ).isError,
      ).toBe(true);
    }
    expect(requests).toEqual([]);
    const vaults = await call("onepassword_list_vaults", {});
    const items = await call("onepassword_list_items", { vaultId: "vault" });
    expect(vaults.isError).not.toBe(true);
    expect(items.isError).not.toBe(true);
    expect(JSON.stringify([vaults, items])).not.toContain(value);
    const send = vi.fn(async () => undefined);
    const shared = await sendConnectItem(
      connect,
      broker,
      { agentId: "a", cwd: process.cwd(), vaultId: "vault", itemId: "item" },
      send,
    );
    expect(shared.grant.names).toEqual(["TOKEN"]);
    expect(JSON.stringify([shared, send.mock.calls])).not.toContain(value);
    await connect.setPlaintextEnabled(true);
    expect(
      JSON.stringify(await call("onepassword_get_item", { vaultId: "vault", itemId: "item" })),
    ).toContain(value);
    await connect.close();
    connect = await OnePasswordConnect.open(directory);
    expect(connect.status().plaintextEnabled).toBe(true);
    await connect.setPlaintextEnabled(false);
    const before = requests.length;
    expect((await call("onepassword_get_item", { vaultId: "vault", itemId: "item" })).isError).toBe(
      true,
    );
    expect(requests).toHaveLength(before);
    await connect.close();
    const filename = path.join(directory, "configuration.json");
    const legacy = JSON.parse(await readFile(filename, "utf8"));
    delete legacy.plaintextEnabled;
    await writeFile(filename, JSON.stringify(legacy));
    connect = await OnePasswordConnect.open(directory);
    expect(connect.status().plaintextEnabled).toBe(false);
    expect(connect.status().enabled).toBe(true);
  } finally {
    await connect.close();
    await broker.close();
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
