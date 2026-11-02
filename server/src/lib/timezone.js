// Small timezone helpers built on Intl so we avoid a date library dependency.

const formatterCache = new Map();

function formatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
      }),
    );
  }
  return formatterCache.get(timeZone);
}

/** Wall-clock parts of `date` in `timeZone`. weekday: 0 = Sunday. */
export function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
  };
}

/** The UTC instant at which the wall clock in `timeZone` reads the given time. */
export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = zonedParts(new Date(guess), timeZone);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
  return new Date(guess - offset);
}

/** "YYYY-MM-DD" of `date` in `timeZone`. */
export function zonedDateString(date, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Add whole days to a "YYYY-MM-DD" calendar date. */
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
