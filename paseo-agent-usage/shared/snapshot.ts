import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const bucket = z.object({
  r: z.number(), i: z.number(), o: z.number(), cr: z.number(), cw: z.number(),
  rz: z.number(), cost: z.number(), credits: z.number(),
});
const session = bucket.extend({ s: z.number(), e: z.number(), p: z.string() });
const call = bucket.omit({ r: true }).extend({
  t: z.number(), m: z.string(), p: z.string(), s: z.string(),
});

/** Contains usage metadata only, never scanner paths, credentials or session titles. */
export const usageSnapshotSchema = z.object({
  version: z.literal(1),
  sourceId: z.string().uuid(),
  label: z.string().max(255),
  generatedAt: z.number(),
  lastScanAt: z.number().nullable(),
  scanning: z.boolean(),
  scanDone: z.number(),
  scanTotal: z.number(),
  scanError: z.string().nullable(),
  // Keys start with an ISO UTC instant, followed by agent/model/project.
  buckets: z.record(z.string(), bucket),
  sessions: z.record(z.string(), session),
  recent: z.record(z.string(), z.array(call).max(400)),
});
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;

export const usageSnapshotRpc = defineRpc({
  name: "usage.snapshot",
  input: z.object({}),
  output: usageSnapshotSchema,
});
