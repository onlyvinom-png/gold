/** Timezone helpers. All timestamps are stored/exchanged in UTC (ISO-8601). */

export function toIso(d: Date | string): string {
  return new Date(d).toISOString();
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** minutes since local midnight */
  minutesOfDay: number;
  /** YYYY-MM-DD in local timezone */
  dateKey: string;
  weekday: number; // 0 = Sunday
}

/** Get the wall-clock parts of a UTC instant in an arbitrary IANA timezone. */
export function getLocalParts(utc: Date | string, timezone: string): LocalParts {
  const d = typeof utc === 'string' ? new Date(utc) : utc;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const weekdays: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    minutesOfDay: hour * 60 + minute,
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    weekday: weekdays[parts.weekday] ?? 0,
  };
}

/** "HH:MM" -> minutes since midnight */
export function parseHhMm(value: string): number {
  const [h, m] = value.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

/** Offset (ms) between two timezones at a given instant. */
export function timezoneOffsetMs(instant: Date, timezone: string): number {
  const asUtc = Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate(),
    instant.getUTCHours(),
    instant.getUTCMinutes(),
    instant.getUTCSeconds(),
  );
  const local = getLocalParts(instant, timezone);
  const asLocalUtc = Date.UTC(
    local.year, local.month - 1, local.day, local.hour, local.minute, local.second,
  );
  return asLocalUtc - asUtc;
}

/** Convert a local wall-clock time in `timezone` to a UTC Date. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
  timezone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0) + minutesOfDay * 60_000;
  // two-pass correction for DST offsets
  let guess = new Date(naive - timezoneOffsetMs(new Date(naive), timezone));
  guess = new Date(naive - timezoneOffsetMs(guess, timezone));
  return guess;
}
