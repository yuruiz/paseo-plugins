import type { InterfaceEntry, ServerEntry } from "../shared/contracts";

export function filterServers(servers: ServerEntry[], query: string) {
  const term = query.trim().toLocaleLowerCase();
  return servers.filter((server) =>
    `${server.name} ${server.source} ${server.transport} ${server.endpoint}`
      .toLocaleLowerCase()
      .includes(term),
  );
}
export function filterInterfaces(
  entries: InterfaceEntry[],
  query: string,
  kind: InterfaceEntry["kind"] | "all",
) {
  const term = query.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      (kind === "all" || entry.kind === kind) &&
      `${entry.name} ${entry.description} ${JSON.stringify(entry.details)}`
        .toLocaleLowerCase()
        .includes(term),
  );
}
