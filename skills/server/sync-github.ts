import { execFile } from "node:child_process";
import { z } from "zod";

import { blobHash, MAX_BYTES, type SyncFile } from "./sync-files";

export type GitHubRequest = (endpoint: string, method?: string, body?: unknown) => Promise<unknown>;
const Sha = z.string().regex(/^[a-f0-9]{40}$/);
const ObjectId = z.object({ sha: Sha });
const Tree = z.object({
  sha: Sha,
  truncated: z.boolean().optional(),
  tree: z.array(
    z.object({
      path: z.string(),
      mode: z.string(),
      type: z.string(),
      sha: Sha,
      size: z.number().optional(),
    }),
  ),
});
export type RemoteSnapshot = {
  repository: string;
  branch: string;
  commit: string;
  tree: string;
  files: Map<string, SyncFile[]>;
};

export function githubRequest(signal: AbortSignal): GitHubRequest {
  return (endpoint, method = "GET", body) =>
    new Promise((resolve, reject) => {
      const args = ["api", "--hostname", "github.com", "--method", method, endpoint];
      if (body !== undefined) args.push("--input", "-");
      const child = execFile(
        "gh",
        args,
        {
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 32 * 1024 * 1024,
          signal,
          env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_DEBUG: "", GH_PAGER: "cat" },
        },
        (error, stdout, stderr) => {
          if (error) {
            const status = stderr.match(/HTTP (\d{3})/)?.[1];
            reject(
              new Error(
                status
                  ? `GitHub HTTP ${status}. Check repository access, branch, and Contents permissions; compare again after concurrent updates.`
                  : "GitHub request failed. Install gh and authenticate on the daemon host with gh auth login; check connectivity.",
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error("Invalid GitHub response."));
          }
        },
      );
      child.stdin?.on("error", () => {});
      child.stdin?.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

export class SyncGitHub {
  constructor(private readonly request: GitHubRequest) {}

  async snapshot(repository: string, branch: string): Promise<RemoteSnapshot> {
    const repo = z
      .object({ private: z.boolean(), default_branch: z.string() })
      .parse(await this.request(`repos/${repository}`));
    if (!repo.private) throw new Error("Skill sync requires a private GitHub repository.");
    branch ||= repo.default_branch;
    const ref = z
      .object({ object: ObjectId })
      .parse(await this.request(`repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`));
    const commit = z
      .object({ tree: ObjectId })
      .parse(await this.request(`repos/${repository}/git/commits/${ref.object.sha}`));
    const tree = Tree.parse(
      await this.request(`repos/${repository}/git/trees/${commit.tree.sha}?recursive=1`),
    );
    if (tree.truncated)
      throw new Error(
        "Repository tree is too large to compare safely. Use a dedicated skills repository.",
      );
    const files = new Map<string, SyncFile[]>();
    for (const entry of tree.tree) {
      if (entry.path === "skills" && entry.type !== "tree")
        throw new Error("The repository skills path must be a directory.");
      if (!entry.path.startsWith("skills/")) continue;
      if (entry.type === "tree") continue;
      const [, name, ...parts] = entry.path.split("/");
      if (!name || !parts.length)
        throw new Error("The skills/ directory must contain skill folders only.");
      const group = files.get(name) ?? [];
      group.push({
        path: parts.join("/"),
        mode: entry.mode as SyncFile["mode"],
        sha: entry.sha,
        size: entry.size ?? MAX_BYTES + 1,
      });
      files.set(name, group);
    }
    return { repository, branch, commit: ref.object.sha, tree: tree.sha, files };
  }

  async download(remote: RemoteSnapshot, files: SyncFile[]): Promise<SyncFile[]> {
    return mapConcurrent(files, async (file) => {
      const blob = z
        .object({ content: z.string(), encoding: z.literal("base64") })
        .parse(await this.request(`repos/${remote.repository}/git/blobs/${file.sha}`));
      const content = Buffer.from(blob.content, "base64");
      if (blobHash(content) !== file.sha || content.length !== file.size)
        throw new Error("GitHub blob does not match the compared version.");
      return { ...file, content };
    });
  }

  async upload(remote: RemoteSnapshot, selected: Map<string, SyncFile[]>) {
    const prefix = `repos/${remote.repository}/git`;
    const tree: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const [name, files] of selected) {
      const previous = new Map((remote.files.get(name) ?? []).map((file) => [file.path, file]));
      const changed = files.filter((file) => previous.get(file.path)?.sha !== file.sha);
      await mapConcurrent(changed, async (file) => {
        const blob = ObjectId.parse(
          await this.request(`${prefix}/blobs`, "POST", {
            content: file.content!.toString("base64"),
            encoding: "base64",
          }),
        );
        if (blob.sha !== file.sha) throw new Error("Uploaded blob hash mismatch.");
      });
      const skillTree = ObjectId.parse(
        await this.request(`${prefix}/trees`, "POST", {
          tree: files.map((file) => ({
            path: file.path,
            mode: file.mode,
            type: "blob",
            sha: file.sha,
          })),
        }),
      );
      tree.push({ path: `skills/${name}`, mode: "040000", type: "tree", sha: skillTree.sha });
    }
    const nextTree = ObjectId.parse(
      await this.request(`${prefix}/trees`, "POST", { base_tree: remote.tree, tree }),
    );
    const commit = ObjectId.parse(
      await this.request(`${prefix}/commits`, "POST", {
        message: `Sync skills: ${[...selected.keys()].join(", ")}`,
        tree: nextTree.sha,
        parents: [remote.commit],
      }),
    );
    await this.request(`${prefix}/refs/heads/${encodeURIComponent(remote.branch)}`, "PATCH", {
      sha: commit.sha,
      force: false,
    });
  }
}

async function mapConcurrent<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  let index = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        output[current] = await run(items[current]);
      }
    }),
  );
  const failure = workers.find((worker) => worker.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return output;
}
