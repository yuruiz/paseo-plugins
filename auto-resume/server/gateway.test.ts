import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PaseoGateway } from "./gateway";
import { jobSchema } from "../shared/contracts";
const paths: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true });
});
it("uses the correct local daemon and strips agent routing on headless recovery", async () => {
  const base = process.env.TMPDIR || resolve(".cache/test-tmp");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "auto-resume-cli-"));
  paths.push(dir);
  const script = join(dir, "fake-paseo.cjs");
  const log = join(dir, "calls.jsonl");
  await writeFile(
    script,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,agent:process.env.PASEO_AGENT_ID,host:process.env.PASEO_HOST,tmp:process.env.TMPDIR})+'\\n');if(args.includes('inspect'))console.log(JSON.stringify([{Id:'a',Provider:'codex',Status:'error',Archived:false,PendingPermissions:[]}]));if(args.includes('logs'))console.log('USER: task\\nASSISTANT: limit');\n`,
  );
  await chmod(script, 0o700);
  vi.stubEnv("AUTO_RESUME_PASEO_BIN", script);
  vi.stubEnv("PASEO_AGENT_ID", "parent");
  vi.stubEnv("PASEO_HOST", "remote.example");
  const gateway = new PaseoGateway(dir, dir, new AbortController().signal);
  const view = await gateway.inspect("a");
  expect(view.transcriptHash).toMatch(/^[a-f0-9]{64}$/);
  expect(await gateway.captureTranscript("a")).toBe(view.transcriptHash);
  await gateway.send(
    jobSchema.parse({
      id: "j",
      agentId: "a",
      workspaceId: "w",
      provider: "codex",
      status: "sending",
      detectedAt: new Date().toISOString(),
      resetAt: null,
      runAt: null,
      reason: "limit",
      note: "",
      attempts: 1,
      authorized: true,
      lastUserMessageAt: null,
      transcriptHash: null,
      failureKey: "key",
    }),
  );
  const calls = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(calls).toHaveLength(4);
  for (const call of calls) {
    expect(call.args.slice(0, 3)).toEqual(["--home", dir, "--no-color"]);
    expect(call.agent).toBeUndefined();
    expect(call.host).toBeUndefined();
    expect(call.tmp).toBe(dir);
  }
  expect(calls[3].args).toContain("--no-wait");
  expect(calls[3].args).toContain("a");
});
