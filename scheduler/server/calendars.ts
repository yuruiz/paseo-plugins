import { Temporal } from "@js-temporal/polyfill";
import { calendarSchema, type Calendar, type CalendarDay } from "../shared/model";

function closedDates(dates: string[]): Record<string, CalendarDay> {
  return Object.fromEntries(
    dates.map((date) => [date, { open: false, reason: "Exchange holiday", session: null }]),
  );
}

function mainlandOverrides(): Record<string, CalendarDay> {
  const overrides: Record<string, CalendarDay> = {};
  const holidays = [
    ["2026-01-01", "2026-01-03", "New Year’s Day"],
    ["2026-02-15", "2026-02-23", "Spring Festival"],
    ["2026-04-04", "2026-04-06", "Qingming Festival"],
    ["2026-05-01", "2026-05-05", "Labour Day"],
    ["2026-06-19", "2026-06-21", "Dragon Boat Festival"],
    ["2026-09-25", "2026-09-27", "Mid-Autumn Festival"],
    ["2026-10-01", "2026-10-07", "National Day"],
  ];
  for (const [start, end, reason] of holidays) {
    for (
      let date = Temporal.PlainDate.from(start);
      date.toString() <= end;
      date = date.add({ days: 1 })
    ) {
      overrides[date.toString()] = { open: false, reason, session: null };
    }
  }
  for (const date of [
    "2026-01-04",
    "2026-02-14",
    "2026-02-28",
    "2026-05-09",
    "2026-09-20",
    "2026-10-10",
  ]) {
    overrides[date] = { open: true, reason: "Makeup workday", session: null };
  }
  return overrides;
}

const usOverrides = closedDates([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
]);
for (const date of ["2026-11-27", "2026-12-24"]) {
  usOverrides[date] = {
    open: true,
    reason: "Early close",
    session: { open: "09:30", close: "13:00", halfDay: true },
  };
}
const hkOverrides = closedDates([
  "2026-01-01",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-04-03",
  "2026-04-06",
  "2026-04-07",
  "2026-05-01",
  "2026-05-25",
  "2026-06-19",
  "2026-07-01",
  "2026-10-01",
  "2026-10-19",
  "2026-12-25",
]);
for (const date of ["2026-02-16", "2026-12-24", "2026-12-31"]) {
  hkOverrides[date] = {
    open: true,
    reason: "Half day (closing auction ends by 12:10)",
    session: { open: "09:30", close: "12:10", halfDay: true },
  };
}
const annual = {
  version: "2026.1",
  validFrom: "2026-01-01",
  validThrough: "2026-12-31",
  weekdays: [1, 2, 3, 4, 5],
};

export const builtinCalendars: Calendar[] = [
  calendarSchema.parse({
    id: "civil",
    name: "Calendar days",
    version: "1",
    timezone: "Asia/Shanghai",
    validFrom: "1900-01-01",
    validThrough: "2199-12-31",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    sources: ["https://tc39.es/proposal-temporal/"],
    session: null,
    overrides: {},
  }),
  calendarSchema.parse({
    ...annual,
    id: "cn-workdays",
    name: "Mainland China workdays (including makeup days)",
    timezone: "Asia/Shanghai",
    sources: ["https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm"],
    session: null,
    overrides: mainlandOverrides(),
  }),
  ...["nyse", "nasdaq"].map((exchange) =>
    calendarSchema.parse({
      ...annual,
      id: `us-${exchange}`,
      name: `US ${exchange.toUpperCase()}`,
      timezone: "America/New_York",
      sources: [
        exchange === "nyse"
          ? "https://www.nyse.com/trade/hours-calendars"
          : "https://www.nasdaq.com/market-activity/stock-market-holiday-schedule",
      ],
      session: { open: "09:30", close: "16:00", halfDay: false },
      overrides: usOverrides,
    }),
  ),
  calendarSchema.parse({
    ...annual,
    id: "hk-hkex",
    name: "Hong Kong HKEX securities",
    timezone: "Asia/Hong_Kong",
    sources: [
      "https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf",
      "https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market?sc_lang=en",
    ],
    session: { open: "09:30", close: "16:10", halfDay: false },
    overrides: hkOverrides,
  }),
];

export function calendarsWithImports(imported: Calendar[]): Calendar[] {
  const calendars = new Map(builtinCalendars.map((calendar) => [calendar.id, calendar]));
  for (const calendar of imported) calendars.set(calendar.id, calendar);
  return [...calendars.values()];
}

export class CalendarCoverageError extends Error {
  constructor(calendar: Calendar, date: string) {
    super(
      `${calendar.name} has no data for ${date} (coverage: ${calendar.validFrom} to ${calendar.validThrough})`,
    );
  }
}

export function calendarDay(calendar: Calendar, date: Temporal.PlainDate): CalendarDay {
  const key = date.toString();
  if (key < calendar.validFrom || key > calendar.validThrough)
    throw new CalendarCoverageError(calendar, key);
  const override = calendar.overrides[key];
  if (override) return override;
  const open = calendar.weekdays.includes(date.dayOfWeek);
  return {
    open,
    reason: open ? "Regular business day" : "Weekend / non-business day",
    session: open ? calendar.session : null,
  };
}
