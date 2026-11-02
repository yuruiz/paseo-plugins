import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Store } from "./store";
import { defaults } from "../shared/contracts";
const paths: string[] = [];
const opened: Store[] = [];
afterEach(async () => {
  for (const store of opened.splice(0)) await store.close();
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true });
});
async function directory() {
  const base = process.env.TMPDIR || resolve(".cache/test-tmp");
  await mkdir(base, { recursive: true });
  const path = await mkdtemp(join(base, "auto-resume-store-"));
  paths.push(path);
  return path;
}
it("persists preferences across reload and serializes concurrent writes", async () => {
  const home = await directory();
  const path = join(home, "state");
  const store = await Store.open(path, home);
  opened.push(store);
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      store.update((state) => {
        state.preferences[String(i)] = { ...defaults(), enabled: true };
      }),
    ),
  );
  await store.close();
  const loaded = await Store.open(path, home);
  opened.push(loaded);
  expect(Object.keys(loaded.snapshot().preferences)).toHaveLength(10);
  expect(JSON.parse(await readFile(join(path, "state.json"), "utf8")).version).toBe(1);
});
it("refuses a second writer", async () => {
  const home = await directory();
  const store = await Store.open(join(home, "state"), home);
  opened.push(store);
  await expect(Store.open(join(home, "state"), home)).rejects.toThrow();
});
it("does not replace corrupted state with empty defaults", async () => {
  const home = await directory();
  const path = join(home, "state");
  const store = await Store.open(path, home);
  opened.push(store);
  await store.close();
  await writeFile(join(path, "state.json"), "{broken");
  await expect(Store.open(path, home)).rejects.toThrow();
  expect(await readFile(join(path, "state.json"), "utf8")).toBe("{broken");
});
it("refuses a data directory bound to another daemon", async () => {
  const home = await directory();
  const other = await directory();
  const path = join(home, "state");
  const store = await Store.open(path, home);
  opened.push(store);
  await store.close();
  await expect(Store.open(path, other)).rejects.toThrow("another daemon");
});
