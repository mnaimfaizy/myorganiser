import {
  Checkbox,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@myorganiser/web-ui';
import type { ChangeEvent } from 'react';
import type { Control } from 'react-hook-form';

import type { PlaceFormValues } from '../placeForm';

export interface PlaceDialogLinkFieldsProps {
  control: Control<PlaceFormValues>;
  onLinkChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onChangedChange: (checked: boolean | 'indeterminate') => void;
}

/** The optional update link and the already-updated checkbox. */
export function PlaceDialogLinkFields({
  control,
  onLinkChange,
  onChangedChange,
}: PlaceDialogLinkFieldsProps) {
  return (
    <>
      <FormField
        control={control}
        name="link"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Where to change it{' '}
              <span className="font-normal text-muted-foreground">
                · optional
              </span>
            </FormLabel>
            <FormControl>
              <Input
                name={field.name}
                ref={field.ref}
                value={field.value ?? ''}
                onChange={onLinkChange}
                type="url"
                placeholder="https://"
              />
            </FormControl>
            <FormDescription>
              A link to the page where you update your details.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="changed"
        render={({ field }) => (
          <FormItem className="flex min-h-11 flex-row items-center gap-3 space-y-0">
            <FormControl>
              <Checkbox
                checked={field.value}
                onCheckedChange={onChangedChange}
              />
            </FormControl>
            <div className="flex flex-col">
              <FormLabel className="text-body-sm font-semibold">
                Already updated
              </FormLabel>
              <FormDescription className="text-caption text-muted-foreground">
                Records today&apos;s date
              </FormDescription>
            </div>
          </FormItem>
        )}
      />
    </>
  );
}
