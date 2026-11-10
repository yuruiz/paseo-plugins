import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SkillSync } from "./sync";
import { SyncGitHub, type RemoteSnapshot } from "./sync-github";
import { blobHash, fingerprint, readDirectory, safePath, type SyncFile } from "./sync-files";
import { createListSkillsHandler, type SkillRoots } from "./skills";

let root: string;
let roots: SkillRoots;
let remote: RemoteSnapshot;
let github: SyncGitHub;
let service: SkillSync;
let context: PluginHandlerContext;
const request = { agentId: "agent", repository: "owner/private-skills", branch: "" };

function makeFile(name: string, content: string | Buffer, executable = false): SyncFile {
  const buffer = Buffer.from(content);
  return {
    path: name,
    content: buffer,
    size: buffer.length,
    sha: blobHash(buffer),
    mode: executable ? "100755" : "100644",
  };
}
function skill(name: string, body = "Instructions"): SyncFile[] {
  return [makeFile("SKILL.md", `---\nname: ${name}\ndescription: A test skill\n---\n${body}\n`)];
}
async function local(name: string, files = skill(name), home = roots.agentsHome) {
  const target = path.join(home, "skills", name);
  for (const file of files) {
    await mkdir(path.dirname(path.join(target, file.path)), { recursive: true });
    await writeFile(path.join(target, file.path), file.content!);
    await chmod(path.join(target, file.path), file.mode === "100755" ? 0o755 : 0o644);
  }
  return target;
}
function agent(provider = "codex"): PluginHandlerContext {
  const value = { id: "agent", provider, cwd: root };
  return {
    paseo: {
      agents: { ref: () => ({ refresh: async () => ({ agent: value }), current: () => value }) },
    },
  } as unknown as PluginHandlerContext;
}
async function apply(names: string[], direction: "upload" | "download", overwrite = false) {
  const plan = await service.compare(request, context);
  return service.apply(
    { agentId: "agent", token: plan.token, names, direction, overwrite },
    context,
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "skills-sync-"));
  roots = {
    agentsHome: path.join(root, "agents"),
    claudeHome: path.join(root, "claude"),
    codexHome: path.join(root, "codex"),
    hermesHome: path.join(root, "hermes"),
    adminSkillsDir: path.join(root, "admin"),
  };
  remote = {
    repository: request.repository,
    branch: "main",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    files: new Map(),
  };
  github = new SyncGitHub(vi.fn());
  vi.spyOn(github, "snapshot").mockImplementation(async () => ({
    ...remote,
    files: new Map(remote.files),
  }));
  vi.spyOn(github, "download").mockImplementation(async (_snapshot, files) =>
    files.map((file) => ({ ...file, content: Buffer.from(file.content!) })),
  );
  vi.spyOn(github, "upload").mockImplementation(async (_snapshot, selected) => {
    for (const [name, files] of selected) remote.files.set(name, files);
    remote.commit = "c".repeat(40);
  });
  service = new SkillSync(github, roots);
  context = agent();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("selective cross-machine skill sync", () => {
  test("compares every file and executable bit, not just SKILL.md", async () => {
    const files = [...skill("same"), makeFile("scripts/run.sh", "echo hi", true)];
    await local("same", files);
    await local("new");
    await local("changed", [...skill("changed"), makeFile("data.bin", Buffer.from([0, 1, 255]))]);
    remote.files.set("same", files);
    remote.files.set("changed", [
      ...skill("changed"),
      makeFile("data.bin", Buffer.from([0, 2, 255])),
    ]);
    remote.files.set("remote", skill("remote"));
    const plan = await service.compare(request, context);
    expect(plan.rows.map(({ name, status }) => [name, status])).toEqual([
      ["changed", "different"],
      ["new", "local-only"],
      ["remote", "remote-only"],
      ["same", "equal"],
    ]);
    expect(plan.rows[0].changes).toEqual([{ path: "data.bin", kind: "modified" }]);
    await chmod(path.join(roots.agentsHome, "skills/same/scripts/run.sh"), 0o644);
    expect(
      (await service.compare(request, context)).rows.find((row) => row.name === "same")?.status,
    ).toBe("different");
  });

  test("uploads only selected skills and downloads on another machine with binary resources and modes", async () => {
    const files = [
      ...skill("portable"),
      makeFile("scripts/run.sh", "echo hi", true),
      makeFile("asset.bin", Buffer.from([0, 255, 128])),
    ];
    await local("portable", files);
    await local("unchecked");
    expect((await apply(["portable"], "upload")).completed).toEqual(["portable"]);
    expect([...remote.files.keys()]).toEqual(["portable"]);
    const otherRoots = { ...roots, agentsHome: path.join(root, "machine-two") };
    const other = new SkillSync(github, otherRoots);
    const plan = await other.compare(request, context);
    expect(plan.rows[0].status).toBe("remote-only");
    await other.apply(
      {
        agentId: "agent",
        token: plan.token,
        names: ["portable"],
        direction: "download",
        overwrite: false,
      },
      context,
    );
    const downloaded = await readDirectory(path.join(otherRoots.agentsHome, "skills/portable"));
    expect(fingerprint(downloaded)).toBe(fingerprint(files));
    expect((await other.compare(request, context)).rows[0].status).toBe("equal");
  });

  test("requires explicit replacement and keeps a backup with removed files", async () => {
    const dir = await local("replace", [
      ...skill("replace", "old"),
      makeFile("obsolete.txt", "keep in backup"),
    ]);
    remote.files.set("replace", skill("replace", "new"));
    await expect(apply(["replace"], "download")).rejects.toThrow(/Confirm/);
    const result = await apply(["replace"], "download", true);
    expect(result.completed).toEqual(["replace"]);
    expect(await readFile(path.join(result.backups[0], "obsolete.txt"), "utf8")).toBe(
      "keep in backup",
    );
    await expect(lstat(path.join(dir, "obsolete.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await createListSkillsHandler(roots)(request, context)).skills).toHaveLength(1);
  });

  test.each(["claude", "hermes"])(
    "downloads to %s personal roots without discovering backups",
    async (provider) => {
      context = agent(provider);
      const home = provider === "claude" ? roots.claudeHome : roots.hermesHome;
      await local("existing", skill("existing", "old"), home);
      remote.files.set("existing", skill("existing", "new"));
      await apply(["existing"], "download", true);
      const listed = await createListSkillsHandler(roots)(request, context);
      expect(listed.skills.map((entry) => entry.path)).toEqual([
        path.join(home, "skills/existing/SKILL.md"),
      ]);
    },
  );

  test("rejects stale local contents, remote commits, and expired previews", async () => {
    const dir = await local("changed");
    let plan = await service.compare(request, context);
    await writeFile(path.join(dir, "new.txt"), "unsynced");
    const input = {
      agentId: "agent",
      names: ["changed"],
      direction: "upload" as const,
      overwrite: false,
    };
    await expect(service.apply({ ...input, token: plan.token }, context)).rejects.toThrow(
      /changed since comparison/,
    );
    plan = await service.compare(request, context);
    remote.commit = "d".repeat(40);
    await expect(service.apply({ ...input, token: plan.token }, context)).rejects.toThrow(/GitHub/);
    await expect(service.apply({ ...input, token: "expired" }, context)).rejects.toThrow(/expired/);
    expect(github.upload).not.toHaveBeenCalled();
  });

  test("does not overwrite an undiscovered destination", async () => {
    remote.files.set("unknown", skill("unknown"));
    const dir = path.join(roots.agentsHome, "skills/unknown");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "important.txt"), "preserve");
    expect((await service.compare(request, context)).rows[0].status).toBe("blocked");
    await expect(apply(["unknown"], "download")).rejects.toThrow(/cannot sync/);
    expect(await readFile(path.join(dir, "important.txt"), "utf8")).toBe("preserve");
  });

  test("blocks nested symlinks and remote traversal paths", async () => {
    const dir = await local("links");
    const outside = path.join(root, "secret");
    await writeFile(outside, "private");
    await symlink(outside, path.join(dir, "linked"));
    remote.files.set("unsafe", [...skill("unsafe"), makeFile("../escape", "bad")]);
    const plan = await service.compare(request, context);
    expect(plan.rows.every((row) => row.status === "blocked")).toBe(true);
    expect(plan.rows[0].error).toMatch(/symlinks/);
    expect(plan.rows[1].error).toMatch(/Unsafe/);
  });

  test("allows symlinked upload roots but refuses to replace them on download", async () => {
    const dir = await local("linked");
    const actual = path.join(root, "real-skill");
    const { rename } = await import("node:fs/promises");
    await rename(dir, actual);
    await symlink(actual, dir);
    await apply(["linked"], "upload");
    remote.files.set("linked", skill("linked", "remote change"));
    await expect(apply(["linked"], "download", true)).rejects.toThrow(/symlinked/);
    expect((await lstat(dir)).isSymbolicLink()).toBe(true);
  });

  test("materializes and validates every download before replacing local files", async () => {
    const dir = await local("first", skill("first", "old"));
    remote.files.set("first", skill("first", "new"));
    remote.files.set("second", skill("mismatched-name"));
    await expect(apply(["first", "second"], "download", true)).rejects.toThrow(/name must match/);
    expect(await readFile(path.join(dir, "SKILL.md"), "utf8")).toContain("old");
  });

  test("reports partial local completion and preserves concurrent edits", async () => {
    remote.files.set("first", skill("first"));
    remote.files.set("second", skill("second"));
    vi.mocked(github.download).mockImplementation(async (_remote, files) => {
      if (files[0].content!.toString().includes("name: second"))
        await local("second", skill("second", "concurrent edit"));
      return files.map((file) => ({ ...file, content: Buffer.from(file.content!) }));
    });
    const result = await apply(["first", "second"], "download");
    expect(result.completed).toEqual(["first"]);
    expect(result.error).toMatch(/changed/);
    expect(await readFile(path.join(roots.agentsHome, "skills/second/SKILL.md"), "utf8")).toContain(
      "concurrent edit",
    );
  });

  test("rejects a second application of the same comparison", async () => {
    await local("one");
    const plan = await service.compare(request, context);
    const input = {
      agentId: "agent",
      token: plan.token,
      names: ["one"],
      direction: "upload" as const,
      overwrite: false,
    };
    await service.apply(input, context);
    await expect(service.apply(input, context)).rejects.toThrow(/expired/);
    expect(github.upload).toHaveBeenCalledTimes(1);
  });

  test.each(["../a", "/absolute", "a\\b", "a/.git/config", "a/CON.txt", "a/trailing.", "a\0b"])(
    "rejects unsafe path %s",
    (value) => {
      expect(safePath(value)).toBe(false);
    },
  );
});
