'use client';

import {
  Button,
  Illustration,
  Label,
  ListGroup,
  ListGroupHeaderTitle,
  ListGroupRow,
  ListGroupRowTitle,
  ListGroupRowTrailing,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@myorganiser/web-ui';
import { useCallback, useId } from 'react';

import type { AccountVariant } from '../account-view';

const WEEKDAYS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const DIGEST_HELP =
  'Digest lists only Cached Uploads that are still New — Watched uploads are left out. Weeks with nothing new are skipped entirely.';

interface YouTubeDigestSectionProps {
  variant: AccountVariant;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  weekday: number;
  onWeekdayChange: (weekday: number) => void;
  saving: boolean;
  onSave: () => void;
  timeZone: string;
}

export function YouTubeDigestSection({
  variant,
  enabled,
  onEnabledChange,
  weekday,
  onWeekdayChange,
  saving,
  onSave,
  timeZone,
}: YouTubeDigestSectionProps) {
  const headingId = useId();
  const switchLabelId = useId();
  const daySelectId = useId();
  const dayLabelId = useId();

  const handleWeekdayChange = useCallback(
    (value: string) => {
      onWeekdayChange(parseInt(value, 10));
    },
    [onWeekdayChange],
  );

  const saveLabel = saving ? 'Saving…' : 'Save digest settings';

  if (variant === 'phone') {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <ListGroupHeaderTitle id={headingId} className="mt-1.5 px-1">
          Weekly YouTube digest
        </ListGroupHeaderTitle>
        <ListGroup>
          <ListGroupRow size="value" className="min-h-13 justify-between">
            <ListGroupRowTitle id={switchLabelId}>
              Email me a weekly digest
            </ListGroupRowTitle>
            <ListGroupRowTrailing>
              <Switch
                aria-labelledby={switchLabelId}
                checked={enabled}
                onCheckedChange={onEnabledChange}
              />
            </ListGroupRowTrailing>
          </ListGroupRow>
          <ListGroupRow size="value" className="min-h-13 justify-between">
            <ListGroupRowTitle id={dayLabelId} className="min-w-0 flex-1">
              Send on
            </ListGroupRowTitle>
            <ListGroupRowTrailing>
              <Select
                value={String(weekday)}
                onValueChange={handleWeekdayChange}
                disabled={!enabled}
              >
                <SelectTrigger
                  aria-labelledby={dayLabelId}
                  className="h-auto w-auto shrink-0 border-transparent bg-transparent px-0 text-body text-muted-foreground [&>span]:overflow-visible [&>span]:whitespace-normal"
                >
                  <SelectValue placeholder="Select day" />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((day) => (
                    <SelectItem key={day.value} value={day.value}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ListGroupRowTrailing>
          </ListGroupRow>
        </ListGroup>
        <p className="px-1 text-caption text-muted-foreground">
          {`${DIGEST_HELP} Sent on your chosen day, in your time zone (${timeZone}).`}
        </p>
        <Button
          variant="outline"
          className="w-full"
          onClick={onSave}
          disabled={saving}
        >
          {saveLabel}
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-panel border border-border bg-raised-surface"
    >
      <header className="flex items-center gap-2.5 px-6 pt-5">
        <Illustration kind="youtube" size={32} />
        <h2 id={headingId} className="font-display text-title font-bold">
          Weekly YouTube digest
        </h2>
      </header>
      <div className="flex flex-col gap-1.5 border-b border-border-subtle px-6 pt-3.5 pb-4">
        <div className="flex items-center gap-4">
          <span id={switchLabelId} className="flex-1 text-body font-semibold">
            Email me a weekly digest
          </span>
          <Switch
            aria-labelledby={switchLabelId}
            checked={enabled}
            onCheckedChange={onEnabledChange}
          />
        </div>
        <p className="text-body-sm text-muted-foreground">{DIGEST_HELP}</p>
      </div>
      <div className="flex flex-wrap items-end gap-4 px-6 pt-4 pb-5">
        <div className="flex flex-1 basis-[260px] flex-col gap-1.5">
          <Label htmlFor={daySelectId}>Send on</Label>
          <Select
            value={String(weekday)}
            onValueChange={handleWeekdayChange}
            disabled={!enabled}
          >
            <SelectTrigger id={daySelectId} className="h-11 max-w-60">
              <SelectValue placeholder="Select day" />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((day) => (
                <SelectItem key={day.value} value={day.value}>
                  {day.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-body-sm text-muted-foreground">
            Sent on your chosen day, in your time zone ({timeZone}).
          </p>
        </div>
        <Button variant="outline" onClick={onSave} disabled={saving}>
          {saveLabel}
        </Button>
      </div>
    </section>
  );
}
