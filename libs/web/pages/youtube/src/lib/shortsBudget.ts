/**
 * Shorts Daily Budget ledger — the browser-local store behind Shorts Hard Stop.
 *
 * Promoted from the locked timed Shorts prototype (`feed-first/useShortsTimer.ts`,
 * decisions #245 / #251): the decision-rich shape is `spentMs` / `limitMs` /
 * `locked` keyed by a day. Two deliberate changes from the prototype:
 *
 * 1. The day key is **local** midnight, not `toISOString().slice(0, 10)` (UTC).
 *    A User east or west of UTC would otherwise see the budget reset in the
 *    middle of their afternoon or keep yesterday's spend after their midnight.
 * 2. There is no reset escape hatch. The prototype shipped a dev-only "reset
 *    today" button; Hard Stop is only meaningful if nothing inside the app can
 *    lift it, so lifting is left to the local-midnight rollover alone.
 *
 * The ledger is browser-local for v1 (PRD #264, "Out of Scope": no server-synced
 * budget). One ledger per browser profile — every tab in the profile shares this
 * key, so a Short metered in one tab is spent in all of them.
 */

import { localDateKey } from '@myorganiser/core';

/** Namespaced per the repo's localStorage convention; `v1` allows a reshape later. */
export const SHORTS_BUDGET_STORAGE_KEY = 'myorganiser.youtube.shorts-budget.v1';

/** Default Shorts Daily Budget: one hour (PRD #264, user story 15). */
export const DEFAULT_SHORTS_LIMIT_MS = 60 * 60 * 1000;

/** Floor on the configurable limit — a sub-minute budget is a disguised block. */
export const MIN_SHORTS_LIMIT_MS = 60 * 1000;

/** Ceiling on the configurable limit — three hours, past which the cap is theatre. */
export const MAX_SHORTS_LIMIT_MS = 3 * 60 * 60 * 1000;

/** {@link MIN_SHORTS_LIMIT_MS} in minutes, for the limit input's bounds. */
export const MIN_SHORTS_LIMIT_MINUTES = MIN_SHORTS_LIMIT_MS / 60_000;

/** {@link MAX_SHORTS_LIMIT_MS} in minutes, for the limit input's bounds. */
export const MAX_SHORTS_LIMIT_MINUTES = MAX_SHORTS_LIMIT_MS / 60_000;

/**
 * Today's spend against today's limit. `dayKey` is the local calendar day the
 * spend belongs to; a ledger read on a later day is rolled over, never trusted.
 */
export interface ShortsBudgetLedger {
  /** Local calendar day as `YYYY-MM-DD`, from {@link localDayKey}. */
  dayKey: string;
  /** Metered wall-clock milliseconds spent on Shorts today, capped at `limitMs`. */
  spentMs: number;
  /** The configured Shorts Daily Budget in milliseconds. */
  limitMs: number;
}

/**
 * The local calendar day, as `YYYY-MM-DD` in the User's own timezone.
 *
 * Deliberately not `toISOString()` — that yields the UTC day and would move the
 * reset boundary off local midnight for anyone not on UTC.
 */
export function localDayKey(now: Date = new Date()): string {
  return localDateKey(now);
}

function clampLimit(limitMs: number): number {
  if (!Number.isFinite(limitMs)) return DEFAULT_SHORTS_LIMIT_MS;
  return Math.min(MAX_SHORTS_LIMIT_MS, Math.max(MIN_SHORTS_LIMIT_MS, limitMs));
}

export function defaultShortsBudget(
  now: Date = new Date(),
): ShortsBudgetLedger {
  return {
    dayKey: localDayKey(now),
    spentMs: 0,
    limitMs: DEFAULT_SHORTS_LIMIT_MS,
  };
}

/**
 * Coerces anything read out of storage into a usable ledger for `now`.
 *
 * A ledger from an earlier local day rolls over: spend resets to zero while the
 * configured limit survives, so a limit set yesterday still governs today. A
 * malformed or hostile value falls back to a fresh default rather than throwing
 * — a corrupt ledger must not be able to brick the Shorts page.
 */
export function normalizeShortsBudget(
  raw: unknown,
  now: Date = new Date(),
): ShortsBudgetLedger {
  const dayKey = localDayKey(now);

  if (typeof raw !== 'object' || raw === null) {
    return defaultShortsBudget(now);
  }

  const record = raw as Record<string, unknown>;
  const limitMs = clampLimit(
    typeof record.limitMs === 'number' ? record.limitMs : Number.NaN,
  );

  if (record.dayKey !== dayKey) {
    return { dayKey, spentMs: 0, limitMs };
  }

  const spentMs =
    typeof record.spentMs === 'number' && Number.isFinite(record.spentMs)
      ? Math.max(0, record.spentMs)
      : 0;

  return { dayKey, spentMs, limitMs };
}

/** True once today's spend has reached the limit — the Shorts Hard Stop condition. */
export function isShortsLocked(ledger: ShortsBudgetLedger): boolean {
  return ledger.spentMs >= ledger.limitMs;
}

/** Milliseconds of Shorts Daily Budget left today, floored at zero. */
export function remainingShortsMs(ledger: ShortsBudgetLedger): number {
  return Math.max(0, ledger.limitMs - ledger.spentMs);
}

/**
 * Applies a new limit to the ledger immediately (PRD #264, user story 18).
 *
 * Lowering the limit below what is already spent locks Shorts on the spot;
 * raising it hands the difference back today. Neither case touches `spentMs`,
 * so a raise can never be used to launder time already spent.
 */
export function withShortsLimit(
  ledger: ShortsBudgetLedger,
  limitMs: number,
): ShortsBudgetLedger {
  return { ...ledger, limitMs: clampLimit(limitMs) };
}

/**
 * Adds metered wall-clock time, never past the limit. Callers meter only while
 * a Short is actually playing on a visible page, so `elapsedMs` is real
 * viewing time rather than time the tab spent in the background.
 */
export function withShortsSpend(
  ledger: ShortsBudgetLedger,
  elapsedMs: number,
): ShortsBudgetLedger {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return ledger;
  return {
    ...ledger,
    spentMs: Math.min(ledger.limitMs, ledger.spentMs + elapsedMs),
  };
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

/**
 * Reads the shared ledger for this browser profile, rolled over to `now`.
 * Returns a fresh default on the server, on absent storage, or on any read or
 * parse failure (private-mode storage throws on access in some browsers).
 */
export function readShortsBudget(now: Date = new Date()): ShortsBudgetLedger {
  if (!hasStorage()) return defaultShortsBudget(now);
  try {
    const raw = window.localStorage.getItem(SHORTS_BUDGET_STORAGE_KEY);
    if (!raw) return defaultShortsBudget(now);
    return normalizeShortsBudget(JSON.parse(raw), now);
  } catch {
    return defaultShortsBudget(now);
  }
}

/**
 * Persists the ledger. Write failures are swallowed: a full or blocked quota
 * degrades the budget to session-only rather than breaking playback, and the
 * in-memory ledger still enforces Hard Stop for the current session.
 */
export function writeShortsBudget(ledger: ShortsBudgetLedger): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      SHORTS_BUDGET_STORAGE_KEY,
      JSON.stringify(ledger),
    );
  } catch {
    // Storage unavailable — keep metering in memory for this session.
  }
}

/**
 * Human-readable duration for the meter: `H:MM:SS` past an hour, `M:SS` below.
 * Rounds up so a partial second still reads as remaining time rather than zero.
 */
export function formatShortsDuration(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
