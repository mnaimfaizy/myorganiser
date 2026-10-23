'use client';

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  cn,
} from '@myorganiser/web-ui';
import { ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { Control } from 'react-hook-form';
import type { AddItemFormValues } from '../schemas';
import { LinksInput } from './LinksInput';

const IMAGE_AND_LINKS_ID = 'add-item-image-and-links';

interface AddItemImageAndLinksFieldsProps {
  control: Control<AddItemFormValues>;
  imageUrl: string;
  isLoading: boolean;
  /** Image or link validation failed, so the disclosure opens to show it. */
  hasErrors: boolean;
}

/** The optional image URL and links, behind a disclosure so the common path stays short. */
export function AddItemImageAndLinksFields({
  control,
  imageUrl,
  isLoading,
  hasErrors,
}: AddItemImageAndLinksFieldsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isExpanded = isOpen || hasErrors;

  const handleToggle = useCallback(() => {
    setIsOpen((value) => !value);
  }, []);

  const handleImageError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      event.currentTarget.style.display = 'none';
    },
    [],
  );

  return (
    <>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={IMAGE_AND_LINKS_ID}
        onClick={handleToggle}
        className="flex h-10 items-center gap-2 self-start text-control-sm font-semibold text-brand-text hover:text-brand-text-strong"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-3 transition-transform',
            isExpanded && 'rotate-90',
          )}
        />
        Image and links
      </button>

      {isExpanded ? (
        <div id={IMAGE_AND_LINKS_ID} className="flex flex-col gap-3.5">
          <FormField
            control={control}
            name="imageUrl"
            render={({ field }) => (
              <FormItem className="gap-1.5">
                <FormLabel className="text-body font-semibold text-foreground">
                  Image URL{' '}
                  <span className="text-caption font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="https://example.com/image.jpg"
                    type="url"
                    disabled={isLoading}
                    className="h-11 text-body"
                  />
                </FormControl>
                <FormMessage />
                {imageUrl.startsWith('http') && (
                  <div className="mt-2 overflow-hidden rounded-xl border border-border">
                    <img
                      src={imageUrl}
                      alt="Item preview"
                      className="max-h-48 max-w-xs rounded"
                      onError={handleImageError}
                    />
                  </div>
                )}
              </FormItem>
            )}
          />

          <FormItem className="gap-1.5">
            <FormLabel className="text-body font-semibold text-foreground">
              Links{' '}
              <span className="text-caption font-normal text-muted-foreground">
                (optional, max 10)
              </span>
            </FormLabel>
            <LinksInput control={control} disabled={isLoading} />
          </FormItem>
        </div>
      ) : null}
    </>
  );
}
