import { describe, expect, test, vi } from "vitest";
import { countEntries } from "./skills-query";

vi.mock("@getpaseo/plugin/client", () => ({ useAgent: vi.fn(), useRpc: vi.fn() }));

describe("Skills badge", () => {
  test("counts only discovered skills even if an old cached result has reported commands", () => {
    const data = {
      provider: "claude",
      scanned: true,
      cwd: "/project",
      skills: [
        {
          id: "project:/project/.claude/skills:real",
          name: "real",
          description: "A skill",
          source: { kind: "project" as const, label: "Project", dir: "/project/.claude/skills" },
          path: "/project/.claude/skills/real/SKILL.md",
          userInvocable: true,
          status: "discovered" as const,
        },
      ],
      reported: { skills: [{ name: "model" }], commands: [{ name: "compact" }] },
    };
    expect(countEntries(data)).toBe(1);
    expect(countEntries({ ...data, skills: [] })).toBe(0);
  });
});
