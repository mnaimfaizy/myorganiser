/** Shared by the admin list stubs: Users, Audit log and Feedback inbox. */

/** A three-digit, zero-padded fixture number: 7 is "007". */
export function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

/** A query param as a whole number from 1, or `fallback` when it is missing or not one. */
export function positiveInt(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
