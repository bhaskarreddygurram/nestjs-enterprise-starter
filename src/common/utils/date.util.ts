/** `YYYY-MM-DD` — a calendar date with no time or zone. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Parses `YYYY-MM-DD` as midnight UTC, the form a `DATE` column round-trips. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Formats a date-only value as `YYYY-MM-DD`. */
export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
