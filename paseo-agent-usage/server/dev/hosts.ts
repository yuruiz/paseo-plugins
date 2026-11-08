/** Dev-only: exercise the hosts config read/write/merge logic. */
import { applyHostForms, readHostsFile, writeHostsFile } from "../remote/hosts-file";

async function main(): Promise<void> {
  const dir = `/tmp/agent-usage-hosts-test-${Date.now()}`;
  const forms = [
    { name: "dev1", target: "dev1", enabled: true, port: null, identityFile: "", passwordCommand: "", nodePath: "", cacheDir: "", timeoutMs: null, password: "<password>" },
    { name: "srv2", target: "user@example.com", enabled: true, port: 2222, identityFile: "~/.ssh/id_rsa", passwordCommand: "echo pw", nodePath: "/usr/local/bin/node", cacheDir: "", timeoutMs: 30000 },
  ];
  let result = applyHostForms([], forms);
  console.log("apply1 error:", result.error, "| hosts:", JSON.stringify(result.hosts));
  await writeHostsFile(dir, result.hosts);
  const readBack = await readHostsFile(dir);
  console.log("readback:", JSON.stringify(readBack));
  result = applyHostForms(readBack, [
    { ...forms[0]!, password: undefined },
    { ...forms[1]!, password: "" },
  ]);
  console.log("apply2 error:", result.error, "| hosts:", JSON.stringify(result.hosts));
  const mode = process.platform === "darwin" ? "stat -f %Lp" : "stat -c %a";
  const { execCommand } = await import("@getpaseo/plugin/server");
  const { stdout } = await execCommand("/bin/sh", ["-c", `${mode} ${dir}/hosts.json`]);
  console.log("hosts.json mode:", stdout.trim());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
