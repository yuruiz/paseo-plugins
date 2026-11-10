import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { z } from "zod";

import { compareSkills, syncSkills, SyncConfig, SyncResult } from "../shared/sync";
import { createListSkillsHandler, defaultSkillRoots, type SkillRoots } from "./skills";
import {
  exists,
  fingerprint,
  installDirectory,
  readDirectory,
  resolvedTarget,
  safePath,
  validateFiles,
  validateSkill,
  validName,
  type SyncFile,
} from "./sync-files";
import { SyncGitHub, type RemoteSnapshot } from "./sync-github";

type Comparison = RpcOutput<typeof compareSkills>;
type Row = Comparison["rows"][number];
type Plan = {
  input: RpcInput<typeof compareSkills>;
  result: Comparison;
  remote: RemoteSnapshot;
  local: Map<string, SyncFile[]>;
  targets: Map<string, string>;
  expires: number;
};

export class SkillSync {
  private readonly plans = new Map<string, Plan>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly github: SyncGitHub,
    private readonly roots: SkillRoots = defaultSkillRoots(),
  ) {}

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const task = this.tail.then(action);
    this.tail = task.catch(() => {});
    return task;
  }

  compare(input: RpcInput<typeof compareSkills>, context: PluginHandlerContext) {
    return this.exclusive(async () => {
      const plan = await this.prepare(input, context);
      for (const [key, value] of this.plans) if (value.expires < Date.now()) this.plans.delete(key);
      while (this.plans.size >= 8) this.plans.delete(this.plans.keys().next().value!);
      this.plans.set(plan.result.token, plan);
      return plan.result;
    });
  }

  private async prepare(
    input: RpcInput<typeof compareSkills>,
    context: PluginHandlerContext,
  ): Promise<Plan> {
    const config = SyncConfig.parse(input);
    const listed = await createListSkillsHandler(this.roots)({ agentId: input.agentId }, context);
    const homes: Record<string, string> = {
      codex: this.roots.agentsHome,
      claude: this.roots.claudeHome,
      hermes: this.roots.hermesHome,
    };
    if (!listed.scanned || !homes[listed.provider])
      throw new Error("Sync supports Codex, Claude, and Hermes agents.");
    const destination = path.join(homes[listed.provider], "skills");
    const remote = await this.github.snapshot(config.repository, config.branch);
    const byName = new Map(listed.skills.map((skill) => [skill.name, skill]));
    const names = [...new Set([...byName.keys(), ...remote.files.keys()])].sort();
    const folded = new Map<string, number>();
    for (const name of names)
      folded.set(name.toLowerCase(), (folded.get(name.toLowerCase()) ?? 0) + 1);
    const local = new Map<string, SyncFile[]>();
    const targets = new Map<string, string>();
    const rows: Row[] = [];
    for (const name of names) {
      const entry = byName.get(name);
      const directory = entry ? path.dirname(entry.path) : path.join(destination, name);
      const row: Row = {
        name,
        status: "blocked",
        localPath: directory,
        localHash: null,
        remoteHash: null,
        changes: [],
        error: null,
      };
      try {
        if (!validName(name) || !safePath(name) || folded.get(name.toLowerCase()) !== 1)
          throw new Error(
            "Sync requires a unique portable skill name (letters, numbers, dots, underscores, or hyphens).",
          );
        const remoteFiles = remote.files.get(name);
        if (remoteFiles) {
          validateFiles(remoteFiles);
          row.remoteHash = fingerprint(remoteFiles);
        }
        let localFiles: SyncFile[] = [];
        if (entry) {
          localFiles = await readDirectory(directory);
          validateSkill(localFiles, name);
          local.set(
            name,
            localFiles.map(({ content: _content, ...file }) => file),
          );
          row.localHash = fingerprint(localFiles);
        } else if (await exists(directory)) {
          throw new Error("Download destination already exists but is not a discovered skill.");
        }
        targets.set(name, await resolvedTarget(directory));
        row.status = !row.localHash
          ? "remote-only"
          : !row.remoteHash
            ? "local-only"
            : row.localHash === row.remoteHash
              ? "equal"
              : "different";
        const left = new Map(localFiles.map((file) => [file.path, file]));
        const right = new Map((remoteFiles ?? []).map((file) => [file.path, file]));
        for (const file of [...new Set([...left.keys(), ...right.keys()])].sort()) {
          const a = left.get(file),
            b = right.get(file);
          if (!a) row.changes.push({ path: file, kind: "remote-only" });
          else if (!b) row.changes.push({ path: file, kind: "local-only" });
          else if (a.sha !== b.sha || a.mode !== b.mode)
            row.changes.push({ path: file, kind: "modified" });
        }
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
      }
      rows.push(row);
    }
    return {
      input,
      remote,
      local,
      targets,
      expires: Date.now() + 15 * 60_000,
      result: {
        token: randomUUID(),
        repository: config.repository,
        branch: remote.branch,
        commit: remote.commit,
        destination,
        rows,
      },
    };
  }

  apply(
    input: RpcInput<typeof syncSkills>,
    context: PluginHandlerContext,
  ): Promise<z.infer<typeof SyncResult>> {
    return this.exclusive(async () => {
      const plan = this.plans.get(input.token);
      if (!plan || plan.expires < Date.now() || plan.input.agentId !== input.agentId)
        throw new Error("Comparison expired. Compare again before syncing.");
      this.plans.delete(input.token);
      const names = [...new Set(input.names)];
      const selected = names.map((name) => {
        const row = plan.result.rows.find((row) => row.name === name);
        if (!row || row.status === "blocked" || row.status === "equal")
          throw new Error(`Skill cannot sync: ${name}`);
        if (input.direction === "upload" ? !row.localHash : !row.remoteHash)
          throw new Error(
            `No ${input.direction === "upload" ? "local" : "remote"} version: ${name}`,
          );
        if (row.status === "different" && !input.overwrite)
          throw new Error("Versions differ. Confirm which version to keep.");
        return row;
      });
      const fresh = await this.prepare({ ...plan.input, branch: plan.remote.branch }, context);
      if (
        fresh.remote.commit !== plan.remote.commit ||
        fresh.result.destination !== plan.result.destination
      )
        throw new Error("GitHub or the destination changed. Compare again.");
      for (const row of selected) {
        const current = fresh.result.rows.find((entry) => entry.name === row.name);
        if (
          !current ||
          current.status !== row.status ||
          current.localHash !== row.localHash ||
          current.remoteHash !== row.remoteHash ||
          current.localPath !== row.localPath ||
          fresh.targets.get(row.name) !== plan.targets.get(row.name)
        )
          throw new Error(`Skill changed since comparison: ${row.name}. Compare again.`);
      }
      const files = new Map<string, SyncFile[]>();
      for (const row of selected) {
        const contents =
          input.direction === "upload"
            ? fresh.local.get(row.name)!
            : fresh.remote.files.get(row.name)!;
        files.set(row.name, contents);
        if (
          input.direction === "download" &&
          row.localHash &&
          (await lstat(row.localPath)).isSymbolicLink()
        )
          throw new Error(
            `Cannot download over symlinked skill: ${row.name}. Update its source instead.`,
          );
      }
      const all = [...files.values()].flat();
      if (all.length > 1000 || all.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024)
        throw new Error("Select fewer skills: each sync is limited to 1,000 files and 25 MiB.");
      if (input.direction === "upload") {
        for (const row of selected) {
          const contents = await readDirectory(row.localPath);
          if (fingerprint(contents) !== row.localHash)
            throw new Error(`Local skill changed: ${row.name}. Compare again.`);
          files.set(row.name, contents);
        }
        await this.github.upload(fresh.remote, files);
        return { completed: names, backups: [], error: null };
      }
      for (const [name, contents] of files) {
        const downloaded = await this.github.download(fresh.remote, contents);
        validateSkill(downloaded, name);
        files.set(name, downloaded);
      }
      const completed: string[] = [],
        backups: string[] = [];
      try {
        for (const row of selected) {
          const backup = await installDirectory(
            row.localPath,
            files.get(row.name)!,
            row.localHash,
            fresh.targets.get(row.name)!,
          );
          completed.push(row.name);
          if (backup) backups.push(backup);
        }
        return { completed, backups, error: null };
      } catch (error) {
        return {
          completed,
          backups,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }
}
