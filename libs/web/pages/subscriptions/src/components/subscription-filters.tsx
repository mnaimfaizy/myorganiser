'use client';

import {
  SubscriptionStatusEnum,
  type SubscriptionStatus,
} from '@myorganiser/vault-core';
import {
  ChoiceChip,
  Label,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type SegmentedControlOption,
} from '@myorganiser/web-ui';
import { useCallback, useId } from 'react';

import { getSubscriptionStatusLabel } from '../utils/presentation';
import {
  SUBSCRIPTION_SORT_LABELS,
  SUBSCRIPTION_STATUS_FILTERS,
  type SubscriptionListFilter,
  type SubscriptionSort,
} from '../utils/subscription-summary';

interface SubscriptionFiltersProps {
  filter: SubscriptionListFilter;
  onFilterChange: (next: SubscriptionListFilter) => void;
  counts: Record<SubscriptionStatus, number>;
  sort: SubscriptionSort;
  onSortChange: (next: SubscriptionSort) => void;
  variant: 'desktop' | 'phone';
}

type PhoneStatusFilter = 'active' | 'others';

const SORT_VALUES = Object.keys(SUBSCRIPTION_SORT_LABELS) as SubscriptionSort[];

function isSubscriptionSort(value: string): value is SubscriptionSort {
  return value in SUBSCRIPTION_SORT_LABELS;
}

/**
 * Desktop: one status chip per status (single select) and a Sort select.
 * Phone: an Active / Others segmented control and no sort. A non-active
 * status on phone reads as Others, because the phone list has no chip for it.
 */
const SubscriptionFilters = ({
  filter,
  onFilterChange,
  counts,
  sort,
  onSortChange,
  variant,
}: SubscriptionFiltersProps) => {
  const sortId = useId();

  const handleStatusPress = useCallback(
    (next: SubscriptionStatus) => {
      onFilterChange(next);
    },
    [onFilterChange],
  );

  const handlePhoneFilterChange = useCallback(
    (next: PhoneStatusFilter) => {
      onFilterChange(
        next === 'active' ? SubscriptionStatusEnum.Active : 'others',
      );
    },
    [onFilterChange],
  );

  const handleSortChange = useCallback(
    (next: string) => {
      if (isSubscriptionSort(next)) onSortChange(next);
    },
    [onSortChange],
  );

  if (variant === 'phone') {
    const othersCount = SUBSCRIPTION_STATUS_FILTERS.filter(
      (status) => status !== SubscriptionStatusEnum.Active,
    ).reduce((sum, status) => sum + counts[status], 0);

    const options: readonly SegmentedControlOption<PhoneStatusFilter>[] = [
      {
        value: 'active',
        label: `Active · ${counts[SubscriptionStatusEnum.Active]}`,
      },
      { value: 'others', label: `Others · ${othersCount}` },
    ];

    return (
      <div>
        <SegmentedControl<PhoneStatusFilter>
          name="subscription-status"
          legend="Status"
          options={options}
          value={filter === SubscriptionStatusEnum.Active ? 'active' : 'others'}
          onValueChange={handlePhoneFilterChange}
          className="gap-0 [&>legend]:sr-only"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
        {SUBSCRIPTION_STATUS_FILTERS.map((status) => (
          <ChoiceChip
            key={status}
            pressed={filter === status}
            onPressedChange={() => handleStatusPress(status)}
          >
            {`${getSubscriptionStatusLabel(status)} · ${counts[status]}`}
          </ChoiceChip>
        ))}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <Label htmlFor={sortId} className="text-body-sm text-muted-foreground">
          Sort
        </Label>
        <Select value={sort} onValueChange={handleSortChange}>
          <SelectTrigger id={sortId} className="h-9 w-44 md:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {SUBSCRIPTION_SORT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export { SubscriptionFilters };
export type { SubscriptionFiltersProps };
