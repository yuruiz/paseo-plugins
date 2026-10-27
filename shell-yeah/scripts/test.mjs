import { spawnSync } from "node:child_process";

const files = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  ["--test", ...(files.length ? files : ["*/*.test.ts", "*.test.ts"])],
  { stdio: "inherit", env: process.env },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
