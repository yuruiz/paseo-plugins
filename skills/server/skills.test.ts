import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createListSkillsHandler,
  createReadSkillHandler,
  defaultSkillRoots,
  type SkillRoots,
} from "./skills";

let root: string;
let roots: SkillRoots;

type CommandsFn = () => Promise<{
  commands: Array<{
    name: string;
    description: string;
    argumentHint: string;
    kind?: "command" | "skill";
  }>;
  error: string | null;
}>;

function contextFor(
  agent: { id: string; provider: string; cwd: string } | null,
  commands?: CommandsFn,
) {
  const handle = {
    refresh: async () => (agent ? { agent, project: null } : null),
    current: () => agent,
    // Commands are available on the host but must never feed the Skills menu.
    ...(commands ? { commands } : {}),
  };
  return { paseo: { agents: { ref: () => handle } } } as unknown as PluginHandlerContext;
}

function reports(
  ...commands: Array<{
    name: string;
    description?: string;
    argumentHint?: string;
    kind?: "command" | "skill";
  }>
): CommandsFn {
  return async () => ({
    commands: commands.map((command) => ({
      description: `Description for ${command.name}`,
      argumentHint: "",
      ...command,
    })),
    error: null,
  });
}

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody for ${name}.\n`,
    "utf8",
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-skills-handler-"));
  roots = {
    claudeHome: path.join(root, "claude-home"),
    codexHome: path.join(root, "codex-home"),
    agentsHome: path.join(root, "agents-home"),
    adminSkillsDir: path.join(root, "etc", "codex", "skills"),
    hermesHome: path.join(root, "hermes-home"),
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createListSkillsHandler", () => {
  test("lists claude skills for a claude agent", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "claude", cwd }),
    );

    expect(result.scanned).toBe(true);
    expect(result.provider).toBe("claude");
    expect(result.cwd).toBe(cwd);
    expect(result.skills.map((skill) => skill.name)).toEqual(["catchup"]);
  });

  test("lists codex skills for a codex agent", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".agents", "skills"), "deploy", "Deploys the app");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "codex", cwd }),
    );

    expect(result.skills.map((skill) => skill.name)).toEqual(["deploy"]);
  });

  test("lists hermes skills for a hermes agent, flat and in categories", async () => {
    const skillsDir = path.join(roots.hermesHome, "skills");
    await writeSkill(skillsDir, "paseo", "Paseo reference");
    await writeSkill(path.join(skillsDir, "productivity"), "docx", "Word files");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "hermes", cwd: root }),
    );

    expect(result.scanned).toBe(true);
    expect(result.skills.map((skill) => skill.name)).toEqual(["docx", "paseo"]);
  });

  test("reads a hermes skill body through skills.read", async () => {
    await writeSkill(path.join(roots.hermesHome, "skills"), "paseo", "Paseo reference");
    const context = contextFor({ id: "agent-1", provider: "hermes", cwd: root });
    const listed = await createListSkillsHandler(roots)({ agentId: "agent-1" }, context);
    const skillId = listed.skills[0]!.id;

    const result = await createReadSkillHandler(roots)({ agentId: "agent-1", skillId }, context);

    expect(result.name).toBe("paseo");
    expect(result.body).toBe("Body for paseo.\n");
  });

  test("reports an unscanned provider instead of an empty list", async () => {
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "opencode", cwd: root }),
    );

    expect(result.scanned).toBe(false);
    expect(result.provider).toBe("opencode");
    expect(result.skills).toEqual([]);
  });

  test("throws when the agent cannot be found", async () => {
    const handler = createListSkillsHandler(roots);

    await expect(handler({ agentId: "missing" }, contextFor(null))).rejects.toThrow(/missing/);
  });

  test("does not load commands, even when the provider labels them as skills", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    // A real SKILL.md is authoritative, even when its name resembles a command.
    await writeSkill(path.join(cwd, ".claude", "skills"), "model", "A custom modelling skill");
    const commands = vi.fn(
      reports(
        { name: "catchup", kind: "skill" },
        { name: "model", kind: "command" },
        { name: "config", kind: "skill" },
        { name: "doctor", kind: "skill" },
        { name: "compact", kind: "command" },
        { name: "unknown" },
        { name: "bundled-only", kind: "skill" },
      ),
    );
    const result = await createListSkillsHandler(roots)(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "claude", cwd }, commands),
    );
    expect(result.skills.map((skill) => skill.name)).toEqual(["catchup", "model"]);
    expect(commands).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("reported");
  });

  test("ignores markdown instructions, slash-command files and invalid skill folders", async () => {
    const cwd = path.join(root, "work");
    const skillsDir = path.join(cwd, ".claude", "skills");
    await writeSkill(skillsDir, "real", "A real skill");
    const document = "---\nname: fake\ndescription: Not a skill entry\n---\nInstructions";
    for (const file of [
      "AGENTS.md",
      "README.md",
      ".claude/commands/review.md",
      ".claude/skills/loose.md",
      ".claude/skills/docs/README.md",
    ]) {
      const target = path.join(cwd, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, document);
    }
    for (const [name, content] of [
      ["no-frontmatter", "# Not a skill"],
      ["missing-name", "---\ndescription: Missing name\n---"],
      ["missing-description", "---\nname: incomplete\n---"],
      ["blank-name", '---\nname: "   "\ndescription: Blank name\n---'],
      ["blank-description", '---\nname: blank\ndescription: "   "\n---'],
    ]) {
      const dir = path.join(skillsDir, name!);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "SKILL.md"), content!);
    }
    const result = await createListSkillsHandler(roots)(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "claude", cwd }),
    );
    expect(result.skills.map((skill) => skill.name)).toEqual(["real"]);
  });

  test("an unsupported provider never falls back to its command list", async () => {
    const commands = vi.fn(reports({ name: "explain", kind: "skill" }));
    const result = await createListSkillsHandler(roots)(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "opencode", cwd: root }, commands),
    );
    expect(result.scanned).toBe(false);
    expect(result.skills).toEqual([]);
    expect(commands).not.toHaveBeenCalled();
  });
});

describe("defaultSkillRoots", () => {
  test("honors CODEX_HOME", () => {
    const roots = defaultSkillRoots({ CODEX_HOME: "/custom/codex" } as NodeJS.ProcessEnv);
    expect(roots.codexHome).toBe("/custom/codex");
  });

  test("honors HERMES_HOME", () => {
    const roots = defaultSkillRoots({ HERMES_HOME: "/custom/hermes" } as NodeJS.ProcessEnv);
    expect(roots.hermesHome).toBe("/custom/hermes");
  });

  test("falls back to ~/.codex and always uses ~/.claude and ~/.agents", () => {
    const roots = defaultSkillRoots({} as NodeJS.ProcessEnv);
    expect(roots.codexHome).toBe(path.join(os.homedir(), ".codex"));
    expect(roots.claudeHome).toBe(path.join(os.homedir(), ".claude"));
    expect(roots.agentsHome).toBe(path.join(os.homedir(), ".agents"));
    expect(roots.hermesHome).toBe(path.join(os.homedir(), ".hermes"));
  });
});

describe("createReadSkillHandler", () => {
  test("returns the body for a discovered skill", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    const context = contextFor({ id: "agent-1", provider: "claude", cwd });
    const listed = await createListSkillsHandler(roots)({ agentId: "agent-1" }, context);
    const skillId = listed.skills[0]!.id;

    const result = await createReadSkillHandler(roots)({ agentId: "agent-1", skillId }, context);

    expect(result.name).toBe("catchup");
    expect(result.description).toBe("Summarizes changes");
    expect(result.path).toBe(path.join(cwd, ".claude", "skills", "catchup", "SKILL.md"));
    expect(result.body).toBe("Body for catchup.\n");
  });

  test("throws for a skill id discovery does not return", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    const context = contextFor({ id: "agent-1", provider: "claude", cwd });

    await expect(
      createReadSkillHandler(roots)(
        { agentId: "agent-1", skillId: "project:/etc:passwd" },
        context,
      ),
    ).rejects.toThrow(/not available/);
  });
});
