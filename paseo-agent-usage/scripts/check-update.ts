import assert from "node:assert/strict";
import { checkForUpdate } from "../server/update-check";
import { PLUGIN_VERSION } from "../shared/version";

async function main() {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const commit = "a".repeat(40);
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://api.github.com/repos/yuruiz/paseo-plugins/git/ref/heads/main") {
      return new Response(JSON.stringify({ object: { sha: commit } }));
    }
    if (url === `https://raw.githubusercontent.com/yuruiz/paseo-plugins/${commit}/paseo-agent-usage/package.json`) {
      return new Response("unavailable", { status: 503 });
    }
    assert.equal(url, `https://api.github.com/repos/yuruiz/paseo-plugins/contents/paseo-agent-usage/package.json?ref=${commit}`);
    return new Response(JSON.stringify({ version: "99.0.0" }));
  };
  try {
    const result = await checkForUpdate();
    assert.equal(result.currentVersion, PLUGIN_VERSION);
    assert.equal(result.latestVersion, "99.0.0");
    assert.equal(result.latestCommit, commit);
    assert.equal(result.updateAvailable, true);
    assert.equal(calls.length, 3, "fallback reads the same folder at the same pinned commit");
    assert.deepEqual(await checkForUpdate(), result);
    assert.equal(calls.length, 3, "cached checks do not request GitHub again");
    console.log("collection update checks passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
