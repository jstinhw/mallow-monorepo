// Shared text helpers for Guardian tools.

/** Trim `s` to at most `max` chars, replacing the tail with an ellipsis. */
export function truncate(s: string, max = 80): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
