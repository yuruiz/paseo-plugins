import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { calendarSchema, jobInputSchema, previewSchema, ruleSchema, stateSchema } from "./model";

const empty = z.object({});
export const statusRpc = defineRpc({
  name: "scheduler.status",
  input: empty,
  output: z.object({
    state: stateSchema.nullable(),
    calendars: z.array(calendarSchema),
    error: z.string().nullable(),
    executing: z.boolean(),
  }),
});
export const previewRpc = defineRpc({
  name: "scheduler.preview",
  input: z.object({
    rule: ruleSchema,
    after: z.iso.datetime().optional(),
    count: z.number().int().min(1).max(12).default(5),
  }),
  output: previewSchema,
});
export const saveRpc = defineRpc({
  name: "scheduler.save",
  input: z.object({ job: jobInputSchema, id: z.uuid().nullable(), revision: z.number().int() }),
  output: empty,
});
export const removeRpc = defineRpc({
  name: "scheduler.remove",
  input: z.object({ id: z.uuid(), revision: z.number().int() }),
  output: empty,
});
export const runRpc = defineRpc({
  name: "scheduler.run",
  input: z.object({ id: z.uuid() }),
  output: empty,
});
export const resolveRpc = defineRpc({
  name: "scheduler.resolve",
  input: z.object({ id: z.uuid(), revision: z.number().int() }),
  output: empty,
});
export const importRpc = defineRpc({
  name: "scheduler.calendar.import",
  input: z.object({ calendar: calendarSchema, revision: z.number().int() }),
  output: empty,
});
