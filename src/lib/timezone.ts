/**
 * Cooperative timezone and localization helpers.
 *
 * Timestamps are always stored in UTC. Billing/generation periods are defined
 * by local calendar boundaries in the cooperative's IANA timezone, then
 * converted back to UTC instants for storage and aggregation.
 */

export const DEFAULT_COOPERATIVE_TIMEZONE = "UTC";

/**
 * Validate an IANA timezone identifier using the runtime's Intl support.
 * Returns the canonical identifier when valid, otherwise null.
 */
export function validateIanaTimezone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", {
      timeZone: trimmed,
    }).resolvedOptions().timeZone;
    return resolved || null;
  } catch {
    return null;
  }
}

/**
 * Normalize a timezone input, falling back to the safe default when invalid.
 */
export function normalizeTimezone(value: unknown): string {
  return validateIanaTimezone(value) ?? DEFAULT_COOPERATIVE_TIMEZONE;
}

/**
 * Offset in minutes of `timeZone` relative to UTC at the given instant.
 * Positive values are east of UTC. Accounts for daylight-saving transitions
 * because the offset is computed for the specific instant.
 */
export function getTimezoneOffsetMinutes(
  instant: Date,
  timeZone: string,
): number {
  const tz = normalizeTimezone(timeZone);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * Local calendar date (year, month 1-12, day) for an instant in a timezone.
 */
export function getLocalDateParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const tz = normalizeTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Convert a local wall-clock time in `timeZone` to the corresponding UTC
 * instant. Handles DST by resolving the offset at the candidate instant and
 * correcting once for the transition.
 */
export function localToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const tz = normalizeTimezone(timeZone);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstOffset = getTimezoneOffsetMinutes(new Date(naive), tz);
  let candidate = new Date(naive - firstOffset * 60000);
  const secondOffset = getTimezoneOffsetMinutes(candidate, tz);
  if (secondOffset !== firstOffset) {
    candidate = new Date(naive - secondOffset * 60000);
  }
  return candidate;
}

/**
 * UTC instant for the start of the local calendar month containing `instant`.
 */
export function startOfLocalMonth(instant: Date, timeZone: string): Date {
  const { year, month } = getLocalDateParts(instant, timeZone);
  return localToUtc(year, month, 1, 0, 0, timeZone);
}

/**
 * UTC instant for the start of the next local calendar month.
 */
export function startOfNextLocalMonth(instant: Date, timeZone: string): Date {
  const { year, month } = getLocalDateParts(instant, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return localToUtc(nextYear, nextMonth, 1, 0, 0, timeZone);
}

/**
 * Billing/generation period for an instant: [start, end) in UTC, aligned to
 * the cooperative's local calendar month boundaries.
 */
export function getBillingPeriod(
  instant: Date,
  timeZone: string,
): { start: Date; end: Date; timeZone: string } {
  const tz = normalizeTimezone(timeZone);
  return {
    start: startOfLocalMonth(instant, tz),
    end: startOfNextLocalMonth(instant, tz),
    timeZone: tz,
  };
}

/**
 * Human-readable label for a billing period, rendered in the cooperative's
 * timezone so frontend labels match API aggregation semantics.
 */
export function formatBillingPeriodLabel(
  period: { start: Date; end: Date; timeZone: string },
  locale = "en-US",
): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone: period.timeZone,
    year: "numeric",
    month: "long",
  });
  return fmt.format(period.start);
}
