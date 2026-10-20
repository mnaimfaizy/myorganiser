import { FormField, FormItem, SegmentedControl } from '@myorganiser/web-ui';
import type { Control } from 'react-hook-form';

import { PRIORITY_OPTIONS, UPDATE_METHOD_OPTIONS } from '../labels';
import type { PlaceFormValues } from '../placeForm';

export interface PlaceDialogUpdateFieldsProps {
  control: Control<PlaceFormValues>;
  onUpdateMethodChange: (value: PlaceFormValues['updateMethod']) => void;
  onPriorityChange: (value: PlaceFormValues['priority']) => void;
}

/** The how-to-update and priority segmented controls. */
export function PlaceDialogUpdateFields({
  control,
  onUpdateMethodChange,
  onPriorityChange,
}: PlaceDialogUpdateFieldsProps) {
  return (
    <>
      <FormField
        control={control}
        name="updateMethod"
        render={({ field }) => (
          <FormItem>
            <SegmentedControl
              name={field.name}
              value={field.value}
              onValueChange={onUpdateMethodChange}
              options={UPDATE_METHOD_OPTIONS}
              legend="How to update"
            />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="priority"
        render={({ field }) => (
          <FormItem>
            <SegmentedControl
              name={field.name}
              value={field.value}
              onValueChange={onPriorityChange}
              options={PRIORITY_OPTIONS}
              legend="Priority"
            />
          </FormItem>
        )}
      />
    </>
  );
}
