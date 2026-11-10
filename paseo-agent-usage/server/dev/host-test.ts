/** Dev-only: exercise the SSH test probe end to end. */
import { testHost, type HostConfig } from "../remote/ssh";

async function main(): Promise<void> {
  const unreachable: HostConfig = { name: "local-test", target: "localhost", enabled: true, timeoutMs: 15000 };
  console.log("unreachable:", JSON.stringify(await testHost(unreachable, "/tmp")));
  const withPassword: HostConfig = { name: "pw-test", target: "localhost", enabled: true, password: "dummy", timeoutMs: 15000 };
  console.log("password mode:", JSON.stringify(await testHost(withPassword, "/tmp")));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
