"use client";

import { useMemo } from "react";

/**
 * Shared period semantics for cooperative billing/generation periods.
 *
 * Timestamps are always stored and transported in UTC. A period is defined by
 * local calendar boundaries in the cooperative's IANA timezone, then converted
 * back to UTC instants for aggregation. This component renders the same
 * boundaries the API uses so labels and aggregation never disagree.
 */

export type PeriodGranularity = "month" | "day";

export interface PeriodBoundary {
  /** Inclusive UTC start instant. */
  startUtc: Date;
  /** Exclusive UTC end instant. */
  endUtc: Date;
  /** Local calendar year of the period start. */
  year: number;
  /** Local calendar month (1-12) of the period start. */
  month: number;
  /** Local calendar day of month of the period start. */
  day: number;
}

const DEFAULT_TIMEZONE = "UTC";

/**
 * Resolve the UTC offset (in minutes) of an IANA timezone at a given instant.
 * Uses Intl so daylight-saving transitions are handled by the platform tz db.
 */
export function getTimezoneOffsetMinutes(timeZone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(at);
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
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * Convert a local wall-clock time in `timeZone` to the corresponding UTC instant.
 * Handles DST by resolving the offset at the candidate instant and re-checking.
 */
export function localToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstOffset = getTimezoneOffsetMinutes(timeZone, new Date(naive));
  let candidate = new Date(naive - firstOffset * 60000);
  const secondOffset = getTimezoneOffsetMinutes(timeZone, candidate);
  if (secondOffset !== firstOffset) {
    candidate = new Date(naive - secondOffset * 60000);
  }
  return candidate;
}

/**
 * Compute the local calendar period containing `reference` for the given
 * timezone and granularity. Boundaries are returned as UTC instants.
 */
export function getPeriodBoundary(
  timeZone: string,
  reference: Date,
  granularity: PeriodGranularity = "month",
): PeriodBoundary {
  const tz = timeZone || DEFAULT_TIMEZONE;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(reference);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const year = get("year");
  const month = get("month");
  const day = get("day");

  if (granularity === "day") {
    const startUtc = localToUtc(tz, year, month, day);
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    const endUtc = localToUtc(
      tz,
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
    );
    return { startUtc, endUtc, year, month, day };
  }

  const startUtc = localToUtc(tz, year, month, 1);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const endUtc = localToUtc(
    tz,
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    1,
  );
  return { startUtc, endUtc, year, month, day: 1 };
}

/**
 * Format a period label in the cooperative's timezone. Uses the same local
 * calendar boundaries as the API aggregation so labels match grouped data.
 */
export function formatPeriodLabel(
  timeZone: string,
  reference: Date,
  granularity: PeriodGranularity = "month",
  locale = "en-US",
): string {
  const tz = timeZone || DEFAULT_TIMEZONE;
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    year: "numeric",
    month: "long",
    ...(granularity === "day" ? { day: "numeric" } : {}),
  }).format(reference);
}

export interface PeriodLabelProps {
  /** IANA timezone of the cooperative (e.g. "Europe/Berlin"). */
  timeZone: string;
  /** UTC instant within the period to label. */
  reference: Date | string;
  granularity?: PeriodGranularity;
  locale?: string;
  className?: string;
}

/**
 * Renders a period label using the cooperative's timezone and the shared
 * period semantics used by API aggregation.
 */
export default function PeriodLabel({
  timeZone,
  reference,
  granularity = "month",
  locale = "en-US",
  className,
}: PeriodLabelProps) {
  const date = useMemo(
    () => (reference instanceof Date ? reference : new Date(reference)),
    [reference],
  );

  const label = useMemo(() => {
    if (Number.isNaN(date.getTime())) return "";
    return formatPeriodLabel(timeZone, date, granularity, locale);
  }, [timeZone, date, granularity, locale]);

  return (
    <time
      className={className}
      dateTime={date.toISOString()}
      title={`${timeZone || DEFAULT_TIMEZONE} (UTC stored)`}
    >
      {label}
    </time>
  );
}
