import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "paseo-sdk-matrix-"));
const versions = ["0.12.0", "0.13.0", "0.14.0", "0.15.0"];
const report: { version: string; typecheck: string }[] = [];
try {
  for (const version of versions) {
    const destination = join(temporary, version);
    await mkdir(destination);
    const packed = await execute(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "pack",
        `@getpaseo/plugin@${version}`,
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        destination,
      ],
      { cwd: root, maxBuffer: 1024 * 1024 },
    );
    const filename = (JSON.parse(packed.stdout) as { filename: string }[])[0].filename;
    await execute("tar", ["-xzf", join(destination, filename), "-C", destination]);
    await symlink(
      join(root, "node_modules"),
      join(destination, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const sdk = join(destination, "package", "dist");
    const config = join(destination, "tsconfig.json");
    await writeFile(
      config,
      JSON.stringify({
        extends: join(root, "tsconfig.json"),
        compilerOptions: {
          baseUrl: root,
          paths: {
            "@getpaseo/plugin": [join(sdk, "index.d.ts")],
            "@getpaseo/plugin/client": [join(sdk, "client/index.d.ts")],
            "@getpaseo/plugin/client/ui": [join(sdk, "client/ui.d.ts")],
            "@getpaseo/plugin/server": [join(sdk, "server/index.d.ts")],
          },
        },
      }),
    );
    await execute(
      process.execPath,
      [join(root, "node_modules/typescript/bin/tsc"), "--project", config, "--noEmit"],
      { cwd: root, maxBuffer: 2 * 1024 * 1024 },
    );
    report.push({ version, typecheck: "passed" });
    console.log(`PASS: Paseo plugin SDK ${version}`);
  }
  await mkdir(join(root, "artifacts"), { recursive: true });
  await writeFile(
    join(root, "artifacts/compatibility.json"),
    `${JSON.stringify({ checkedAt: new Date().toISOString(), sdkVersions: report, note: "Type compatibility; this does not replace running the plugin in each daemon and native client." }, null, 2)}\n`,
  );
} catch (error) {
  const failure = error as { stdout?: string; stderr?: string };
  console.error(failure.stdout ?? "", failure.stderr ?? "");
  throw error;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
