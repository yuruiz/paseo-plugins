import type { FileDiff } from "./contracts";

export function diffWeight(diff: FileDiff): number {
  return (
    diff.patch.length * 2 +
    diff.hunks.reduce(
      (total, hunk) =>
        total + hunk.lines.reduce((size, line) => size + line.content.length * 2 + 128, 0),
      0,
    ) +
    512
  );
}

// Bound both the number of files and their estimated in-memory size. Reads refresh LRU order.
export class DiffCache {
  private readonly values = new Map<string, { diff: FileDiff; weight: number }>();
  private bytes = 0;
  constructor(
    private readonly maxBytes: number,
    private readonly maxEntries: number,
  ) {}
  get(key: string) {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.diff;
  }
  set(key: string, diff: FileDiff) {
    const previous = this.values.get(key);
    if (previous) {
      this.bytes -= previous.weight;
      this.values.delete(key);
    }
    const weight = diffWeight(diff);
    if (weight > this.maxBytes) return;
    this.values.set(key, { diff, weight });
    this.bytes += weight;
    while (this.bytes > this.maxBytes || this.values.size > this.maxEntries) {
      const first = this.values.entries().next().value;
      if (!first) break;
      this.bytes -= first[1].weight;
      this.values.delete(first[0]);
    }
  }
  clear() {
    this.values.clear();
    this.bytes = 0;
  }
}
