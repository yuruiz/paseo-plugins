import { expect, it } from "vitest";
import { defaultSettings, panelSettingsSchema } from "../shared/settings";
import { MAX_CACHED_TABS, retainedTabs, TAB_CACHE_BYTES } from "../shared/tab-cache";

it("retains five recently visited tabs by default and promotes reused tabs", () => {
  const open = ["a", "b", "c", "d", "e", "f"];
  let recent: string[] = [];
  for (const key of open)
    recent = retainedTabs(recent, open, key, defaultSettings.tabCacheSize, {});
  expect(recent).toEqual(["b", "c", "d", "e", "f"]);
  recent = retainedTabs(recent, open, "b", 5, {});
  expect(recent).toEqual(["c", "d", "e", "f", "b"]);
  expect(retainedTabs(recent, open, "a", 5, {})).toEqual(["d", "e", "f", "b", "a"]);
});
it("immediately releases closed tabs and responds to a smaller configured limit", () => {
  expect(retainedTabs(["a", "b", "c", "d"], ["a", "c", "d"], "c", 2, {})).toEqual(["d", "c"]);
  expect(retainedTabs(["a", "b"], [], null, 5, {})).toEqual([]);
});
it("evicts older heavy previews before the count limit and always keeps the active tab", () => {
  const stats = {
    a: { hunks: 0, bytes: TAB_CACHE_BYTES / 2 },
    b: { hunks: 0, bytes: TAB_CACHE_BYTES / 2 },
    c: { hunks: 0, bytes: 100 },
  };
  expect(retainedTabs(["a", "b"], ["a", "b", "c"], "c", 5, stats)).toEqual(["b", "c"]);
  expect(
    retainedTabs(["a", "b"], ["a", "b"], "b", 5, { b: { hunks: 0, bytes: TAB_CACHE_BYTES * 2 } }),
  ).toEqual(["b"]);
});
it("migrates the removed patch preference without resetting existing preferences", () => {
  expect(panelSettingsSchema.parse({ mode: "patch", fontSize: 16 })).toMatchObject({
    mode: "unified",
    fontSize: 16,
    tabCacheSize: 5,
  });
  expect(panelSettingsSchema.parse({ tabCacheSize: MAX_CACHED_TABS }).tabCacheSize).toBe(10);
  for (const tabCacheSize of [0, 11, 3.5])
    expect(panelSettingsSchema.safeParse({ tabCacheSize }).success).toBe(false);
});
