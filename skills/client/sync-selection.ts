import type { z } from "zod";
import type { SyncRow } from "../shared/sync";

export type Row = z.infer<typeof SyncRow>;
export type Direction = "upload" | "download";
export const statusLabels: Record<Row["status"], string> = {
  equal: "Up to date",
  "local-only": "Only on this machine",
  "remote-only": "Available to download",
  different: "Versions differ — choose which to keep",
  blocked: "Cannot sync",
};

export function canSync(row: Row, direction: Direction): boolean {
  return (
    row.status !== "equal" &&
    row.status !== "blocked" &&
    (direction === "upload" ? row.localHash !== null : row.remoteHash !== null)
  );
}
