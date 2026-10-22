'use client';

import type { AdminUserSort, UserRole } from '@myorganiser/app-api-client';
import {
  ChoiceChip,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@myorganiser/web-ui';
import { useCallback, useId } from 'react';

import {
  isAdminUserSort,
  phoneChipIdFor,
  USER_DIRECTORY_PHONE_CHIPS,
  USER_ROLE_CHIPS,
  USER_SORT_LABELS,
  USER_SORT_VALUES,
  USER_STATUS_CHIPS,
  type UserDirectoryFilterValues,
  type UserDirectoryStatus,
  type UserDirectoryVariant,
} from '../../lib/userDirectory';

export interface UserDirectoryFiltersProps {
  variant: UserDirectoryVariant;
  status: UserDirectoryStatus | undefined;
  role: UserRole | undefined;
  sort: AdminUserSort;
  onStatusChange: (next: UserDirectoryStatus | undefined) => void;
  onRoleChange: (next: UserRole | undefined) => void;
  onFiltersChange: (next: UserDirectoryFilterValues) => void;
  onSortChange: (next: AdminUserSort) => void;
}

/**
 * Desktop: status and role chip groups, then a Sort select. Phone: one
 * scrolling row of chips and no sort. Chips are single-select: pressing the
 * pressed chip changes nothing.
 */
export function UserDirectoryFilters({
  variant,
  status,
  role,
  sort,
  onStatusChange,
  onRoleChange,
  onFiltersChange,
  onSortChange,
}: UserDirectoryFiltersProps) {
  const statusCaptionId = useId();
  const roleCaptionId = useId();
  const sortId = useId();

  const handleSortChange = useCallback(
    (next: string) => {
      if (isAdminUserSort(next)) onSortChange(next);
    },
    [onSortChange],
  );

  if (variant === 'phone') {
    const activePhoneChip = phoneChipIdFor({ status, role });

    return (
      <div
        role="toolbar"
        aria-label="Filter users"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {USER_DIRECTORY_PHONE_CHIPS.map((chip) => (
          <ChoiceChip
            key={chip.id}
            pressed={activePhoneChip === chip.id}
            onPressedChange={() => onFiltersChange(chip.filters)}
            className="shrink-0"
          >
            {chip.label}
          </ChoiceChip>
        ))}
      </div>
    );
  }

  return (
    <div
      role="toolbar"
      aria-label="Filter users"
      className="flex flex-wrap items-center gap-2"
    >
      <div
        role="group"
        aria-labelledby={statusCaptionId}
        className="flex flex-wrap items-center gap-2"
      >
        <span
          id={statusCaptionId}
          className="mr-1 text-caption font-semibold text-muted-foreground"
        >
          Status
        </span>
        {USER_STATUS_CHIPS.map((chip) => (
          <ChoiceChip
            key={chip.label}
            pressed={status === chip.status}
            onPressedChange={() => onStatusChange(chip.status)}
          >
            {chip.label}
          </ChoiceChip>
        ))}
      </div>
      <span aria-hidden="true" className="mx-2 h-6 w-px bg-border" />
      <div
        role="group"
        aria-labelledby={roleCaptionId}
        className="flex flex-wrap items-center gap-2"
      >
        <span
          id={roleCaptionId}
          className="mr-1 text-caption font-semibold text-muted-foreground"
        >
          Role
        </span>
        {USER_ROLE_CHIPS.map((chip) => (
          <ChoiceChip
            key={chip.label}
            pressed={role === chip.role}
            onPressedChange={() => onRoleChange(chip.role)}
          >
            {chip.label}
          </ChoiceChip>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Label htmlFor={sortId} className="text-body-sm text-muted-foreground">
          Sort
        </Label>
        <Select value={sort} onValueChange={handleSortChange}>
          <SelectTrigger id={sortId} className="h-10 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {USER_SORT_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {USER_SORT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
