import { it, expect } from "vitest";
import { filterInterfaces } from "./filter";
import type { InterfaceEntry } from "../shared/contracts";

it("searches names, descriptions and schema fields while preserving kind filters", () => {
  const entries: InterfaceEntry[] = [
    {
      kind: "tool",
      name: "search",
      description: "Find documents",
      configuredDisabled: false,
      details: { inputSchema: { properties: { workspaceId: { type: "string" } } } },
    },
    {
      kind: "prompt",
      name: "review",
      description: "Review documents",
      configuredDisabled: false,
      details: {},
    },
  ];
  expect(filterInterfaces(entries, " WORKSPACEid ", "all")).toEqual([entries[0]]);
  expect(filterInterfaces(entries, "documents", "prompt")).toEqual([entries[1]]);
  expect(filterInterfaces(entries, "nothing", "all")).toEqual([]);
});
