'use client';

import * as React from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { CalendarIcon } from 'lucide-react';

import { cn } from '../../utils';
import { Button } from '../Button/Button';
import { Calendar } from '../Calendar/Calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../Popover/Popover';

export type DatePickerProps = {
  id?: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-describedby'?: string;
};

function parseDateInput(value?: string) {
  if (!value) return undefined;
  const parsed = parseISO(value);
  if (!isValid(parsed)) return undefined;
  return parsed;
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = 'Pick a date',
  disabled,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: DatePickerProps) {
  const selected = parseDateInput(value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal',
            !selected && 'text-muted-foreground',
          )}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          type="button"
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selected ? format(selected, 'PPP') : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          // Without this the popover always opens on the current month, even
          // when a date is already chosen — so picking a 2024 date and
          // reopening lands the User in this month with nothing selected in
          // view. It also made the Storybook snapshot move every month.
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) {
              onChange('');
              return;
            }
            onChange(format(date, 'yyyy-MM-dd'));
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
