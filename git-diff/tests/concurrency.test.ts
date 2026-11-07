import { expect, it } from "vitest";
import { mapLimit, TaskPool } from "../server/concurrency";

it("keeps the process budget across queued successes and failures without losing a slot", async () => {
  const pool = new TaskPool(3);
  let active = 0;
  let peak = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 30 }, (_, index) =>
      pool.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active--;
        if (index % 7 === 0) throw new Error("fixture failure");
        return index;
      }),
    ),
  );
  expect(peak).toBe(3);
  expect(active).toBe(0);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(25);
  expect(await pool.run(async () => "available")).toBe("available");
});

it("preserves input order while concurrently reading file metadata", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapLimit(
    Array.from({ length: 100 }, (_, i) => i),
    12,
    async (index) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      return index * 2;
    },
  );
  expect(peak).toBe(12);
  expect(results).toEqual(Array.from({ length: 100 }, (_, i) => i * 2));
});
