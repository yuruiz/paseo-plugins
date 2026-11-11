export type ReviewBounds = { top: number; bottom: number };
export type ReviewBoundary = keyof ReviewBounds;

// Position zero is Working Changes; commits start at position one.
export function moveReviewBoundary(
  bounds: ReviewBounds,
  boundary: ReviewBoundary,
  position: number,
  last: number,
): ReviewBounds {
  const value = Math.max(0, Math.min(last, Math.round(position)));
  return boundary === "top"
    ? { top: Math.min(value, bounds.bottom), bottom: bounds.bottom }
    : { top: bounds.top, bottom: Math.max(value, bounds.top) };
}
