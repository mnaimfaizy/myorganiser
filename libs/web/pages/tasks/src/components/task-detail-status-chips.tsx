'use client';

import type { TaskStatus } from '@myorganiser/vault-core';
import { ChoiceChip } from '@myorganiser/web-ui';
import { TASK_STATUS_OPTIONS } from '../utils/task-detail-copy';

export interface TaskDetailStatusChipsProps {
  value: TaskStatus;
  /** Called only with a status the user chose; re-choosing the pressed one is a no-op upstream. */
  onValueChange: (status: TaskStatus) => void;
}

/** The desktop Task detail status row: single-select chips in a named group. */
export function TaskDetailStatusChips({
  value,
  onValueChange,
}: TaskDetailStatusChipsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-sm font-semibold text-foreground">Status</span>
      <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
        {TASK_STATUS_OPTIONS.map((option) => (
          <ChoiceChip
            key={option.value}
            pressed={value === option.value}
            onPressedChange={() => onValueChange(option.value)}
          >
            {option.label}
          </ChoiceChip>
        ))}
      </div>
    </div>
  );
}
