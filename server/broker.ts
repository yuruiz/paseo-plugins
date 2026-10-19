import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { bundleSchema, type Secret, type SecretImage } from "../shared/contracts.js";

import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SecretsError } from "./errors.js";
export { SecretsError } from "./errors.js";
import { SecretOutputs } from "./outputs.js";

const GRANT_LIFETIME_MS = 10 * 60_000;
const MAX_GRANTS = 64;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_EXECUTION_MS = 120_000;

interface StoredGrant {
  id: string;
  agentId: string;
  cwd: string;
  secrets: Secret[];
  images: SecretImage[];
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}
interface SubmitOptions {
  agentId: string;
  cwd: string;
  secrets: Secret[];
  images?: SecretImage[];
}
interface ExecuteOptions {
  id: string;
  executable: string;
  args: string[];
  signal?: AbortSignal;
}
interface BrokerOptions {
  imageDirectory?: string;
  now?: () => number;
  executionTimeoutMs?: number;
}
export interface ExecutionResult {
  outputId?: string;
  outputStatus?: "awaiting_review";
  exitCode: number;
  stdout: string;
  stderr: string;
  reason: "exited" | "timeout" | "canceled" | "output_limit" | "spawn_failed";
}

export class SecretsBroker {
  private readonly grants = new Map<string, StoredGrant>();
  private readonly executions = new Map<AbortController, Promise<ExecutionResult>>();
  private readonly now: () => number;
  private readonly executionTimeoutMs: number;
  private closed = false;
  private imageExecutions = 0;
  readonly outputs: SecretOutputs;
  private readonly imageDirectory: string;

  constructor(options: BrokerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.outputs = new SecretOutputs(this.now);
    this.imageDirectory = options.imageDirectory ?? tmpdir();
    this.executionTimeoutMs = options.executionTimeoutMs ?? MAX_EXECUTION_MS;
  }

  submit(options: SubmitOptions) {
    if (this.closed) throw new SecretsError("closed");
    const parsed = bundleSchema.safeParse({
      secrets: options.secrets,
      images: options.images ?? [],
    });
    // Never propagate validation errors containing the input to the plugin logger.
    if (!parsed.success) throw new SecretsError("invalid");
    for (const image of parsed.data.images) validateImage(image);
    this.expire();
    const size = [...this.grants.values()].reduce(
      (sum, grant) => sum + JSON.stringify([grant.secrets, grant.images]).length * 2,
      0,
    );
    if (size + JSON.stringify(parsed.data).length * 2 > 32 * 1024 * 1024)
      throw new SecretsError("capacity");
    if (this.grants.size >= MAX_GRANTS) throw new SecretsError("capacity");
    const id = randomUUID();
    const expiresAt = this.now() + GRANT_LIFETIME_MS;
    const timer = setTimeout(() => this.remove(id), GRANT_LIFETIME_MS);
    timer.unref();
    const grant = { ...options, ...parsed.data, id, expiresAt, timer };
    this.grants.set(id, grant);
    return this.describe(grant);
  }

  list(agentId: string) {
    this.expire();
    return [...this.grants.values()]
      .filter((grant) => grant.agentId === agentId)
      .map((grant) => this.describe(grant));
  }

  revoke(agentId: string, id: string) {
    if (this.grants.get(id)?.agentId !== agentId) return false;
    return this.remove(id);
  }

  revokeAgent(agentId: string) {
    for (const grant of this.grants.values()) {
      if (grant.agentId === agentId) this.remove(grant.id);
    }
  }

  async execute(options: ExecuteOptions): Promise<ExecutionResult> {
    if (this.closed) throw new SecretsError("closed");
    this.expire();
    const grant = this.grants.get(options.id);
    if (!grant) throw new SecretsError("unavailable");
    if (this.executions.size >= 8) throw new SecretsError("capacity");
    const hasImages = grant.images.length > 0;
    if (hasImages) {
      this.outputs.assertCapacity(this.imageExecutions);
      this.imageExecutions++;
    }
    // Claim synchronously before spawning or awaiting, including failed executions.
    this.remove(grant.id);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) controller.abort();
    const execution = this.runGrant({
      ...options,
      grant,
      signal: controller.signal,
      timeoutMs: this.executionTimeoutMs,
    });
    this.executions.set(controller, execution);
    try {
      return await execution;
    } finally {
      this.executions.delete(controller);
      if (hasImages) this.imageExecutions--;
      options.signal?.removeEventListener("abort", cancel);
      grant.secrets = [];
      grant.images = [];
    }
  }

  async close() {
    this.closed = true;
    for (const id of this.grants.keys()) this.remove(id);
    for (const controller of this.executions.keys()) controller.abort();
    await Promise.allSettled(this.executions.values());
    this.outputs.close();
  }

  private async runGrant(options: RunOptions): Promise<ExecutionResult> {
    if (!options.grant.images.length) return run(options);
    let directory: string | undefined;
    try {
      await mkdir(this.imageDirectory, { recursive: true, mode: 0o700 });
      directory = await mkdtemp(path.join(this.imageDirectory, "image-"));
      const files: Secret[] = [];
      for (const [index, image] of options.grant.images.entries()) {
        const filename = path.join(directory, String(index));
        await writeFile(filename, Buffer.from(image.data, "base64"), { mode: 0o600 });
        files.push({ name: image.name, value: filename });
      }
      const result = await run({ ...options, fileSecrets: files });
      const outputId = this.outputs.hold(
        options.grant.agentId,
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
      return { ...result, stdout: "", stderr: "", outputId, outputStatus: "awaiting_review" };
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  private describe(grant: StoredGrant) {
    return {
      id: grant.id,
      names: [...grant.secrets, ...grant.images].map((secret) => secret.name),
      imageNames: grant.images.map((image) => image.name),
      expiresAt: grant.expiresAt,
    };
  }

  private expire() {
    for (const grant of this.grants.values()) {
      if (grant.expiresAt <= this.now()) this.remove(grant.id);
    }
  }

  private remove(id: string) {
    const grant = this.grants.get(id);
    if (!grant) return false;
    clearTimeout(grant.timer);
    return this.grants.delete(id);
  }
}

interface RunOptions {
  fileSecrets?: Secret[];
  grant: StoredGrant;
  executable: string;
  args: string[];
  signal: AbortSignal;
  timeoutMs: number;
}

function executionEnvironment(secrets: Secret[]) {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  for (const { name, value } of secrets) env[name] = value;
  return env;
}

function redact(text: string, secrets: Secret[]) {
  const values = secrets
    .map((secret) => secret.value)
    .sort((left, right) => right.length - left.length);
  for (const value of values) text = text.split(value).join("[REDACTED]");
  return text;
}

function run({
  grant,
  executable,
  args,
  signal,
  timeoutMs,
  fileSecrets = [],
}: RunOptions): Promise<ExecutionResult> {
  const empty = { exitCode: 1, stdout: "", stderr: "" };
  if (signal.aborted) return Promise.resolve({ ...empty, reason: "canceled" });
  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn(executable, args, {
      cwd: grant.cwd,
      env: executionEnvironment([...grant.secrets, ...fileSecrets]),
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return Promise.resolve({ ...empty, reason: "spawn_failed" });
  }
  return new Promise((resolve) => {
    let reason: ExecutionResult["reason"] = "exited";
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    function killGroup() {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
          child.kill("SIGKILL");
      }
    }
    function stop(next: ExecutionResult["reason"]) {
      if (reason === "exited") reason = next;
      killGroup();
    }
    function collect(target: Buffer[], chunk: Buffer) {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        stdout.length = 0;
        stderr.length = 0;
        stop("output_limit");
        return;
      }
      target.push(chunk);
    }
    const cancel = () => stop("canceled");
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    signal.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", () => stop("spawn_failed"));
    child.on("exit", killGroup);
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      // Buffer bounded output until close so UTF-8 and secrets spanning chunks remain intact.
      // On overflow discard everything, including a potentially incomplete secret suffix.
      const output =
        reason === "output_limit"
          ? ""
          : redact(Buffer.concat(stdout).toString("utf8"), grant.secrets);
      const errors =
        reason === "output_limit"
          ? ""
          : redact(Buffer.concat(stderr).toString("utf8"), grant.secrets);
      const exitCode = code !== null && code >= 0 ? code : 1;
      // oxlint mistakes clearTimeout above for settling this promise; close is registered once.
      // eslint-disable-next-line promise/no-multiple-resolved
      resolve({ exitCode, stdout: output, stderr: errors, reason });
    });
  });
}

function validateImage(image: SecretImage) {
  const bytes = Buffer.from(image.data, "base64");
  const valid =
    image.data === bytes.toString("base64") &&
    ((image.mimeType === "image/png" &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (image.mimeType === "image/jpeg" &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255) ||
      (image.mimeType === "image/webp" &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP"));
  if (!valid) throw new SecretsError("invalid");
}
