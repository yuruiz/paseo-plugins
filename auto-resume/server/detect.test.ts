import { describe, expect, it } from "vitest";
import { isQuotaError, latestOutput, parseReset } from "./detect";
const now = Date.parse("2026-11-01T08:00:00Z");
describe("subscription quota detection", () => {
  it.each([
    "You've hit your limit · resets 5pm (Asia/Shanghai)",
    "You've hit your usage limit. Try again at 12:30 PM on Nov 2, 2026.",
    "Weekly usage limit exceeded",
    "当前额度已用完",
    "Out of credits",
  ])("recognizes provider notice %s", (text) => expect(isQuotaError(text)).toBe(true));
  it.each([
    "429 Too Many Requests",
    "rate_limit_error",
    "Connection timed out",
    "Invalid API key",
    "Request exceeds context window",
    "permission denied",
  ])("does not resume unrelated error %s", (text) => expect(isQuotaError(text)).toBe(false));
  it("recognizes structured quota codes", () =>
    expect(isQuotaError("Please wait", "usage_limit_reached")).toBe(true));
  it("ignores old turns, user quotes, tools and reasoning", () =>
    expect(
      latestOutput([
        { type: "assistant_message", text: "You've hit your limit" },
        { type: "user_message", text: "Explain out of credits" },
        { type: "tool_call", text: "out of credits" },
        { type: "reasoning", text: "out of credits" },
        { type: "assistant_message", text: "Hello" },
      ]),
    ).toBe("Hello"));
});
describe("reset time parsing", () => {
  it.each([
    ["resets 5pm (Asia/Shanghai)", "2026-11-01T09:00:00.000Z"],
    ["resets 3am (Asia/Shanghai)", "2026-11-01T19:00:00.000Z"],
    ["resets at 18:30", "2026-11-01T10:30:00.000Z"],
    ["try again in 1 hour 30 minutes", "2026-11-01T09:30:00.000Z"],
    ["resets in 2d 3h 5m", "2026-11-03T11:05:00.000Z"],
    ["try again at 2026-11-03T17:00:00+08:00", "2026-11-03T09:00:00.000Z"],
    ["resets 2026-11-03 17:00", "2026-11-03T09:00:00.000Z"],
    ["try again at 12:30 PM on Nov 2, 2026", "2026-11-02T04:30:00.000Z"],
    ["try again at Nov 3rd, 2026 3:00 PM", "2026-11-03T07:00:00.000Z"],
    ["resets 9:00 UTC", "2026-11-01T09:00:00.000Z"],
    ["resets 18:00 UTC+8", "2026-11-01T10:00:00.000Z"],
    ["恢复时间：18:00", "2026-11-01T10:00:00.000Z"],
  ])("parses %s", (text, expected) =>
    expect(parseReset(text, now, "Asia/Shanghai")).toBe(expected),
  );
  it.each([
    "Try later",
    "resets soon",
    "resets 25:00",
    "resets 12:90",
    "resets 5pm (CST)",
    "resets 5pm PST",
    "resets 5pm on Friday",
    "resets at 2026-10-01T08:00:00Z",
    "resets 2026-02-30 18:00",
  ])("requires user input for %s", (text) =>
    expect(parseReset(text, now, "Asia/Shanghai")).toBeNull(),
  );
  it("rejects ambiguous DST instants", () =>
    expect(
      parseReset(
        "resets 2026-11-01 01:30 (America/New_York)",
        Date.parse("2026-11-01T00:00:00Z"),
        "UTC",
      ),
    ).toBeNull());
});
