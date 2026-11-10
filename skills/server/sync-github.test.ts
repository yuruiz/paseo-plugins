import { describe, expect, test, vi } from "vitest";
import { SyncGitHub, type GitHubRequest, type RemoteSnapshot } from "./sync-github";
import { blobHash, type SyncFile } from "./sync-files";

const sha = (value: string) => value.repeat(40);
const remote: RemoteSnapshot = {
  repository: "owner/private",
  branch: "skills/team",
  commit: sha("a"),
  tree: sha("b"),
  files: new Map(),
};

function requests(overrides: { private?: boolean; truncated?: boolean; entries?: unknown[] } = {}) {
  return vi.fn<GitHubRequest>(async (endpoint) => {
    if (endpoint === "repos/owner/private")
      return { private: overrides.private ?? true, default_branch: "skills/team" };
    if (endpoint.includes("/git/ref/")) return { object: { sha: remote.commit } };
    if (endpoint.includes("/git/commits/")) return { tree: { sha: remote.tree } };
    if (endpoint.includes("/git/trees/"))
      return {
        sha: remote.tree,
        truncated: overrides.truncated ?? false,
        tree: overrides.entries ?? [],
      };
    throw new Error(`Unexpected request: ${endpoint}`);
  });
}

describe("private GitHub repository transport", () => {
  test("rejects public repositories before reading contents", async () => {
    const request = requests({ private: false });
    await expect(new SyncGitHub(request).snapshot(remote.repository, "")).rejects.toThrow(
      /private/,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  test("resolves default branch and reads one immutable commit tree", async () => {
    const request = requests({
      entries: [
        { path: "README.md", type: "blob", mode: "100644", sha: sha("c"), size: 5 },
        { path: "skills/one", type: "tree", mode: "040000", sha: sha("d") },
        { path: "skills/one/SKILL.md", type: "blob", mode: "100644", sha: sha("e"), size: 50 },
      ],
    });
    const result = await new SyncGitHub(request).snapshot(remote.repository, "");
    expect(result.branch).toBe("skills/team");
    expect([...result.files.keys()]).toEqual(["one"]);
    expect(request).toHaveBeenCalledWith("repos/owner/private/git/ref/heads/skills%2Fteam");
    expect(request).toHaveBeenCalledWith(
      `repos/owner/private/git/trees/${remote.tree}?recursive=1`,
    );
  });
  test("refuses truncated trees and a symlink occupying the skills root", async () => {
    await expect(
      new SyncGitHub(requests({ truncated: true })).snapshot(remote.repository, ""),
    ).rejects.toThrow(/too large/);
    const request = requests({
      entries: [{ path: "skills", mode: "120000", type: "blob", sha: sha("c"), size: 5 }],
    });
    await expect(new SyncGitHub(request).snapshot(remote.repository, "")).rejects.toThrow(
      /directory/,
    );
  });
  test("replaces only selected subtrees in one fast-forward commit, preserving unrelated files", async () => {
    const content = Buffer.from([0, 255, 128]);
    const file: SyncFile = {
      path: "asset.bin",
      mode: "100755",
      size: content.length,
      sha: blobHash(content),
      content,
    };
    const request = vi.fn<GitHubRequest>(async (endpoint, _method, body) => {
      if (endpoint.endsWith("/blobs")) return { sha: file.sha };
      if (endpoint.endsWith("/trees"))
        return { sha: (body as { base_tree?: string }).base_tree ? sha("d") : sha("c") };
      if (endpoint.endsWith("/commits")) return { sha: sha("e") };
      if (endpoint.includes("/refs/")) return { object: { sha: sha("e") } };
      throw new Error("Unexpected endpoint");
    });
    await new SyncGitHub(request).upload(remote, new Map([["chosen", [file]]]));
    expect(request).toHaveBeenCalledWith("repos/owner/private/git/trees", "POST", {
      base_tree: remote.tree,
      tree: [{ path: "skills/chosen", mode: "040000", type: "tree", sha: sha("c") }],
    });
    expect(request).toHaveBeenCalledWith("repos/owner/private/git/commits", "POST", {
      message: "Sync skills: chosen",
      tree: sha("d"),
      parents: [remote.commit],
    });
    expect(request).toHaveBeenLastCalledWith(
      "repos/owner/private/git/refs/heads/skills%2Fteam",
      "PATCH",
      { sha: sha("e"), force: false },
    );
  });
  test("propagates concurrent branch update rejection without forcing or retrying", async () => {
    const request = vi.fn<GitHubRequest>(async (endpoint) => {
      if (endpoint.includes("/refs/")) throw new Error("non-fast-forward");
      return { sha: sha("d") };
    });
    await expect(new SyncGitHub(request).upload(remote, new Map())).rejects.toThrow(
      "non-fast-forward",
    );
    expect(request.mock.calls.filter(([url]) => url.includes("/refs/"))).toHaveLength(1);
    expect(request.mock.calls.at(-1)?.[2]).toEqual({ sha: sha("d"), force: false });
  });
  test("verifies downloaded blob hashes and rejects corrupt bytes", async () => {
    const content = Buffer.from("hello");
    const file: SyncFile = {
      path: "SKILL.md",
      mode: "100644",
      sha: blobHash(content),
      size: content.length,
    };
    const request = vi
      .fn<GitHubRequest>()
      .mockResolvedValue({ encoding: "base64", content: content.toString("base64") });
    expect((await new SyncGitHub(request).download(remote, [file]))[0].content).toEqual(content);
    request.mockResolvedValue({ encoding: "base64", content: "aW52YWxpZA==" });
    await expect(new SyncGitHub(request).download(remote, [file])).rejects.toThrow(
      /does not match/,
    );
  });
});
