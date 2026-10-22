'use client';

import type { AdminAuditAction } from '@myorganiser/app-api-client';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Label,
} from '@myorganiser/web-ui';
import { ChevronDown } from 'lucide-react';
import { useCallback, useId } from 'react';

import {
  AUDIT_ACTION_VALUES,
  type AuditLogUserFilter,
  countActiveAuditFilters,
  formatActionFilterSummary,
} from '../../lib/auditLog';
import { formatAuditAction } from '../../lib/formatAuditLog';
import { AuditUserPicker } from './AuditUserPicker';

export interface AuditLogFiltersProps {
  actions: AdminAuditAction[];
  user: AuditLogUserFilter | undefined;
  onToggleAction: (action: AdminAuditAction) => void;
  onUserChange: (next: AuditLogUserFilter | undefined) => void;
  onClear: () => void;
}

/**
 * The desktop filter toolbar: an Action multi-select and the User picker, then
 * Clear filters. The filters apply as they change; there is no submit.
 */
export function AuditLogFilters({
  actions,
  user,
  onToggleAction,
  onUserChange,
  onClear,
}: AuditLogFiltersProps) {
  const actionTriggerId = useId();
  const actionLabelId = useId();
  const actionValueId = useId();
  const userPickerId = useId();
  const userLabelId = useId();
  const hasFilters = countActiveAuditFilters(actions, user) > 0;

  // The menu stays open while several actions are ticked.
  const handleItemSelect = useCallback((event: Event) => {
    event.preventDefault();
  }, []);

  return (
    <div
      role="toolbar"
      aria-label="Filter the audit log"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-raised-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <Label
          id={actionLabelId}
          htmlFor={actionTriggerId}
          className="text-body-sm font-semibold text-muted-foreground"
        >
          Action
        </Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={actionTriggerId}
              type="button"
              variant="outline"
              aria-labelledby={`${actionLabelId} ${actionValueId}`}
              className={cn(
                'h-10 md:h-10 min-w-[180px] justify-between',
                actions.length > 0 && 'border-2 border-brand',
              )}
            >
              <span id={actionValueId} className="truncate">
                {formatActionFilterSummary(actions)}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {AUDIT_ACTION_VALUES.map((action) => (
              <DropdownMenuCheckboxItem
                key={action}
                checked={actions.includes(action)}
                onCheckedChange={() => onToggleAction(action)}
                onSelect={handleItemSelect}
              >
                {formatAuditAction(action)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-1">
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

      <Button
        type="button"
        variant="ghost"
        className="h-10 md:h-10 text-brand-text"
        disabled={!hasFilters}
        onClick={onClear}
      >
        Clear filters
      </Button>
    </div>
  );
}
