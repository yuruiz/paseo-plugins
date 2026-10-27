import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commandBody, commandCatalog, sendCommand, type CommandAgent } from "./commands";
import { discoverCommands, parseCommand, type CommandRoots } from "./discovery";
import { invocationText } from "./invocation";

describe("Commands", () => {
  let directory: string;
  let roots: CommandRoots;
  let agent: CommandAgent;
  let sent: string[];
  async function file(relative: string, content: string): Promise<string> {
    const filename = path.join(directory, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
    return filename;
  }
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "paseo-commands-"));
    const home = path.join(directory, "home");
    roots = {
      home,
      claude: path.join(home, ".claude"),
      codex: path.join(home, ".codex"),
      opencode: path.join(home, ".config/opencode"),
      pi: path.join(home, ".pi/agent"),
    };
    await mkdir(path.join(directory, "repo/.git"), { recursive: true });
    await mkdir(path.join(directory, "repo/src"), { recursive: true });
    sent = [];
    agent = {
      cwd: path.join(directory, "repo/src"),
      provider: "claude",
      busy: false,
      archived: false,
      commands: async () => ({ commands: [] }),
      send: async (text) => {
        sent.push(text);
      },
    };
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("lists ancestor project and global templates with metadata without leaking other providers", async () => {
    const project = await file(
      "repo/.agents/commands/team/review.md",
      '---\ndescription: >-\n  Review staged changes\nargument-hint: "[scope]"\n---\nReview $ARGUMENTS',
    );
    const global = await file("home/.agents/commands/plan.md", "Make a plan.");
    await file("repo/.codex/prompts/hidden.md", "Codex only.");
    const catalog = await commandCatalog(agent, roots);
    expect(catalog.commands).toEqual([
      {
        id: project,
        path: project,
        name: "team/review",
        description: "Review staged changes",
        argumentHint: "[scope]",
        scope: "project",
        mode: "template",
        shadowedBy: null,
      },
      {
        id: global,
        path: global,
        name: "plan",
        description: "",
        argumentHint: "",
        scope: "global",
        mode: "template",
        shadowedBy: null,
      },
    ]);
    expect(catalog.warnings).toEqual([]);
    expect(await commandBody(agent, project, roots)).toBe("Review $ARGUMENTS");
  });

  it("discovers, previews and sends commands with unquoted bracket argument hints", async () => {
    const commandId = await file(
      "repo/.claude/commands/dump.md",
      "---\ndescription: Export conversation\nargument-hint: [输出路径]\n---\nExport to $ARGUMENTS.",
    );
    const catalog = await commandCatalog(agent, roots);
    expect(catalog.warnings).toEqual([]);
    expect(catalog.commands.map(({ name, argumentHint }) => ({ name, argumentHint }))).toEqual([
      { name: "dump", argumentHint: "[输出路径]" },
    ]);
    expect(await commandBody(agent, commandId, roots)).toBe("Export to $ARGUMENTS.");
    await sendCommand(agent, { commandId, args: "notes.md", mode: "template" }, roots);
    expect(sent).toEqual(["Run the following command template (dump):\n\nExport to notes.md."]);
  });

  it.each([
    ['argument-hint: "[path] [scope]"', "[path] [scope]"],
    ["argument-hint: [path, scope]", "[path, scope]"],
    ["argument_hint:\n  - path\n  - scope", "[path, scope]"],
    ["argument-hint: []", "[]"],
  ])("normalizes argument hint metadata: %s", (metadata, argumentHint) => {
    expect(parseCommand(`---\n${metadata}\n---\nCommand body`)).toEqual({
      description: "",
      argumentHint,
      body: "Command body",
    });
  });

  it("reports invalid argument metadata as a concise warning and keeps other commands", async () => {
    const invalid = await file(
      "repo/.claude/commands/bad.md",
      "---\nargument-hint: {path: value}\n---\nBody",
    );
    await file("repo/.claude/commands/good.md", "Good command");
    const catalog = await commandCatalog(agent, roots);
    expect(catalog.commands.map((command) => command.name)).toEqual(["good"]);
    expect(catalog.warnings).toEqual([
      `${invalid}: Invalid command metadata (argument-hint: expected text or a list of text).`,
    ]);
  });

  it("preserves shadowed files and invokes the live project command once", async () => {
    const project = await file("repo/.claude/commands/team/review.md", "Project review");
    const global = await file("home/.claude/commands/review.md", "Global review");
    agent.commands = async () => ({
      commands: [
        { name: "review", description: "Review", kind: "command" },
        { name: "compact", description: "Compact context" },
        { name: "skill", description: "A skill", kind: "skill" },
      ],
    });
    const catalog = await commandCatalog(agent, roots);
    expect(catalog.commands.map(({ id, mode, shadowedBy }) => ({ id, mode, shadowedBy }))).toEqual([
      { id: project, mode: "native", shadowedBy: null },
      { id: global, mode: "template", shadowedBy: project },
      { id: "session:compact", mode: "native", shadowedBy: null },
    ]);
    await sendCommand(agent, { commandId: project, args: '"src tests"', mode: "native" }, roots);
    await sendCommand(agent, { commandId: global, args: "", mode: "template" }, roots);
    expect(sent).toEqual([
      '/review "src tests"',
      "Run the following command template (review):\n\nGlobal review",
    ]);
  });

  it("keeps shared templates distinct from native commands with the same name", async () => {
    const generic = await file("repo/.agents/commands/review.md", "Shared review");
    agent.commands = async () => ({ commands: [{ name: "review", description: "Native review" }] });
    const catalog = await commandCatalog(agent, roots);
    expect(catalog.commands.map(({ id, mode }) => ({ id, mode }))).toEqual([
      { id: generic, mode: "template" },
      { id: "session:review", mode: "native" },
    ]);
  });

  it("uses Codex prompts namespace and treats project prompts as templates", async () => {
    agent.provider = "codex";
    const project = await file("repo/.codex/prompts/check.md", "Project");
    const global = await file("home/.codex/prompts/check.md", "Global");
    agent.commands = async () => ({ commands: [{ name: "prompts:check", description: "Check" }] });
    const catalog = await commandCatalog(agent, roots);
    expect(catalog.commands.map(({ id, name, mode }) => ({ id, name, mode }))).toEqual([
      { id: project, name: "check", mode: "template" },
      { id: global, name: "prompts:check", mode: "native" },
    ]);
    await sendCommand(agent, { commandId: global, args: "NAME=world", mode: "native" }, roots);
    expect(sent).toEqual(["/prompts:check NAME=world"]);
  });

  it("scans nested OpenCode commands and legacy singular directories", async () => {
    agent.provider = "opencode";
    await file("repo/.opencode/commands/team/review.md", "Review");
    await file("home/.config/opencode/command/test.md", "Test");
    const catalog = await commandCatalog(agent, roots);
    expect(catalog.commands.map(({ name, scope }) => ({ name, scope }))).toEqual([
      { name: "team/review", scope: "project" },
      { name: "test", scope: "global" },
    ]);
  });

  it("strips the prompt suffix only for Copilot prompt files", async () => {
    await file("repo/.claude/commands/check.prompt.md", "Claude");
    await file("repo/.github/prompts/check.prompt.md", "Copilot");
    const claude = await commandCatalog(agent, roots);
    expect(claude.commands.map((command) => command.name)).toEqual(["check.prompt"]);
    agent.provider = "copilot";
    const copilot = await commandCatalog(agent, roots);
    expect(copilot.commands.map((command) => command.name)).toEqual(["check"]);
  });

  it("follows linked directories without looping and reports invalid files", async () => {
    await file("shared/good.md", "---\ndescription: Linked\n---\nBody");
    await file("repo/.agents/commands/bad.md", "---\ndescription: [broken\n---\nBody");
    await symlink(
      path.join(directory, "shared"),
      path.join(directory, "repo/.agents/commands/linked"),
    );
    await symlink(path.join(directory, "shared"), path.join(directory, "shared/loop"));
    const result = await discoverCommands({ cwd: agent.cwd, provider: agent.provider, roots });
    expect(result.files.map(({ name, body }) => ({ name, body }))).toEqual([
      { name: "linked/good", body: "Body" },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("bad.md");
  });

  it("returns templates with a visible warning when the session query fails", async () => {
    await file("repo/.agents/commands/check.md", "Check");
    agent.commands = async () => {
      throw new Error("Session disconnected");
    };
    const catalog = await commandCatalog(agent, roots);
    expect(catalog.commands.map((command) => command.name)).toEqual(["check"]);
    expect(catalog.warnings).toEqual(["Session commands: Session disconnected"]);
  });

  it("does not read arbitrary paths or send removed commands", async () => {
    const secret = await file("secret.md", "Private");
    await expect(commandBody(agent, secret, roots)).rejects.toThrow("no longer available");
    const commandId = await file("repo/.agents/commands/check.md", "Check");
    await rm(commandId);
    await expect(
      sendCommand(agent, { commandId, args: "", mode: "template" }, roots),
    ).rejects.toThrow("no longer available");
    expect(sent).toEqual([]);
  });

  it("rejects a native command if the session no longer reports it", async () => {
    const commandId = await file("repo/.claude/commands/check.md", "Check");
    await expect(
      sendCommand(agent, { commandId, args: "", mode: "native" }, roots),
    ).rejects.toThrow("availability changed");
    expect(sent).toEqual([]);
  });

  it("refuses to interrupt a running or archived agent", async () => {
    const input = { commandId: "session:compact", args: "", mode: "native" as const };
    agent.busy = true;
    await expect(sendCommand(agent, input, roots)).rejects.toThrow("current turn");
    agent.busy = false;
    agent.archived = true;
    await expect(sendCommand(agent, input, roots)).rejects.toThrow("archived");
    expect(sent).toEqual([]);
  });

  it("propagates send failures instead of reporting success", async () => {
    agent.commands = async () => ({ commands: [{ name: "compact", description: "Compact" }] });
    agent.send = async () => {
      throw new Error("Connection lost");
    };
    await expect(
      sendCommand(agent, { commandId: "session:compact", args: "", mode: "native" }, roots),
    ).rejects.toThrow("Connection lost");
  });

  it("expands quoted positional and named arguments without recursively expanding inserted text", () => {
    const command = { name: "review", mode: "template" as const };
    expect(
      invocationText(
        command,
        "Review $1 then $2 ($NAME).",
        '"source folder" "$ARGUMENTS" NAME="a b"',
      ),
    ).toBe(
      "Run the following command template (review):\n\nReview source folder then $ARGUMENTS (a b).",
    );
    expect(invocationText(command, "Review $ARGUMENTS", "a b")).toBe(
      "Run the following command template (review):\n\nReview a b",
    );
    expect(invocationText(command, "/review", "a b")).toBe(
      "Run the following command template (review):\n\n/review\n\nArguments: a b",
    );
    expect(() => invocationText(command, "Review $1", '"unclosed')).toThrow(
      "Close the quoted argument",
    );
    expect(() => invocationText(command, "", "")).toThrow("empty");
  });
});
