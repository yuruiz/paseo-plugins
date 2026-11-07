import { expect, it } from "vitest";
import type { FileDiff } from "../shared/contracts";
import { DiffCache, diffWeight } from "../shared/diff-cache";

function diff(path: string, length = 50): FileDiff {
  return { path, patch: "x".repeat(length), hunks: [], state: "empty", message: null };
}

it("evicts the least recently used patch when either budget is exceeded", () => {
  const cache = new DiffCache(2000, 2);
  const first = diff("first");
  cache.set("1", first);
  cache.set("2", diff("second"));
  expect(cache.get("1")).toBe(first);
  cache.set("3", diff("third"));
  expect(cache.get("2")).toBeUndefined();
  cache.set("large", diff("large", 500));
  expect(cache.get("1")).toBeUndefined();
  expect(cache.get("large")?.path).toBe("large");
});

it("does not retain oversized patches or let replacing a key inflate its accounting", () => {
  const cache = new DiffCache(2000, 5);
  for (let index = 0; index < 100; index++) cache.set("same", diff("current"));
  cache.set("other", diff("other"));
  cache.set("huge", diff("huge", 2000));
  expect(cache.get("same")?.path).toBe("current");
  expect(cache.get("other")?.path).toBe("other");
  expect(cache.get("huge")).toBeUndefined();
  cache.clear();
  expect(cache.get("same")).toBeUndefined();
});

it("accounts for parsed line objects as well as the raw patch", () => {
  const value = diff("many-lines");
  value.hunks = [
    {
      header: "@@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 1000,
      lines: Array.from({ length: 1000 }, (_, i) => ({
        kind: "added",
        content: "",
        oldLine: null,
        newLine: i + 1,
      })),
    },
  ];
  expect(diffWeight(value)).toBeGreaterThan(128000);
  const cache = new DiffCache(10000, 10);
  cache.set("many-lines", value);
  expect(cache.get("many-lines")).toBeUndefined();
});
