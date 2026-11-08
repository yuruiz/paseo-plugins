/** Hour buckets use the viewing client's local calendar after transport in UTC. */
export function localHourKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}T${String(date.getHours()).padStart(2, "0")}`;
}
