import { readFile, writeFile } from "node:fs/promises";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (typeof version !== "string" || !version) throw new Error("package.json must specify a version");

const target = new URL("../shared/version.ts", import.meta.url);
const source = `// Generated from package.json by npm run sync:version. Do not edit.\nexport const pluginVersion = ${JSON.stringify(version)};\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== source) {
    throw new Error("Plugin version is out of date; run npm run sync:version");
  }
  console.log(`PASS: plugin version ${version}`);
} else {
  await writeFile(target, source);
  console.log(`Updated plugin version to ${version}`);
}
