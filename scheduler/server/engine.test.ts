import { describe, expect, it } from "vitest";
import { builtinCalendars, calendarDay } from "./calendars";
import { Temporal } from "@js-temporal/polyfill";
import { preview } from "./engine";
import type { Rule } from "../shared/model";

const monthEnd: Rule = {
  calendarId: "civil",
  timezone: "Asia/Shanghai",
  recurrence: { kind: "monthly-date", day: -1 },
  adjustment: "skip",
  withinMonth: true,
  time: { kind: "fixed", at: "09:00" },
};

describe("calendar-aware recurrence", () => {
  it("runs on the final date of each month, including leap February", () => {
    const result = preview(monthEnd, builtinCalendars, "2028-01-01T00:00:00Z", 3);
    expect(result.occurrences.map((occurrence) => occurrence.scheduledAt)).toEqual([
      "2028-01-31T01:00:00.000Z",
      "2028-02-29T01:00:00.000Z",
      "2028-03-31T01:00:00.000Z",
    ]);
  });

  it("includes mainland weekend makeup days and excludes the National Day break", () => {
    const rule: Rule = { ...monthEnd, calendarId: "cn-workdays", recurrence: { kind: "daily" } };
    expect(
      preview(rule, builtinCalendars, "2026-09-19T00:00:00Z", 2).occurrences.map(
        (o) => o.effectiveDate,
      ),
    ).toEqual(["2026-09-20", "2026-09-21"]);
    expect(
      preview(rule, builtinCalendars, "2026-09-30T02:00:00Z", 3).occurrences.map(
        (o) => o.effectiveDate,
      ),
    ).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
  });

  it("keeps US open at 09:30 through the March DST transition", () => {
    const rule: Rule = {
      ...monthEnd,
      calendarId: "us-nyse",
      timezone: "America/New_York",
      recurrence: { kind: "daily" },
      time: { kind: "session", anchor: "open", offsetMinutes: 0 },
    };
    expect(
      preview(rule, builtinCalendars, "2026-03-05T20:00:00Z", 2).occurrences.map(
        (o) => o.scheduledAt,
      ),
    ).toEqual(["2026-03-06T14:30:00.000Z", "2026-03-09T13:30:00.000Z"]);
  });

  it("uses the early US close on Black Friday", () => {
    const rule: Rule = {
      ...monthEnd,
      calendarId: "us-nasdaq",
      timezone: "America/New_York",
      recurrence: { kind: "daily" },
      time: { kind: "session", anchor: "close", offsetMinutes: 15 },
    };
    const [occurrence] = preview(rule, builtinCalendars, "2026-11-26T00:00:00Z", 1).occurrences;
    expect(occurrence.scheduledAt).toBe("2026-11-27T18:15:00.000Z");
    expect(occurrence.halfDay).toBe(true);
  });

  it("uses the HK closing-auction upper bound on a half day", () => {
    const rule: Rule = {
      ...monthEnd,
      calendarId: "hk-hkex",
      timezone: "Asia/Hong_Kong",
      recurrence: { kind: "daily" },
      time: { kind: "session", anchor: "close", offsetMinutes: 5 },
    };
    expect(
      preview(rule, builtinCalendars, "2026-12-24T00:00:00Z", 2).occurrences.map(
        (o) => o.scheduledAt,
      ),
    ).toEqual(["2026-12-24T04:15:00.000Z", "2026-12-28T08:15:00.000Z"]);
  });

  it("selects the last mainland workday even when it is Saturday makeup work", () => {
    const rule: Rule = {
      ...monthEnd,
      calendarId: "cn-workdays",
      recurrence: { kind: "monthly-business-day", ordinal: -1 },
    };
    expect(
      preview(rule, builtinCalendars, "2026-02-01T00:00:00Z", 1).occurrences[0].effectiveDate,
    ).toBe("2026-02-28");
  });

  it("selects the last HK trading day instead of the last mainland workday", () => {
    const rule: Rule = {
      ...monthEnd,
      calendarId: "hk-hkex",
      timezone: "Asia/Hong_Kong",
      recurrence: { kind: "monthly-business-day", ordinal: -1 },
    };
    expect(
      preview(rule, builtinCalendars, "2026-02-01T00:00:00Z", 1).occurrences[0].effectiveDate,
    ).toBe("2026-02-27");
  });

  it("moves a month-end weekend back inside the month", () => {
    const rule: Rule = {
      ...monthEnd,
      calendarId: "us-nyse",
      timezone: "America/New_York",
      adjustment: "previous",
    };
    const [occurrence] = preview(rule, builtinCalendars, "2026-01-01T00:00:00Z", 1).occurrences;
    expect([occurrence.nominalDate, occurrence.effectiveDate]).toEqual([
      "2026-01-31",
      "2026-01-30",
    ]);
  });

  it("can move month-end into the next month, once", () => {
    const rule: Rule = {
      ...monthEnd,
      calendarId: "us-nyse",
      timezone: "America/New_York",
      adjustment: "next",
      withinMonth: false,
    };
    expect(
      preview(rule, builtinCalendars, "2026-02-01T00:00:00Z", 1).occurrences[0].effectiveDate,
    ).toBe("2026-02-02");
  });

  it("does not guess holidays beyond a calendar's coverage", () => {
    const rule: Rule = { ...monthEnd, calendarId: "cn-workdays", recurrence: { kind: "daily" } };
    const result = preview(rule, builtinCalendars, "2026-12-31T02:00:00Z", 1);
    expect(result.occurrences).toEqual([]);
    expect(result.notice).toContain("2027-01-01");
  });

  it("skips missing DST wall times and fires only once in the repeated hour", () => {
    const rule: Rule = {
      ...monthEnd,
      timezone: "America/New_York",
      recurrence: { kind: "daily" },
      time: { kind: "fixed", at: "02:30" },
    };
    expect(
      preview(rule, builtinCalendars, "2026-03-08T00:00:00Z", 1).occurrences[0].scheduledAt,
    ).toBe("2026-03-09T06:30:00.000Z");
    rule.time = { kind: "fixed", at: "01:30" };
    expect(
      preview(rule, builtinCalendars, "2026-11-01T05:30:00Z", 1).occurrences[0].scheduledAt,
    ).toBe("2026-11-02T06:30:00.000Z");
  });

  it("honors imported closures and explicit weekend opening", () => {
    const custom = {
      ...builtinCalendars[1],
      id: "company",
      name: "Company",
      version: "2026.2",
      overrides: {
        "2026-09-21": { open: false, reason: "Company holiday", session: null },
        "2026-09-19": { open: true, reason: "Business day", session: null },
      },
    };
    const rule: Rule = { ...monthEnd, calendarId: "company", recurrence: { kind: "daily" } };
    expect(
      preview(rule, [...builtinCalendars, custom], "2026-09-18T02:00:00Z", 2).occurrences.map(
        (o) => o.effectiveDate,
      ),
    ).toEqual(["2026-09-19", "2026-09-22"]);
  });

  it("counts official full and half trading days separately", () => {
    for (const [id, expected] of [
      ["us-nyse", [251, 2]],
      ["hk-hkex", [247, 3]],
    ] as const) {
      const calendar = builtinCalendars.find((item) => item.id === id)!;
      let open = 0;
      let half = 0;
      for (
        let day = Temporal.PlainDate.from("2026-01-01");
        day.year === 2026;
        day = day.add({ days: 1 })
      ) {
        const result = calendarDay(calendar, day);
        if (result.open) open += 1;
        if (result.session?.halfDay) half += 1;
      }
      expect([open, half]).toEqual(expected);
    }
  });
  it("supports the last Friday and skips absent monthly dates", () => {
    const rule: Rule = {
      ...monthEnd,
      recurrence: { kind: "monthly-weekday", weekday: 5, ordinal: -1 },
    };
    expect(
      preview(rule, builtinCalendars, "2026-02-01T00:00:00Z", 1).occurrences[0].effectiveDate,
    ).toBe("2026-02-27");
    rule.recurrence = { kind: "monthly-date", day: 31 };
    expect(
      preview(rule, builtinCalendars, "2026-02-01T00:00:00Z", 1).occurrences[0].effectiveDate,
    ).toBe("2026-03-31");
  });
});
