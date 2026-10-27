import { Temporal } from "@js-temporal/polyfill";
import {
  ruleSchema,
  type Calendar,
  type Occurrence,
  type Preview,
  type Rule,
} from "../shared/model";
import { CalendarCoverageError, calendarDay } from "./calendars";

export function validateRule(rule: Rule, calendars: Calendar[]): Calendar {
  ruleSchema.parse(rule);
  const calendar = calendars.find((item) => item.id === rule.calendarId);
  if (!calendar) throw new Error(`Calendar not found: ${rule.calendarId}`);
  if (calendar.id !== "civil" && calendar.timezone !== rule.timezone) {
    throw new Error(`Dates and times for this calendar must use ${calendar.timezone}`);
  }
  if (rule.time.kind === "session" && calendar.session === null) {
    throw new Error("This calendar has no trading sessions; choose a fixed time");
  }
  return calendar;
}

function monthDates(month: Temporal.PlainYearMonth): Temporal.PlainDate[] {
  return Array.from({ length: month.daysInMonth }, (_, index) =>
    month.toPlainDate({ day: index + 1 }),
  );
}

function pickOrdinal(dates: Temporal.PlainDate[], ordinal: number): Temporal.PlainDate[] {
  const index = ordinal > 0 ? ordinal - 1 : dates.length + ordinal;
  const date = dates[index];
  return date ? [date] : [];
}

function nominalDates(
  rule: Rule,
  calendar: Calendar,
  month: Temporal.PlainYearMonth,
): Temporal.PlainDate[] {
  const recurrence = rule.recurrence;
  const dates = monthDates(month);
  switch (recurrence.kind) {
    case "daily":
      return dates;
    case "weekly":
      return dates.filter((date) => recurrence.weekdays.includes(date.dayOfWeek));
    case "monthly-date":
      return pickOrdinal(dates, recurrence.day);
    case "monthly-weekday":
      return pickOrdinal(
        dates.filter((date) => date.dayOfWeek === recurrence.weekday),
        recurrence.ordinal,
      );
    case "monthly-business-day":
      return pickOrdinal(
        dates.filter((date) => calendarDay(calendar, date).open),
        recurrence.ordinal,
      );
  }
}

function adjustedDate(
  rule: Rule,
  calendar: Calendar,
  nominal: Temporal.PlainDate,
): Temporal.PlainDate | null {
  let date = nominal;
  for (let index = 0; index <= 31; index += 1) {
    if (rule.withinMonth && date.month !== nominal.month) return null;
    if (calendarDay(calendar, date).open) return date;
    if (rule.adjustment === "skip") return null;
    date = date.add({ days: rule.adjustment === "previous" ? -1 : 1 });
  }
  throw new Error("No business day found within 31 days; check the calendar");
}

function occurrenceForDate(
  rule: Rule,
  calendar: Calendar,
  nominal: Temporal.PlainDate,
): Occurrence | null {
  const effective = adjustedDate(rule, calendar, nominal);
  if (!effective) return null;
  const day = calendarDay(calendar, effective);
  let time: string;
  let offset = 0;
  if (rule.time.kind === "fixed") time = rule.time.at;
  else {
    if (!day.session) throw new Error(`No trading session is defined for ${effective}`);
    time = day.session[rule.time.anchor];
    offset = rule.time.offsetMinutes;
  }
  const local = effective.toPlainDateTime(time);
  const zoned = local.toZonedDateTime(rule.timezone, { disambiguation: "earlier" });
  // A missing spring-forward time is skipped; a repeated autumn time runs only at its first instant.
  if (!zoned.toPlainDateTime().equals(local)) return null;
  const instant = zoned.toInstant().add({ minutes: offset });
  const adjusted = !nominal.equals(effective);
  const reason = adjusted ? `${nominal} → ${effective}; ${day.reason}` : day.reason;
  return {
    scheduledAt: new Date(instant.epochMilliseconds).toISOString(),
    nominalDate: nominal.toString(),
    effectiveDate: effective.toString(),
    localTime: instant.toZonedDateTimeISO(rule.timezone).toString(),
    reason,
    halfDay: day.session?.halfDay ?? false,
    calendarVersion: calendar.version,
  };
}

/** Bounds date enumeration, not minute scanning. Returns known occurrences even at a coverage boundary. */
export function preview(rule: Rule, calendars: Calendar[], after: string, count = 5): Preview {
  const calendar = validateRule(rule, calendars);
  const afterInstant = Temporal.Instant.from(after);
  const localAfter = afterInstant.toZonedDateTimeISO(rule.timezone).toPlainDate();
  const earliest = localAfter.subtract({ days: 32 });
  let month = localAfter.toPlainYearMonth().subtract({ months: 1 });
  const occurrences = new Map<string, Occurrence>();
  let notice: string | null = null;

  for (let step = 0; step < 26; step += 1, month = month.add({ months: 1 })) {
    const end = month.toPlainDate({ day: month.daysInMonth });
    if (end.toString() < calendar.validFrom) continue;
    try {
      for (const nominal of nominalDates(rule, calendar, month)) {
        if (Temporal.PlainDate.compare(nominal, earliest) < 0) continue;
        // Previous-month candidates cannot run after the cursor when no forward adjustment is allowed.
        const pastMonth = Temporal.PlainYearMonth.compare(month, localAfter.toPlainYearMonth()) < 0;
        if (
          pastMonth &&
          rule.time.kind === "fixed" &&
          (rule.adjustment !== "next" || rule.withinMonth)
        )
          continue;
        const occurrence = occurrenceForDate(rule, calendar, nominal);
        if (occurrence && Temporal.Instant.compare(occurrence.scheduledAt, afterInstant) > 0) {
          occurrences.set(occurrence.scheduledAt, occurrence);
        }
      }
    } catch (error) {
      if (!(error instanceof CalendarCoverageError)) throw error;
      notice = error.message;
      break;
    }
    const sorted = [...occurrences.values()].sort((a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt),
    );
    const last = sorted[count - 1];
    // A date in the next month may move back by up to 31 days, plus a session offset of 12 hours.
    const safeBoundary = end.subtract({ days: 32 }).toZonedDateTime(rule.timezone).toInstant();
    if (last && Temporal.Instant.compare(last.scheduledAt, safeBoundary) < 0) {
      return { occurrences: sorted.slice(0, count), notice: null };
    }
  }
  const sorted = [...occurrences.values()].sort((a, b) =>
    a.scheduledAt.localeCompare(b.scheduledAt),
  );
  if (sorted.length >= count) notice = null;
  if (sorted.length === 0 && !notice) notice = "No matching run time in the next two years";
  return { occurrences: sorted.slice(0, count), notice };
}
