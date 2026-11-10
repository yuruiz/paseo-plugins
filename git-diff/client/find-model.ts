import type { ContextRow } from "./context-model";

export function literalMatches(content: string, query: string) {
  const matches: { start: number; end: number }[] = [];
  if (!query) return matches;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of content.matchAll(new RegExp(escaped, "gi")))
    matches.push({ start: match.index, end: match.index + match[0].length });
  return matches;
}

export function findMatches(rows: ContextRow[], query: string, tabSize: number) {
  return rows.flatMap((row, index) => {
    if (!("left" in row)) return [];
    return (["left", "right"] as const).flatMap((side) => {
      const line = row[side];
      if (!line || line.kind === "meta" || (side === "right" && line === row.left)) return [];
      return literalMatches(line.content.replace(/\t/g, " ".repeat(tabSize)), query).map(
        (match) => ({ ...match, row: index, side }),
      );
    });
  });
}
