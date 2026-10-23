'use client';

import { Button, Input, Label } from '@myorganiser/web-ui';
import { useCallback, useState } from 'react';
import { MAX_SHORTS_LIMIT_MINUTES, MIN_SHORTS_LIMIT_MINUTES } from '../hooks';

interface ShortsBudgetMeterProps {
  spentMs: number;
  limitMs: number;
  remainingMs: number;
  usedPercent: number;
  locked: boolean;
  metering: boolean;
  onLimitMinutesChange: (minutes: number) => void;
  /**
   * The phone stage draws its own progress bar, so the page passes `false`
   * there to keep one progressbar role on screen. Defaults to `true`.
   */
  showProgressBar?: boolean;
}

/**
 * One stepper press moves the daily limit by this many minutes. The stepper's
 * aria-labels ("Five minutes less" / "Five minutes more") are literal text and
 * must change with this constant.
 */
const LIMIT_STEP_MINUTES = 5;

/**
 * Renders the Shorts Daily Budget meter with progress visualization and a
 * daily limit control: a −/+ stepper around the numeric minutes input.
 *
 * The progress bar shows time used vs. the limit without relying on color alone.
 * Remaining time is in a polite live region so assistive tech hears meaningful
 * changes without being spammed. Announcements key off whole remaining minutes
 * and the locked transition, not every second tick.
 *
 * The limit input immediately fires onChange for any valid number and ignores
 * empty or non-numeric entries — never sends NaN. The stepper moves the limit
 * in fixed steps, clamped to the minimum and maximum, and writes the new value
 * into the same input.
 */
export function ShortsBudgetMeter({
  spentMs,
  limitMs,
  remainingMs,
  usedPercent,
  locked,
  metering,
  onLimitMinutesChange,
  showProgressBar = true,
}: ShortsBudgetMeterProps) {
  const [inputValue, setInputValue] = useState<string>(() =>
    String(Math.round(limitMs / 60_000)),
  );
  const [syncedLimitMs, setSyncedLimitMs] = useState(limitMs);

  // Adjust state during render when the committed limit changes (e.g., via another tab).
  if (syncedLimitMs !== limitMs) {
    setSyncedLimitMs(limitMs);
    setInputValue(String(Math.round(limitMs / 60_000)));
  }

  // Whole minutes for the visible budget line. Spent rounds down and remaining
  // rounds up, so the two always add up to the limit.
  const spentMin = Math.floor(spentMs / 60_000);
  const limitMin = Math.round(limitMs / 60_000);
  // Coarsened to whole minutes so the polite region announces on a meaningful
  // step rather than on every one-second metering tick.
  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  const announcement = locked
    ? 'Shorts Daily Budget spent for today. Shorts stay locked until local midnight.'
    : `${remainingMinutes} ${
        remainingMinutes === 1 ? 'minute' : 'minutes'
      } of Shorts Daily Budget remaining today.`;

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInputValue(value);

      // Only fire onChange for a valid integer within bounds; ignore empty or NaN.
      const parsed = parseInt(value, 10);
      if (Number.isFinite(parsed) && value.trim() !== '') {
        if (
          parsed >= MIN_SHORTS_LIMIT_MINUTES &&
          parsed <= MAX_SHORTS_LIMIT_MINUTES
        ) {
          onLimitMinutesChange(parsed);
        }
      }
    },
    [onLimitMinutesChange],
  );

  // The stepper starts from what the input shows. If the input holds nothing
  // usable, it starts from the committed limit instead.
  const stepLimit = useCallback(
    (delta: number) => {
      const typed = parseInt(inputValue, 10);
      const current =
        inputValue.trim() !== '' && Number.isFinite(typed)
          ? typed
          : Math.round(limitMs / 60_000);
      const next = Math.min(
        MAX_SHORTS_LIMIT_MINUTES,
        Math.max(MIN_SHORTS_LIMIT_MINUTES, current + delta),
      );
      setInputValue(String(next));
      if (next !== current) {
        onLimitMinutesChange(next);
      }
    },
    [inputValue, limitMs, onLimitMinutesChange],
  );

  const handleLessMinutes = useCallback(() => {
    stepLimit(-LIMIT_STEP_MINUTES);
  }, [stepLimit]);

  const handleMoreMinutes = useCallback(() => {
    stepLimit(LIMIT_STEP_MINUTES);
  }, [stepLimit]);

  return (
    <section
      aria-label="Shorts daily budget"
      className="flex flex-col gap-4 rounded-panel border border-border bg-card p-4 px-5 md:flex-row md:items-center md:gap-5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/*
          The visible countdown ticks every second, so it must not be the
          live region — a screen reader would read it aloud once a second.
          The announcement below carries the same state at whole-minute
          granularity, so its text only changes on a coarse step.
        */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-body-sm">
          <span className="text-foreground-secondary">
            <span className="font-semibold tabular-nums text-foreground">
              {spentMin} of {limitMin} min
            </span>{' '}
            used today
          </span>
          <span className="flex items-baseline gap-2">
            <span className="font-semibold text-warning-text">
              {remainingMinutes} min left
            </span>
            {metering && (
              <span className="text-caption text-muted-foreground">
                (metering…)
              </span>
            )}
          </span>
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>

        {/* Progress bar: shows usage with text label, not color alone */}
        {showProgressBar && (
          <div
            role="progressbar"
            aria-valuenow={usedPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${usedPercent}% of daily Shorts budget used`}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              // Reduced motion is honoured in CSS rather than sniffed in JS —
              // the variant tracks the OS preference live, with no effect,
              // no state, and nothing to go stale.
              className="h-full rounded-full bg-warning transition-all duration-300 motion-reduce:transition-none"
              style={{ width: `${Math.min(usedPercent, 100)}%` }}
            />
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-caption text-muted-foreground">
          <span>Resets at midnight. Long videos have no limit.</span>
          <span>{usedPercent}% used</span>
        </div>
      </div>

      {/* Daily limit: a stepper around the numeric input */}
      <div className="flex flex-col gap-2 md:items-end">
        <Label
          htmlFor="shorts-limit-minutes"
          className="text-body-sm font-semibold text-foreground"
        >
          Daily limit
        </Label>
        <div className="flex items-center overflow-hidden rounded-control border border-border-strong bg-card">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Five minutes less"
            onClick={handleLessMinutes}
          >
            <span aria-hidden="true" className="text-body font-semibold">
              −
            </span>
          </Button>
          <Input
            id="shorts-limit-minutes"
            type="number"
            inputMode="numeric"
            min={MIN_SHORTS_LIMIT_MINUTES}
            max={MAX_SHORTS_LIMIT_MINUTES}
            value={inputValue}
            onChange={handleInputChange}
            aria-label="Daily limit (minutes)"
            className="h-11 w-16 border-0 bg-transparent px-0 text-center font-semibold tabular-nums shadow-none md:h-11"
            // Deliberately editable while locked: raising the limit is the one
            // sanctioned way to get time back today (PRD #264 user story 18), and
            // the banner below says so. Disabling it here would make that promise
            // unactionable. It is not a Hard Stop bypass — the escape the Hard
            // Stop blocks is leaving for YouTube, not the User's own daily cap.
          />
          <span
            aria-hidden="true"
            className="pr-1 text-caption text-muted-foreground"
          >
            min
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Five minutes more"
            onClick={handleMoreMinutes}
          >
            <span aria-hidden="true" className="text-body font-semibold">
              +
            </span>
          </Button>
        </div>
        <p className="text-caption text-muted-foreground">
          Min: {MIN_SHORTS_LIMIT_MINUTES} min • Max: {MAX_SHORTS_LIMIT_MINUTES}{' '}
          min
        </p>
      </div>

      {/* Locked state banner with live announcement */}
      {locked && (
        <div
          className="rounded-control-sm bg-warning-soft p-2 text-caption text-warning-text md:basis-full"
          role="status"
          aria-live="polite"
        >
          Today's Shorts budget is exhausted. Raising the daily limit gives time
          back today.
        </div>
      )}
    </section>
  );
}
