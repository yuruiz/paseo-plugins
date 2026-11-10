/** Dev-only: run a shell script on a configured host. Usage: tsx run-probe.ts <host> <script-file> */
import { readFile } from "node:fs/promises";
import { readHostsFile } from "../remote/hosts-file";
import { probeHost } from "../remote/ssh";
import { pluginDataDir } from "../scan/state";

async function main(): Promise<void> {
  const hostName = process.argv[2];
  const scriptPath = process.argv[3];
  const dir = pluginDataDir();
  const hosts = await readHostsFile(dir);
  const host = hostName ? hosts.find((item) => item.name === hostName) : hosts.find((item) => item.enabled);
  if (!host) {
    console.log("no matching host. configured:", hosts.map((item) => item.name));
    return;
  }
  if (!scriptPath) {
    console.log("usage: tsx run-probe.ts <host> <script-file>");
    return;
  }
  const script = await readFile(scriptPath, "utf8");
  const result = await probeHost(host, dir, script, 180000);
  console.log(`ok=${result.ok}`);
  console.log(result.stdout.trim());
  if (!result.ok) console.log("stderr:", result.stderr.slice(-600));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
