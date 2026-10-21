'use client';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from '@myorganiser/web-ui';
import type { Control } from 'react-hook-form';
import type { AddItemFormValues } from '../schemas';
import { AddItemImageAndLinksFields } from './AddItemImageAndLinksFields';

interface AddItemDetailsFieldsProps {
  control: Control<AddItemFormValues>;
  imageUrl: string;
  isLoading: boolean;
  /** List mode: Amount is shown and Price each updates the Catalog Item. */
  showAmount?: boolean;
  /** Image or link validation failed, so the disclosure must open to show it. */
  hasMoreErrors?: boolean;
}

/** Amount, price, notes, and the image and links behind a disclosure. */
export function AddItemDetailsFields({
  control,
  imageUrl,
  isLoading,
  showAmount = true,
  hasMoreErrors = false,
}: AddItemDetailsFieldsProps) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {showAmount ? (
          <FormField
            control={control}
            name="amount"
            render={({ field }) => (
              <FormItem className="gap-1.5">
                <FormLabel className="text-body font-semibold text-foreground">
                  Amount
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="e.g. 2, 500g"
                    disabled={isLoading}
                    className="h-11 text-body"
                  />
                </FormControl>
                <FormDescription className="text-caption text-muted-foreground">
                  Like 2, 500g or 1 dozen
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        <FormField
          control={control}
          name="price"
          render={({ field }) => (
            <FormItem className="gap-1.5">
              <FormLabel className="text-body font-semibold text-foreground">
                Price each
              </FormLabel>
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-body text-muted-foreground"
                >
                  $
                </span>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="0.00"
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={isLoading}
                    className="h-11 pl-7 text-body"
                  />
                </FormControl>
              </div>
              {showAmount ? (
                <FormDescription className="text-caption text-muted-foreground">
                  Updates the Catalog Item
                </FormDescription>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={control}
        name="notes"
        render={({ field }) => (
          <FormItem className="gap-1.5">
            <FormLabel className="text-body font-semibold text-foreground">
              Notes
            </FormLabel>
            <FormControl>
              <Textarea
                {...field}
                placeholder="Brand, size or dietary needs"
                disabled={isLoading}
                rows={2}
                maxLength={1000}
                className="text-body"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <AddItemImageAndLinksFields
        control={control}
        imageUrl={imageUrl}
        isLoading={isLoading}
        hasErrors={hasMoreErrors}
      />
    </>
  );
}
