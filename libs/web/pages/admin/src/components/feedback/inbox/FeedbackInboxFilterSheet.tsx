'use client';

import {
  BottomSheet,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@myorganiser/web-ui';
import { type ChangeEvent, useCallback, useId } from 'react';

import {
  FEEDBACK_REPORT_KINDS,
  formatFeedbackReportKind,
} from '../../../lib/formatFeedbackReport';
import {
  countFeedbackSheetFilters,
  FEEDBACK_REPORT_PLATFORMS,
  formatFeedbackReportPlatform,
  type FeedbackInboxFilters as FeedbackFilterValues,
} from '../../../lib/feedbackInbox';

const ALL_KINDS_VALUE = 'all';
const ANY_PLATFORM_VALUE = 'any';

export interface FeedbackInboxFilterSheetProps {
  filters: FeedbackFilterValues;
  /** Merges the given filters in. The hook resets paging. */
  onChange: (next: Partial<FeedbackFilterValues>) => void;
  onClear: () => void;
}

/**
 * The phone filters, in a bottom sheet opened from the header: Kind, Platform
 * and Tracking issue. The filters apply live, as on desktop, so there is no
 * draft state to confirm. Status is not here; its chips sit under the header.
 */
export function FeedbackInboxFilterSheet({
  filters,
  onChange,
  onClear,
}: FeedbackInboxFilterSheetProps) {
  const baseId = useId();
  const kindId = `${baseId}-kind`;
  const platformId = `${baseId}-platform`;
  const issueId = `${baseId}-issue`;
  const activeCount = countFeedbackSheetFilters(filters);
  const triggerLabel = activeCount > 0 ? `Filters · ${activeCount}` : 'Filters';

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
    <BottomSheet>
      <BottomSheetTrigger asChild>
        <Button type="button" variant="outline" className="h-10 shrink-0">
          {triggerLabel}
        </Button>
      </BottomSheetTrigger>
      <BottomSheetContent className="max-h-[85dvh]">
        <BottomSheetHeader className="shrink-0">
          <BottomSheetTitle>Filters</BottomSheetTitle>
          <BottomSheetDescription className="text-caption text-muted-foreground">
            Narrow the inbox by kind, platform or tracking issue.
          </BottomSheetDescription>
        </BottomSheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-2">
            <Label
              htmlFor={kindId}
              className="text-body-sm font-semibold text-muted-foreground"
            >
              Kind
            </Label>
            <Select
              value={filters.kind ?? ALL_KINDS_VALUE}
              onValueChange={handleKindChange}
            >
              <SelectTrigger id={kindId} className="h-10 w-full">
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

          <div className="flex flex-col gap-2">
            <Label
              htmlFor={platformId}
              className="text-body-sm font-semibold text-muted-foreground"
            >
              Platform
            </Label>
            <Select
              value={filters.platform ?? ANY_PLATFORM_VALUE}
              onValueChange={handlePlatformChange}
            >
              <SelectTrigger id={platformId} className="h-10 w-full">
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

          <div className="flex flex-col gap-2">
            <Label
              htmlFor={issueId}
              className="text-body-sm font-semibold text-muted-foreground"
            >
              Tracking issue
            </Label>
            <Input
              id={issueId}
              type="text"
              inputMode="numeric"
              placeholder="Issue number"
              className="h-10"
              value={filters.trackingIssue}
              onChange={handleTrackingIssueChange}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-10 flex-1"
            onClick={onClear}
          >
            Clear filters
          </Button>
          <BottomSheetClose asChild>
            <Button type="button" className="h-10 flex-1">
              Done
            </Button>
          </BottomSheetClose>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
