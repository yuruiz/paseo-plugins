import { describe, it, expect } from "vitest";
import { authUrl, parseOutput, failureMessage } from "./output";
import { needsLogin } from "../shared/detection";

describe("official login output", () => {
  it("recognizes current Claude URL and code prompt across chunks", () => {
    const first =
      "Opening browser…\nhttps://claude.com/cai/oauth/authorize?client_id=abc&state=sec";
    expect(parseOutput(first, "claude").url).toBeUndefined();
    const parsed = parseOutput(first + "ret\nPaste code here if prompted > ", "claude");
    expect(parsed.url).toContain("state=secret");
    expect(parsed.expectsCode).toBe(true);
  });
  it("parses Codex ANSI output and device code", () => {
    const parsed = parseOutput(
      "\u001b[1mhttps://auth.openai.com/codex/deviceauth\u001b[0m\n  ABCD-1234\n",
      "codex",
    );
    expect(parsed).toEqual({
      url: "https://auth.openai.com/codex/deviceauth",
      deviceCode: "ABCD-1234",
      expectsCode: false,
    });
  });
  it.each([
    "http://auth.openai.com/codex/deviceauth",
    "https://auth.openai.com.evil.test/codex/deviceauth",
    "https://evil@auth.openai.com/codex/deviceauth",
    "https://auth.openai.com:444/codex/deviceauth",
    "https://auth.openai.com/unrelated",
    "javascript:alert(1)",
  ])("rejects %s", (url) => expect(authUrl(url, "codex")).toBeUndefined());
  it("parses Codex 0.163 device URL and 4-5 character code", () => {
    expect(
      parseOutput("https://auth.openai.com/codex/device\nABCD-EFG12\n", "codex"),
    ).toMatchObject({ url: "https://auth.openai.com/codex/device", deviceCode: "ABCD-EFG12" });
  });
  it("never reflects raw errors or credentials", () => {
    const raw = "Access token: sk-secret-private auth=secret";
    expect(failureMessage(raw)).not.toContain("secret");
    expect(failureMessage("device authentication is not enabled")).toContain("device code");
  });
});
describe("provider authentication failures", () => {
  it.each([
    "OAuth token has expired",
    "Your refresh token was already used",
    "Not logged in · Please run /login",
    'API Error: {"type":"authentication_error"}',
    "Please sign in again",
  ])("detects %s", (message) => expect(needsLogin(message)).toBe(true));
  it.each([
    "429 Rate limit exceeded",
    "403 Forbidden: organization policy",
    "ECONNRESET network failure",
    "quota exhausted",
    "Permission denied writing a file",
    "401 MCP server rejected a tool request",
  ])("does not misclassify %s", (message) => expect(needsLogin(message)).toBe(false));
  it("accepts explicit provider error codes", () =>
    expect(needsLogin("request failed", "refresh_token_reused")).toBe(true));
});
