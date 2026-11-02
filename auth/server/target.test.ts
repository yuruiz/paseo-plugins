import { describe, it, expect } from "vitest";
import { makeTarget, providerOf } from "./target";

describe("credential scopes", () => {
  it("separates credential homes but deduplicates agents sharing a login", () => {
    const a = makeTarget("codex", "/work/a", {}, { HOME: "/users/a", CODEX_HOME: "/ssd/codex-a" });
    const b = makeTarget("codex", "/work/b", {}, { HOME: "/users/a", CODEX_HOME: "/ssd/codex-a" });
    const c = makeTarget("codex", "/work/a", {}, { HOME: "/users/a", CODEX_HOME: "/ssd/codex-b" });
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });
  it("honors provider env and strips internal process controls", () => {
    const target = makeTarget(
      "claude",
      "/work",
      { env: { CLAUDE_CONFIG_DIR: "/ssd/profile" } },
      { CLAUDECODE: "1", ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "--inspect", HOME: "/users/a" },
    );
    expect(target.env.CLAUDE_CONFIG_DIR).toBe("/ssd/profile");
    expect(target.env.CLAUDECODE).toBeUndefined();
    expect(target.env.NODE_OPTIONS).toBeUndefined();
  });
  it("does not silently replace environment-based credentials", () => {
    expect(makeTarget("claude", "/work", {}, { ANTHROPIC_API_KEY: "secret" }).problem).toContain(
      "environment variables",
    );
    expect(
      makeTarget("codex", "/work", {}, { OPENAI_IDENTITY_TOKEN_FILE: "/token" }).problem,
    ).toContain("environment variables");
  });
  it("rejects launch wrappers with opaque arguments", () =>
    expect(
      makeTarget("codex", "/work", { command: ["ssh", "host", "codex"] }, {}).problem,
    ).toContain("custom"));
  it("resolves custom provider families", () => {
    expect(providerOf("work", { work: { extends: "claude" } })).toBe("claude");
    expect(providerOf("acp", {})).toBeUndefined();
  });
});
