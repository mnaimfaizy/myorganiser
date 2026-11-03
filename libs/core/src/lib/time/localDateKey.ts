/**
 * A local calendar date as `YYYY-MM-DD` — the shape a Task's `dueDate`
 * takes, and the key every day-bucketing helper across the page libraries
 * groups by. Reads the date's local calendar parts (`getFullYear`,
 * `getMonth`, `getDate`), never its UTC ones, so a time near local midnight
 * keys to the day it visually falls on rather than its UTC day.
 */
export function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
