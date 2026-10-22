'use client';

import type { AdminAuditAction } from '@myorganiser/app-api-client';
import {
  BottomSheet,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
  Button,
  Checkbox,
  Label,
} from '@myorganiser/web-ui';
import { useId } from 'react';

import {
  AUDIT_ACTION_VALUES,
  type AuditLogUserFilter,
  countActiveAuditFilters,
} from '../../lib/auditLog';
import { formatAuditAction } from '../../lib/formatAuditLog';
import { AuditUserPicker } from './AuditUserPicker';

export interface AuditLogFilterSheetProps {
  actions: AdminAuditAction[];
  user: AuditLogUserFilter | undefined;
  onToggleAction: (action: AdminAuditAction) => void;
  onUserChange: (next: AuditLogUserFilter | undefined) => void;
  onClear: () => void;
}

/**
 * The phone filters, in a bottom sheet opened from the header. The filters
 * apply live, as on desktop: there is no draft state to confirm.
 */
export function AuditLogFilterSheet({
  actions,
  user,
  onToggleAction,
  onUserChange,
  onClear,
}: AuditLogFilterSheetProps) {
  const baseId = useId();
  const userPickerId = `${baseId}-user`;
  const userLabelId = `${baseId}-user-label`;
  const activeCount = countActiveAuditFilters(actions, user);
  const triggerLabel = activeCount > 0 ? `Filters · ${activeCount}` : 'Filters';

  return (
    <BottomSheet>
      <BottomSheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 md:h-10 shrink-0"
        >
          {triggerLabel}
        </Button>
      </BottomSheetTrigger>
      <BottomSheetContent className="max-h-[85dvh]">
        <BottomSheetHeader className="shrink-0">
          <BottomSheetTitle>Filters</BottomSheetTitle>
          <BottomSheetDescription className="text-caption text-muted-foreground">
            Narrow the audit log by action or user.
          </BottomSheetDescription>
        </BottomSheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-body-sm font-semibold text-muted-foreground">
              Action
            </legend>
            {AUDIT_ACTION_VALUES.map((action) => {
              const checkId = `${baseId}-${action}`;
              return (
                <div key={action} className="flex min-h-11 items-center gap-3">
                  <Checkbox
                    id={checkId}
                    checked={actions.includes(action)}
                    onCheckedChange={() => onToggleAction(action)}
                  />
                  <Label htmlFor={checkId} className="text-body">
                    {formatAuditAction(action)}
                  </Label>
                </div>
              );
            })}
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label
              id={userLabelId}
              htmlFor={userPickerId}
              className="text-body-sm font-semibold text-muted-foreground"
            >
              User
            </Label>
            <AuditUserPicker
              id={userPickerId}
              labelId={userLabelId}
              value={user}
              onChange={onUserChange}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-10 md:h-10 flex-1"
            disabled={activeCount === 0}
            onClick={onClear}
          >
            Clear filters
          </Button>
          <BottomSheetClose asChild>
            <Button type="button" className="h-10 md:h-10 flex-1">
              Done
            </Button>
          </BottomSheetClose>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
