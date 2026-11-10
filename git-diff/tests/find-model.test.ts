import { expect, it } from "vitest";
import { findMatches, literalMatches } from "../client/find-model";
import type { DiffLine } from "../shared/contracts";

it("matches literal keywords ignoring case, including regex punctuation", () => {
  expect(literalMatches("a.b A.B axb", "a.b")).toEqual([
    { start: 0, end: 3 },
    { start: 4, end: 7 },
  ]);
  expect(literalMatches("aaaa", "aa")).toHaveLength(2);
  expect(literalMatches("text", "")).toEqual([]);
  expect(literalMatches("中文中文", "中文")).toHaveLength(2);
});

it("searches both sides, counts shared context once and ignores headers", () => {
  const context: DiffLine = { kind: "context", content: "\tmatch", oldLine: 1, newLine: 1 };
  expect(
    findMatches(
      [
        { key: "h", header: "match" },
        { key: "c", left: context, right: context },
        { key: "d", left: { ...context, kind: "removed" }, right: { ...context, kind: "added" } },
      ],
      "match",
      4,
    ),
  ).toEqual([
    { row: 1, side: "left", start: 4, end: 9 },
    { row: 2, side: "left", start: 4, end: 9 },
    { row: 2, side: "right", start: 4, end: 9 },
  ]);
});
