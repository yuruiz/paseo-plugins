import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const plugins = ["commands", "secrets", "scheduler", "github-pr", "vscode"];
const operations = ["setup", "check", "typecheck", "lint", "format", "format:check", "test"];
const [operation, ...args] = process.argv.slice(2);
const root = fileURLToPath(new URL("../", import.meta.url));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!operations.includes(operation)) fail(`Choose an operation: ${operations.join(", ")}`);
if (!process.env.npm_execpath) fail("Run this command through an npm script.");

let selected = args.length ? args : plugins;
let testFiles = [];
if (operation === "test") {
  const [plugin, ...files] = args;
  if (!plugin || files.length === 0) {
    fail("Choose one plugin and specific test files: npm test -- commands server/commands.test.ts");
  }
  selected = [plugin];
  testFiles = files;
}
for (const plugin of selected) {
  if (!plugins.includes(plugin)) fail(`Unknown plugin: ${plugin}`);
}

function run(plugin, command) {
  console.log(`\n${plugin}: npm ${command.join(" ")}`);
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...command], {
    cwd: path.join(root, plugin),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const plugin of selected) {
  if (operation === "setup") {
    run(plugin, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  } else if (operation === "check") {
    for (const script of ["typecheck", "lint", "format:check"]) run(plugin, ["run", script]);
  } else if (operation === "test") {
    run(plugin, ["run", "test", "--", ...testFiles, "--bail=1"]);
  } else {
    run(plugin, ["run", operation]);
  }
}
