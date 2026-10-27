import { z } from "zod";

export const dateSchema = z.iso.date();
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm format");
export const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Invalid IANA time zone");
const sessionSchema = z
  .object({
    open: timeSchema,
    close: timeSchema,
    halfDay: z.boolean(),
  })
  .strict()
  .refine((value) => value.open < value.close, "Market open must be earlier than market close");
const daySchema = z
  .object({
    open: z.boolean(),
    reason: z.string().min(1),
    session: sessionSchema.nullable(),
  })
  .strict()
  .refine(
    (value) => value.open || value.session === null,
    "Closed days cannot include a trading session",
  );
export const calendarSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    version: z.string().min(1),
    timezone: timezoneSchema,
    validFrom: dateSchema,
    validThrough: dateSchema,
    sources: z.array(z.string().url()).min(1),
    weekdays: z.array(z.number().int().min(1).max(7)),
    session: sessionSchema.nullable(),
    overrides: z.record(dateSchema, daySchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.validFrom > value.validThrough)
      ctx.addIssue({ code: "custom", message: "Invalid calendar coverage range" });
    for (const date of Object.keys(value.overrides)) {
      if (date < value.validFrom || date > value.validThrough)
        ctx.addIssue({
          code: "custom",
          message: `Date ${date} is outside the calendar coverage range`,
        });
    }
  });
export type Calendar = z.infer<typeof calendarSchema>;
export type CalendarDay = z.infer<typeof daySchema>;

const ordinalSchema = z
  .number()
  .int()
  .min(-31)
  .max(31)
  .refine((n) => n !== 0);
export const ruleSchema = z
  .object({
    calendarId: z.string().min(1),
    timezone: timezoneSchema,
    recurrence: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("daily") }).strict(),
      z
        .object({
          kind: z.literal("weekly"),
          weekdays: z.array(z.number().int().min(1).max(7)).min(1),
        })
        .strict(),
      z.object({ kind: z.literal("monthly-date"), day: ordinalSchema }).strict(),
      z.object({ kind: z.literal("monthly-business-day"), ordinal: ordinalSchema }).strict(),
      z
        .object({
          kind: z.literal("monthly-weekday"),
          weekday: z.number().int().min(1).max(7),
          ordinal: z
            .number()
            .int()
            .min(-5)
            .max(5)
            .refine((n) => n !== 0),
        })
        .strict(),
    ]),
    adjustment: z.enum(["skip", "previous", "next"]),
    withinMonth: z.boolean(),
    time: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("fixed"), at: timeSchema }).strict(),
      z
        .object({
          kind: z.literal("session"),
          anchor: z.enum(["open", "close"]),
          offsetMinutes: z.number().int().min(-720).max(720),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const filtersDays =
      value.recurrence.kind === "daily" ||
      value.recurrence.kind === "weekly" ||
      value.recurrence.kind === "monthly-business-day";
    if (filtersDays && value.adjustment !== "skip")
      ctx.addIssue({
        code: "custom",
        message: "This recurrence selects business days directly; use the skip adjustment",
      });
  });
export type Rule = z.infer<typeof ruleSchema>;

export const jobInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(50000),
    provider: z.string().trim().min(1),
    cwd: z.string().trim().min(1),
    mode: z.string().trim(),
    thinking: z.string().trim().default(""),
    workspaceId: z.string().trim().default(""),
    appendDateToTitle: z.boolean().default(false),
    autoArchive: z.boolean().default(false),
    rule: ruleSchema,
    missed: z.enum(["skip", "latest"]),
    enabled: z.boolean(),
  })
  .strict();
export type JobInput = z.infer<typeof jobInputSchema>;
export const jobSchema = jobInputSchema.extend({
  id: z.uuid(),
  revision: z.number().int().positive(),
  cursor: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  error: z.string().nullable(),
});
export type Job = z.infer<typeof jobSchema>;
export const occurrenceSchema = z.object({
  scheduledAt: z.iso.datetime(),
  nominalDate: dateSchema,
  effectiveDate: dateSchema,
  localTime: z.string(),
  reason: z.string(),
  halfDay: z.boolean(),
  calendarVersion: z.string(),
});
export type Occurrence = z.infer<typeof occurrenceSchema>;
export const previewSchema = z.object({
  occurrences: z.array(occurrenceSchema),
  notice: z.string().nullable(),
});
export type Preview = z.infer<typeof previewSchema>;
export const runSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  jobName: z.string(),
  jobRevision: z.number().int(),
  scheduledAt: z.iso.datetime(),
  calendarVersion: z.string(),
  status: z.enum(["dispatching", "submitted", "finished", "failed", "uncertain", "skipped"]),
  agentId: z.string().nullable(),
  message: z.string(),
  updatedAt: z.iso.datetime(),
  autoArchive: z.boolean().default(false),
  archivedAt: z.iso.datetime().nullable().default(null),
  archiveError: z.string().nullable().default(null),
});
export type Run = z.infer<typeof runSchema>;
export const stateSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    jobs: z.array(jobSchema),
    calendars: z.array(calendarSchema),
    runs: z.array(runSchema),
  })
  .strict();
export type State = z.infer<typeof stateSchema>;
