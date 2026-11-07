import { expect, it } from "vitest";
import { buildCommitGraph, matchesCommit } from "../client/graph-model";
import type { GitCommit } from "../shared/history-contracts";

function commit(oid: string, parents: string[] = []): GitCommit {
  return {
    oid,
    parents,
    author: "李伟民",
    email: "dev@example.test",
    date: "2026-11-06T12:00:00Z",
    subject: "feat: add graph",
  };
}

it("keeps a linear history in one continuous lane and ends at its root", () => {
  const { rows, width } = buildCommitGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a")]);
  expect(width).toBe(1);
  expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
  expect(rows[0].edges).toEqual([{ from: 0, to: 0, color: rows[0].color, half: "bottom" }]);
  expect(rows[1].edges.map((edge) => edge.half)).toEqual(["top", "bottom"]);
  expect(rows[2].edges.map((edge) => edge.half)).toEqual(["top"]);
});

it("draws merge parents on separate lanes, then joins their shared ancestor once", () => {
  const commits = [
    commit("merge", ["main", "feature"]),
    commit("feature", ["root"]),
    commit("main", ["root"]),
    commit("root"),
  ];
  const { rows, width } = buildCommitGraph(commits);
  expect(width).toBe(2);
  expect(rows[0].edges.filter((edge) => edge.half === "bottom").map((edge) => edge.to)).toEqual([
    0, 1,
  ]);
  expect(rows[0].edges[0].color).not.toBe(rows[0].edges[1].color);
  expect(rows[1].lane).toBe(1);
  expect(rows[2].edges.filter((edge) => edge.half === "bottom").map((edge) => edge.to)).toEqual([
    0, 0,
  ]);
  expect(rows[3].edges).toHaveLength(1);
  // Adding a later page must not change any already displayed node or edge.
  expect(buildCommitGraph(commits.slice(0, 2)).rows).toEqual(rows.slice(0, 2));
});

it("handles octopus merges, independent branch tips and multiple roots without dangling lanes", () => {
  const { rows, width } = buildCommitGraph([
    commit("merge", ["a", "b", "c"]),
    commit("unrelated", ["other-root"]),
    commit("a", ["root"]),
    commit("b", ["root"]),
    commit("c", ["root"]),
    commit("root"),
    commit("other-root"),
  ]);
  expect(width).toBe(4);
  expect(rows[0].edges.filter((edge) => edge.half === "bottom")).toHaveLength(3);
  expect(rows.flatMap((row) => row.edges).every((edge) => edge.from >= 0 && edge.to >= 0)).toBe(
    true,
  );
  expect(rows.at(-1)?.edges.map((edge) => edge.half)).toEqual(["top"]);
  expect(rows.at(-1)?.lane).toBe(0);
});

it("searches message, author, email and SHA without removing graph topology", () => {
  const value = commit("abcd0123");
  expect(["GRAPH", "李伟民", "DEV@", "abcd0"].every((query) => matchesCommit(value, query))).toBe(
    true,
  );
  expect(matchesCommit(value, "missing")).toBe(false);
  expect(matchesCommit(value, " ")).toBe(true);
});
