import type { GitCommit } from "../shared/history-contracts";

export type GraphEdge = { from: number; to: number; color: number; half: "top" | "bottom" };
export type GraphRow = {
  commit: GitCommit;
  lane: number;
  color: number;
  edges: GraphEdge[];
};
type Lane = { oid: string; color: number };

// Each lane represents an unseen parent. Topological order guarantees that all
// children reach a parent before that parent is drawn, including across pages.
export function buildCommitGraph(commits: GitCommit[]) {
  let lanes: Lane[] = [];
  let nextColor = 0;
  let width = 1;
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    const previous = [...lanes];
    let lane = lanes.findIndex((item) => item.oid === commit.oid);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push({ oid: commit.oid, color: nextColor++ });
    }
    const color = lanes[lane].color;
    const next = lanes.filter((_, index) => index !== lane);
    const parents = [...new Set(commit.parents)];
    parents.forEach((oid, index) => {
      if (next.some((item) => item.oid === oid)) return;
      if (index === 0) next.splice(Math.min(lane, next.length), 0, { oid, color });
      else next.push({ oid, color: nextColor++ });
    });
    const edges: GraphEdge[] = [];
    previous.forEach((item, index) => {
      edges.push({ from: index, to: index, color: item.color, half: "top" });
      if (item.oid === commit.oid) return;
      const target = next.findIndex((candidate) => candidate.oid === item.oid);
      edges.push({ from: index, to: target, color: item.color, half: "bottom" });
    });
    parents.forEach((oid, index) => {
      const target = next.findIndex((candidate) => candidate.oid === oid);
      edges.push({
        from: lane,
        to: target,
        color: index === 0 ? color : next[target].color,
        half: "bottom",
      });
    });
    width = Math.max(width, previous.length, lanes.length, next.length);
    rows.push({ commit, lane, color, edges });
    lanes = next;
  }
  return { rows, width };
}

export function matchesCommit(commit: GitCommit, query: string) {
  const text = query.trim().toLocaleLowerCase();
  return (
    !text ||
    `${commit.subject}\n${commit.author}\n${commit.email}\n${commit.oid}`
      .toLocaleLowerCase()
      .includes(text)
  );
}

export function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}
