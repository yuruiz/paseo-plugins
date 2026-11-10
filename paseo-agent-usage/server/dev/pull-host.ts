/** Dev-only: pull one configured host and print a summary (no local state writes). */
import { readHostsFile } from "../remote/hosts-file";
import { pullHost } from "../remote/ssh";
import { pluginDataDir } from "../scan/state";

async function main(): Promise<void> {
  const dir = pluginDataDir();
  const hosts = await readHostsFile(dir);
  const name = process.argv[2];
  const host = name ? hosts.find((item) => item.name === name) : hosts.find((item) => item.enabled);
  if (!host) {
    console.log("no matching host. configured:", hosts.map((item) => item.name));
    return;
  }
  const testHost = { ...host, timeoutMs: 600000 };
  console.log(`pulling ${testHost.name} (${testHost.target}) ...`);
  const startedAt = Date.now();
  const result = await pullHost(testHost, dir);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (!result.ok) {
    console.log(`FAILED in ${seconds}s: ${result.error}`);
    console.log("stderr tail:", result.stderr.trim().split("\n").slice(-8).join("\n"));
    return;
  }
  try {
    const projection = JSON.parse(result.stdout) as { buckets?: Record<string, unknown>; recent?: Record<string, unknown[]>; node?: string };
    console.log(
      `OK in ${seconds}s | node ${projection.node} | buckets ${Object.keys(projection.buckets ?? {}).length} | recent ${JSON.stringify(
        Object.fromEntries(Object.entries(projection.recent ?? {}).map(([key, list]) => [key, list.length])),
      )}`,
    );
    const interesting = result.stderr
      .trim()
      .split("\n")
      .filter((line) => /opencode|failed|error|warn|skip/i.test(line))
      .join(" | ");
    console.log("stderr(interesting):", interesting.slice(0, 1500) || "(none)");
    console.log("stderr tail:", result.stderr.trim().split("\n").slice(-3).join(" | "));
  } catch {
    console.log(`OK (unparsable stdout, ${result.stdout.length} bytes) in ${seconds}s`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
