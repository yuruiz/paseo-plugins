import { expect, test } from "vitest";
import { canSync, type Row } from "./sync-selection";

test("selection honors direction and never includes equal or blocked entries", () => {
  const base: Row = {
    name: "skill",
    status: "local-only",
    localPath: "/skills/skill",
    localHash: "local",
    remoteHash: null,
    error: null,
    changes: [],
  };
  expect(canSync(base, "upload")).toBe(true);
  expect(canSync(base, "download")).toBe(false);
  expect(
    canSync({ ...base, status: "remote-only", localHash: null, remoteHash: "remote" }, "download"),
  ).toBe(true);
  for (const direction of ["upload", "download"] as const) {
    expect(canSync({ ...base, status: "equal", remoteHash: "local" }, direction)).toBe(false);
    expect(canSync({ ...base, status: "blocked", remoteHash: "remote" }, direction)).toBe(false);
    expect(canSync({ ...base, status: "different", remoteHash: "remote" }, direction)).toBe(true);
  }
});
