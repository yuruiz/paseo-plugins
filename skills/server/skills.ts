import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PluginHandlerContext } from "@getpaseo/plugin/server";

import { parseFrontmatter } from "./resolve/frontmatter";
import { resolveClaudeSkills } from "./resolve/claude";
import { resolveCodexSkills } from "./resolve/codex";
import { resolveHermesSkills } from "./resolve/hermes";
import type { SkillEntry } from "./resolve/skill-entry";

export interface SkillRoots {
  claudeHome: string;
  codexHome: string;
  agentsHome: string;
  adminSkillsDir: string;
  /** `$HERMES_HOME` or `~/.hermes`. */
  hermesHome: string;
}

/**
 * `~/.agents` has no environment override — Codex documents the literal path.
 * `/etc/codex/skills` is a constant for the same reason; on a machine without
 * one it reads as an absent directory, which is the normal case.
 */
export function defaultSkillRoots(env: NodeJS.ProcessEnv = process.env): SkillRoots {
  const home = os.homedir();
  return {
    claudeHome: path.join(home, ".claude"),
    codexHome: env.CODEX_HOME ?? path.join(home, ".codex"),
    agentsHome: path.join(home, ".agents"),
    adminSkillsDir: path.join(path.sep, "etc", "codex", "skills"),
    hermesHome: env.HERMES_HOME ?? path.join(home, ".hermes"),
  };
}

interface ResolvedAgent {
  provider: string;
  cwd: string;
}

async function loadAgent(agentId: string, context: PluginHandlerContext): Promise<ResolvedAgent> {
  const handle = context.paseo.agents.ref(agentId);
  const refreshed = await handle.refresh();
  const agent = refreshed?.agent ?? handle.current();
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return { provider: agent.provider, cwd: agent.cwd };
}

async function resolveForAgent(agent: ResolvedAgent, roots: SkillRoots): Promise<SkillEntry[]> {
  if (agent.provider === "claude") {
    return resolveClaudeSkills({ cwd: agent.cwd, claudeHome: roots.claudeHome });
  }
  if (agent.provider === "codex") {
    return resolveCodexSkills({
      cwd: agent.cwd,
      codexHome: roots.codexHome,
      agentsHome: roots.agentsHome,
      adminSkillsDir: roots.adminSkillsDir,
    });
  }
  if (agent.provider === "hermes") {
    return resolveHermesSkills({ hermesHome: roots.hermesHome });
  }
  return [];
}

/**
 * Claude, Codex, and Hermes have documented skill directories to walk. Every
 * other provider gets an explicit unsupported-discovery message.
 */
function scansSkillFiles(provider: string): boolean {
  return provider === "claude" || provider === "codex" || provider === "hermes";
}

export function createListSkillsHandler(roots: SkillRoots = defaultSkillRoots()) {
  return async (input: { agentId: string }, context: PluginHandlerContext) => {
    const agent = await loadAgent(input.agentId, context);
    const skills = await resolveForAgent(agent, roots);
    return {
      provider: agent.provider,
      scanned: scansSkillFiles(agent.provider),
      cwd: agent.cwd,
      skills,
    };
  };
}

/**
 * Takes a skill id, never a path. Discovery runs again and the id is looked up
 * in its result, so the only readable files are ones discovery already found.
 */
export function createReadSkillHandler(roots: SkillRoots = defaultSkillRoots()) {
  return async (input: { agentId: string; skillId: string }, context: PluginHandlerContext) => {
    const agent = await loadAgent(input.agentId, context);
    const skills = await resolveForAgent(agent, roots);
    const skill = skills.find((entry) => entry.id === input.skillId);
    if (!skill) {
      throw new Error(`Skill not available: ${input.skillId}`);
    }
    const raw = await readFile(skill.path, "utf8");
    return {
      name: skill.name,
      description: skill.description,
      path: skill.path,
      body: parseFrontmatter(raw).body,
    };
  };
}
