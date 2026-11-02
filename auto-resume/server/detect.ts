import { Temporal } from "@js-temporal/polyfill";

// A bare 429/rate_limit may be RPM/TPM throttling, not subscription exhaustion.
const quota =
  /(?:you(?:'|’)ve (?:hit|reached) (?:your |the )?(?:usage )?limit|(?:usage|subscription|weekly|daily|five.hour|5.hour|session) (?:limit|quota).{0,60}(?:reached|exceeded|exhausted)|(?:hit|reached|exceeded).{0,30}(?:usage|subscription|weekly|daily) (?:limit|quota)|out of (?:credits|usage)|(?:额度|配额|用量).{0,12}(?:耗尽|用完|用尽|上限)|(?:usage_limit_reached|quota_exceeded))/i;
const codes = new Set(["usage_limit_reached", "quota_exceeded", "subscription_limit_reached"]);
export function isQuotaError(text: string, code?: string): boolean {
  return codes.has(code ?? "") || quota.test(text);
}

export function validTimezone(zone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(zone);
    return true;
  } catch {
    return false;
  }
}

/** Only provider reset/retry clauses are parsed. Never guess an ambiguous timezone. */
export function parseReset(text: string, now: number, timezone: string): string | null {
  const clause = text.match(
    /(?:resets?(?:\s+(?:at|on|in))?|try again(?:\s+(?:at|on|in))?|available(?:\s+(?:at|in))?|恢复(?:时间)?[：:]?)\s*([^\n]+)/i,
  )?.[1];
  if (!clause) return null;
  try {
    const iso = clause.match(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})\b/i,
    )?.[0];
    if (iso) return future(Date.parse(iso), now);
    const relative = clause.match(
      /^(?:(\d+)\s*(?:days?|d|天)\s*)?(?:(\d+)\s*(?:hours?|hrs?|h|小时)\s*)?(?:(\d+)\s*(?:minutes?|mins?|m|分钟)\s*)?(?:(\d+)\s*(?:seconds?|secs?|s|秒))?/i,
    );
    if (relative?.[0]?.trim()) {
      const seconds =
        Number(relative[1] ?? 0) * 86400 +
        Number(relative[2] ?? 0) * 3600 +
        Number(relative[3] ?? 0) * 60 +
        Number(relative[4] ?? 0);
      if (seconds > 0) return future(now + seconds * 1000, now);
    }
    if (/\((?:[A-Z]{2,5})\)/.test(clause) && !/\((?:UTC|GMT)\)/.test(clause)) return null;
    const iana = clause.match(/\(([A-Za-z_]+\/[A-Za-z_/-]+)\)/)?.[1];
    const utc = clause.match(/\b(UTC|GMT)([+-]\d{1,2}(?::\d{2})?)?\b/i);
    // Abbreviations such as CST are ambiguous. Explicit offsets and IANA names are accepted.
    if (
      /\b(?:[A-Z]{2,5})\b/.test(
        clause.replace(/\([^)]*\)/g, "").replace(/\b(?:AM|PM|UTC|GMT)\b/gi, ""),
      )
    )
      return null;
    let zone = iana || timezone;
    if (utc)
      zone = utc[2]
        ? utc[2].replace(
            /^([+-])(\d{1,2})$/,
            (_, sign: string, hour: string) => `${sign}${hour.padStart(2, "0")}:00`,
          )
        : "UTC";
    const localNow = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone);
    const clock = clause.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    // Date-first phrases require separate parsing below; a clock must be explicit.
    const dateTime = clause.match(/(\d{4}-\d{2}-\d{2})[ T,]+(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    const monthDate = clause.match(
      /(\d{1,2}):(\d{2})\s*(am|pm)?\s+on\s+([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/i,
    );
    const monthFirst = clause.match(
      /([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})[, ]+(\d{1,2}):(\d{2})\s*(am|pm)?/i,
    );
    const chosen = dateTime
      ? ["", dateTime[2], dateTime[3], dateTime[4]]
      : monthFirst
        ? ["", monthFirst[4], monthFirst[5], monthFirst[6]]
        : clock;
    if (!chosen || (!chosen[2] && !chosen[3])) return null;
    let hour = Number(chosen[1]);
    const minute = Number(chosen[2] || 0);
    const meridiem = chosen[3]?.toLowerCase();
    if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) return null;
    if (meridiem) hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
    let date = localNow.toPlainDate();
    let explicitDate = false;
    if (dateTime) {
      date = Temporal.PlainDate.from(dateTime[1]);
      explicitDate = true;
    } else if (monthDate || monthFirst) {
      const months = [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ];
      const month =
        months.indexOf((monthDate?.[4] ?? monthFirst![1]).slice(0, 3).toLowerCase()) + 1;
      if (!month) return null;
      date = Temporal.PlainDate.from(
        {
          year: Number(monthDate?.[6] ?? monthFirst![3]),
          month,
          day: Number(monthDate?.[5] ?? monthFirst![2]),
        },
        { overflow: "reject" },
      );
      explicitDate = true;
    } else if (/\btomorrow\b|明天/i.test(clause)) {
      date = date.add({ days: 1 });
      explicitDate = true;
    }
    // If an unrecognized date is present, asking the user is safer than choosing tomorrow.
    else if (
      /\bon\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\d{4}-\d{2}-\d{2}/i.test(
        clause,
      )
    )
      return null;
    let target = date
      .toPlainDateTime({ hour, minute })
      .toZonedDateTime(zone, { disambiguation: "reject" });
    if (!explicitDate && target.epochMilliseconds <= now)
      target = date
        .add({ days: 1 })
        .toPlainDateTime({ hour, minute })
        .toZonedDateTime(zone, { disambiguation: "reject" });
    return future(target.epochMilliseconds, now);
  } catch {
    return null;
  }
}
function future(value: number, now: number): string | null {
  return Number.isFinite(value) && value > now && value - now <= 370 * 86400000
    ? new Date(value).toISOString()
    : null;
}

/** Ignore user quotes, reasoning, and tool output. Only inspect the latest turn's final output. */
export function latestOutput(
  items: readonly { type: string; text?: string; message?: string }[],
): string {
  let result = "";
  for (const item of items) {
    if (item.type === "user_message") result = "";
    if (item.type === "assistant_message") result += `${item.text ?? ""}\n`;
    if (item.type === "error") result += `${item.message ?? ""}\n`;
  }
  return result.trim();
}
