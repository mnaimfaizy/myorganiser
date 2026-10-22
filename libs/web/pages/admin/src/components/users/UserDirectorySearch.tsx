'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  Input,
} from '@myorganiser/web-ui';
import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const searchSchema = z.object({
  query: z.string().trim(),
});

type SearchValues = z.infer<typeof searchSchema>;

export interface UserDirectorySearchProps {
  /** Receives the trimmed query on submit. */
  onSearch: (query: string) => void;
}

/** The name-or-email search. Submitting applies the query to the directory. */
export function UserDirectorySearch({ onSearch }: UserDirectorySearchProps) {
  const form = useForm<SearchValues>({
    resolver: zodResolver(searchSchema),
    defaultValues: { query: '' },
  });

  const handleValid = useCallback(
    (values: SearchValues) => {
      onSearch(values.query);
    },
    [onSearch],
  );

  return (
    <Form {...form}>
      <form
        role="search"
        onSubmit={form.handleSubmit(handleValid)}
        className="flex w-full gap-2 md:max-w-md"
      >
        <FormField
          control={form.control}
          name="query"
          render={({ field }) => (
            <FormItem className="min-w-0 flex-1 space-y-0">
              <FormControl>
                <Input
                  {...field}
                  aria-label="Search users"
                  placeholder="Search by name or email"
                />
              </FormControl>
            </FormItem>
          )}
        />
        <Button type="submit">Search</Button>
      </form>
    </Form>
  );
}
