export const MAX_CACHED_TABS = 10;
// Estimated retained input/object cost, not a browser heap measurement.
export const TAB_CACHE_BYTES = 24 * 1024 * 1024;
export type TabStats = { hunks: number; bytes: number; view?: string };

export function retainedTabs(
  recent: readonly string[],
  open: readonly string[],
  active: string | null,
  limit: number,
  stats: Readonly<Record<string, TabStats>>,
): string[] {
  const keys = new Set(open);
  const next = recent.filter((key) => keys.has(key) && key !== active);
  if (active && keys.has(active)) next.push(active);
  const count = Math.max(1, Math.min(MAX_CACHED_TABS, Math.trunc(limit) || 5));
  let bytes = next.reduce((sum, key) => sum + (stats[key]?.bytes ?? 0), 0);
  while (next.length > 1 && (next.length > count || bytes > TAB_CACHE_BYTES)) {
    const key = next.shift();
    if (key) bytes -= stats[key]?.bytes ?? 0;
  }
  return next;
}
