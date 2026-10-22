'use client';

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@myorganiser/web-ui';
import { type ChangeEvent, useCallback } from 'react';

import {
  FEEDBACK_REPORT_KINDS,
  FEEDBACK_REPORT_STATUSES,
  formatFeedbackReportKind,
  formatFeedbackReportStatus,
} from '../../../lib/formatFeedbackReport';
import {
  FEEDBACK_REPORT_PLATFORMS,
  formatFeedbackReportPlatform,
  type FeedbackInboxFilters as FeedbackFilterValues,
} from '../../../lib/feedbackInbox';

/** Radix Select rejects an empty value, so the "all" options use these. */
const ALL_STATUSES_VALUE = 'all';
const ALL_KINDS_VALUE = 'all';
const ANY_PLATFORM_VALUE = 'any';

export interface FeedbackInboxFiltersProps {
  filters: FeedbackFilterValues;
  /** Merges the given filters in. The hook resets paging. */
  onChange: (next: Partial<FeedbackFilterValues>) => void;
  onClear: () => void;
}

/**
 * The desktop filter toolbar: Status, Kind, Platform and Tracking issue, then
 * Clear filters. The filters apply as they change; there is no submit.
 */
export function FeedbackInboxFilters({
  filters,
  onChange,
  onClear,
}: FeedbackInboxFiltersProps) {
  const handleStatusChange = useCallback(
    (value: string) => {
      onChange({
        status: FEEDBACK_REPORT_STATUSES.find((status) => status === value),
      });
    },
    [onChange],
  );

  const handleKindChange = useCallback(
    (value: string) => {
      onChange({
        kind: FEEDBACK_REPORT_KINDS.find((kind) => kind === value),
      });
    },
    [onChange],
  );

  const handlePlatformChange = useCallback(
    (value: string) => {
      onChange({
        platform: FEEDBACK_REPORT_PLATFORMS.find(
          (platform) => platform === value,
        ),
      });
    },
    [onChange],
  );

  const handleTrackingIssueChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange({ trackingIssue: event.target.value });
    },
    [onChange],
  );

  return (
    <div
      role="toolbar"
      aria-label="Filter feedback reports"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-raised-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <Label
          htmlFor="status-filter"
          className="text-body-sm font-semibold text-muted-foreground"
        >
          Status
        </Label>
        <Select
          value={filters.status ?? ALL_STATUSES_VALUE}
          onValueChange={handleStatusChange}
        >
          <SelectTrigger
            id="status-filter"
            className={cn(
              'h-10 min-w-[170px]',
              filters.status !== undefined && 'border-2 border-brand',
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES_VALUE}>All statuses</SelectItem>
            {FEEDBACK_REPORT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {formatFeedbackReportStatus(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label
          htmlFor="kind-filter"
          className="text-body-sm font-semibold text-muted-foreground"
        >
          Kind
        </Label>
        <Select
          value={filters.kind ?? ALL_KINDS_VALUE}
          onValueChange={handleKindChange}
        >
          <SelectTrigger
            id="kind-filter"
            className={cn(
              'h-10 min-w-[150px]',
              filters.kind !== undefined && 'border-2 border-brand',
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_KINDS_VALUE}>All kinds</SelectItem>
            {FEEDBACK_REPORT_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {formatFeedbackReportKind(kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label
          htmlFor="platform-filter"
          className="text-body-sm font-semibold text-muted-foreground"
        >
          Platform
        </Label>
        <Select
          value={filters.platform ?? ANY_PLATFORM_VALUE}
          onValueChange={handlePlatformChange}
        >
          <SelectTrigger
            id="platform-filter"
            className={cn(
              'h-10 min-w-[150px]',
              filters.platform !== undefined && 'border-2 border-brand',
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_PLATFORM_VALUE}>Any platform</SelectItem>
            {FEEDBACK_REPORT_PLATFORMS.map((platform) => (
              <SelectItem key={platform} value={platform}>
                {formatFeedbackReportPlatform(platform)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label
          htmlFor="issue-filter"
          className="text-body-sm font-semibold text-muted-foreground"
        >
          Tracking issue
        </Label>
        <Input
          id="issue-filter"
          type="text"
          inputMode="numeric"
          placeholder="Issue number"
          className="h-10 w-[140px]"
          value={filters.trackingIssue}
          onChange={handleTrackingIssueChange}
        />
      </div>

      <Button
        type="button"
        variant="outline"
        className="h-10"
        onClick={onClear}
      >
        Clear filters
      </Button>
    </div>
  );
}
