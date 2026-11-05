import { expect, test } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SecretsBroker } from "../server/broker.js";
import { SecretRequests } from "../server/requests.js";
import { createSecretForm } from "../client/form.js";
import { validSecretFile, pastedSecretFile } from "../shared/files.js";

test.each(["any", "json", "pem"] as const)(
  "%s file contents stay out of output until released and private files are removed",
  async (format) => {
    const source = {
      json: '{"token":"canary-json-48237"}',
      pem: "-----BEGIN PRIVATE KEY-----\nY2FuYXJ5\n-----END PRIVATE KEY-----\n",
      any: "binary\0canary-4837",
    }[format];
    const directory = await mkdtemp(path.join(tmpdir(), "secret-file-"));
    const broker = new SecretsBroker({ imageDirectory: directory });
    try {
      const grant = broker.submit({
        agentId: "a",
        cwd: process.cwd(),
        secrets: [],
        files: [{ name: "CREDENTIAL", format, data: Buffer.from(source).toString("base64") }],
      });
      expect(grant.fileNames).toEqual(["CREDENTIAL"]);
      const result = await broker.execute({
        id: grant.id,
        executable: process.execPath,
        args: [
          "-e",
          "const fs = require('node:fs'); if ((fs.statSync(process.env.CREDENTIAL).mode & 511) !== 384) process.exit(2); process.stdout.write(fs.readFileSync(process.env.CREDENTIAL));",
        ],
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(broker.outputs.read(result.outputId!)).toEqual({ status: "awaiting_review" });
      expect(broker.outputs.preview("a", result.outputId!)).toContain(source);
      broker.outputs.release("a", result.outputId!, "safe summary");
      expect(broker.outputs.read(result.outputId!)).toEqual({
        status: "released",
        text: "safe summary",
      });
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await broker.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("file validation rejects format substitution, malformed base64 and oversized files", async () => {
  const requests = new SecretRequests();
  const request = requests.create({
    agentId: "a",
    purpose: "certificate",
    fields: [{ name: "CERT", kind: "file", format: "pem" }],
  });
  const file = {
    name: "CERT",
    format: "any" as const,
    data: Buffer.from("not a certificate").toString("base64"),
  };
  expect(() =>
    requests.submit("a", request.id, { secrets: [], images: [], files: [file] }, [], () => {
      throw new Error("must not create");
    }),
  ).toThrow("Invalid secret fields");
  expect(validSecretFile({ ...file, format: "pem" })).toBe(false);
  expect(validSecretFile({ ...file, format: "json" })).toBe(false);
  expect(validSecretFile({ ...file, data: "%%%%" })).toBe(false);
  expect(pastedSecretFile("x".repeat(128 * 1024 + 1), "any")).toBeNull();
  expect(pastedSecretFile("字".repeat(128 * 1024), "any")).toBeNull();
  const broker = new SecretsBroker();
  try {
    expect(() =>
      broker.submit({
        agentId: "a",
        cwd: process.cwd(),
        secrets: [],
        files: [{ ...file, format: "json" }],
      }),
    ).toThrow("Invalid secret fields");
  } finally {
    await broker.close();
  }
});

test("file forms clear bytes on submission and skipping", async () => {
  let received = "";
  const form = createSecretForm(
    async (_, __, ___, files) => {
      expect(form.getState().fields[0].file).toBeUndefined();
      received = files[0].data;
    },
    [{ name: "CONFIG", kind: "file", format: "json" }],
  );
  const file = pastedSecretFile('{"value":"canary-form-2734"}', "json")!;
  form.setFile(1, file);
  form.skip();
  expect(form.getState().fields[0].file).toBeUndefined();
  form.restore(1);
  form.setFile(1, file);
  await form.save();
  expect(received).toBe(file.data);
  expect(form.getState().status).toBe("saved");
  form.close();
});
