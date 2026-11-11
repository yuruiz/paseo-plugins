import { expect, it } from "vitest";
import { moveReviewBoundary } from "../client/review-range-model";

it("allows either boundary to include or exclude Working Changes", () => {
  const extended = moveReviewBoundary({ top: 0, bottom: 0 }, "bottom", 3, 20);
  expect(extended).toEqual({ top: 0, bottom: 3 });
  expect(moveReviewBoundary(extended, "top", 1, 20)).toEqual({ top: 1, bottom: 3 });
  expect(moveReviewBoundary({ top: 1, bottom: 3 }, "top", 0, 20)).toEqual(extended);
});
it("clamps to loaded history and prevents boundaries from crossing", () => {
  expect(moveReviewBoundary({ top: 2, bottom: 5 }, "top", 8, 10)).toEqual({ top: 5, bottom: 5 });
  expect(moveReviewBoundary({ top: 2, bottom: 5 }, "bottom", 0, 10)).toEqual({ top: 2, bottom: 2 });
  expect(moveReviewBoundary({ top: 0, bottom: 5 }, "bottom", 30, 10)).toEqual({
    top: 0,
    bottom: 10,
  });
  expect(moveReviewBoundary({ top: 2, bottom: 5 }, "top", -10, 10)).toEqual({ top: 0, bottom: 5 });
});
