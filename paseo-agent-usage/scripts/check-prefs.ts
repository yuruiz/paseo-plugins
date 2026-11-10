import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUsageService } from "../server/service";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agent-usage-prefs-"));
  const dataDir = join(root, "plugin-data", "agent-usage-plugin");
  process.env.PASEO_HOME = root;

  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, "prefs.json"),
      JSON.stringify({ language: "zh", refreshMinutes: 30, localAlias: "dev" }),
      { mode: 0o600 },
    );

    const first = createUsageService();
    try {
      const [initial, concurrent] = await Promise.all([first.prefsGet(), first.prefsGet()]);
      assert.equal(initial.language, "zh", "old prefs should load before the first response");
      assert.equal(initial.coCreateDismissed, false, "missing dismissal should default to visible");
      assert.deepEqual(concurrent, initial, "concurrent startup reads should share one result");

      const [dismissed, stale] = await Promise.all([
        first.prefsSet({ ...initial, coCreateDismissed: true }),
        first.prefsSet({
          language: initial.language,
          refreshMinutes: initial.refreshMinutes,
          coCreateDismissed: false,
        }),
      ]);
      assert.equal(dismissed.saved, true);
      assert.equal(stale.saved, true);
      assert.equal((await first.prefsGet()).coCreateDismissed, true, "dismissal must be monotonic");
    } finally {
      first.stop();
    }

    const persisted = JSON.parse(await readFile(join(dataDir, "prefs.json"), "utf8")) as { coCreateDismissed?: unknown };
    assert.equal(persisted.coCreateDismissed, true, "dismissal should be written to prefs.json");

    const second = createUsageService();
    try {
      assert.equal((await second.prefsGet()).coCreateDismissed, true, "dismissal should survive a service restart");
    } finally {
      second.stop();
    }

    console.log("prefs checks passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
