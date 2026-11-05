import { expect, test, vi } from "vitest";
import { SealedSubmissions } from "../server/submissions.js";
import { SecretNotifications } from "../server/notifications.js";
import { createSealedSender } from "../client/submission.js";
import { MAX_SEALED_PLAINTEXT, sealBytes, sealValue } from "../shared/sealing.js";
import { SecretsBroker } from "../server/broker.js";

test("sealed submissions bind their destination and accept identical retries only once", () => {
  const submissions = new SealedSubmissions<{ id: string }>();
  const ticket = submissions.begin("agent-a/request-a");
  const value = "private-test-canary-48395";
  const envelope = sealValue(ticket, { value });
  const consume = vi.fn((bytes: Uint8Array) => {
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({ value });
    return { id: "grant" };
  });
  expect(JSON.stringify([ticket, envelope])).not.toContain(value);
  expect(() => submissions.complete(ticket.id, "agent-b/request-a", envelope, consume)).toThrow();
  expect(submissions.complete(ticket.id, ticket.scope, envelope, consume)).toEqual({ id: "grant" });
  expect(submissions.complete(ticket.id, ticket.scope, envelope, consume)).toEqual({ id: "grant" });
  expect(consume).toHaveBeenCalledOnce();
  expect(() =>
    submissions.complete(ticket.id, ticket.scope, sealValue(ticket, { value: "changed" }), consume),
  ).toThrow();
  expect(consume).toHaveBeenCalledOnce();
});

test("modified ciphertext, request binding and expired keys cannot create grants", () => {
  let now = 0;
  const vault = new SealedSubmissions(() => now);
  const ticket = vault.begin("a");
  const envelope = sealValue({ ...ticket, scope: "b" }, { value: "never-return-this" });
  const consume = vi.fn();
  expect(() => vault.complete(ticket.id, "a", envelope, consume)).toThrow("Invalid secret fields");
  const valid = sealValue(ticket, { value: "never-return-this" });
  expect(() =>
    vault.complete(
      ticket.id,
      "a",
      {
        ...valid,
        ciphertext: (valid.ciphertext[0] === "A" ? "B" : "A") + valid.ciphertext.slice(1),
      },
      consume,
    ),
  ).toThrow();
  now = ticket.expiresAt;
  expect(() => vault.complete(ticket.id, "a", valid, consume)).toThrow();
  expect(consume).not.toHaveBeenCalled();
});

test("lost reply retries only ciphertext and never creates another execution grant", async () => {
  const vault = new SealedSubmissions<ReturnType<SecretsBroker["submit"]>>();
  const broker = new SecretsBroker();
  const ticket = vault.begin("a");
  const payload = { secrets: [{ name: "TOKEN", value: "canary-lost-reply-4938" }] };
  const captured: unknown[] = [];
  let loseReply = true;
  const sender = createSealedSender(
    async () => ticket,
    async ({ ticketId, envelope }) => {
      captured.push(envelope);
      const grant = vault.complete(ticketId, "a", envelope, (bytes) =>
        broker.submit({
          agentId: "a",
          cwd: process.cwd(),
          ...JSON.parse(new TextDecoder().decode(bytes)),
        }),
      );
      if (loseReply) {
        loseReply = false;
        throw new Error("connection lost");
      }
      return grant;
    },
  );
  try {
    await expect(sender.submit(payload)).rejects.toThrow("connection lost");
    expect(sender.hasPending()).toBe(true);
    const grant = await sender.retry();
    expect(broker.list("a")).toHaveLength(1);
    expect(captured[0]).toEqual(captured[1]);
    expect(JSON.stringify([captured, grant, ticket])).not.toContain(payload.secrets[0].value);
    const result = await broker.execute({
      id: grant.id,
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write(process.env.TOKEN); process.stderr.write(process.env.TOKEN)",
      ],
    });
    expect(result.stdout).toBe("[REDACTED]");
    expect(result.stderr).toBe("[REDACTED]");
    await expect(
      broker.execute({ id: grant.id, executable: process.execPath, args: [] }),
    ).rejects.toThrow();
  } finally {
    sender.close();
    vault.close();
    await broker.close();
  }
});

test("maximum-size encrypted probe is accepted and larger payloads fail closed", () => {
  const vault = new SealedSubmissions<number>();
  const ticket = vault.begin("selftest");
  const bytes = new Uint8Array(MAX_SEALED_PLAINTEXT).fill(97);
  const envelope = sealBytes(ticket, bytes);
  expect(
    vault.complete(ticket.id, "selftest", envelope, (opened) => {
      expect(Buffer.from(opened).equals(bytes)).toBe(true);
      return opened.length;
    }),
  ).toBe(bytes.length);
  expect(() => sealBytes(ticket, new Uint8Array(MAX_SEALED_PLAINTEXT + 1))).toThrow();
  vault.close();
});

test("notifications wait for idle, retry failed delivery and stop after expiry or shutdown", async () => {
  let now = 0;
  let idle = false;
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("disconnected"))
    .mockResolvedValue(undefined);
  const notices = new SecretNotifications({ idle: async () => idle, send }, () => now);
  notices.enqueue("grant", { agentId: "a", expiresAt: 100, message: () => "grant metadata" });
  await notices.flush();
  expect(send).not.toHaveBeenCalled();
  idle = true;
  await notices.flush();
  await notices.flush();
  expect(send).toHaveBeenCalledTimes(2);
  await notices.flush();
  expect(send).toHaveBeenCalledTimes(2);
  now = 101;
  notices.enqueue("expired", { agentId: "a", expiresAt: 100, message: () => "stale" });
  await notices.flush();
  notices.close();
  notices.enqueue("closed", { agentId: "a", expiresAt: 200, message: () => "stale" });
  await notices.flush();
  expect(send).toHaveBeenCalledTimes(2);
});
