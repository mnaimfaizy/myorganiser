'use client';

import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import {
  Button,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@myorganiser/web-ui';
import { ChevronsUpDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { createPlatformAdminApi } from '../../lib/apiClient';
import type { AuditLogUserFilter } from '../../lib/auditLog';
import { formatUserDisplayName } from '../../lib/formatUserIdentity';
import { USER_DIRECTORY_MESSAGES } from '../../lib/userDirectory';

/** The picker shows the first ten Users by name when the search is empty. */
const PICKER_PAGE_SIZE = 10;

/** Waits for typing to pause before asking the server. */
const SEARCH_DEBOUNCE_MS = 250;

const ANY_USER_LABEL = 'Any user';
const ANY_USER_VALUE = '__any_user__';

export interface AuditUserPickerProps {
  /** The trigger's id. */
  id: string;
  /** The id of the Label that names the trigger. The value is read after it. */
  labelId: string;
  value: AuditLogUserFilter | undefined;
  onChange: (next: AuditLogUserFilter | undefined) => void;
}

/** The last settled search. `key` is the search it answers. */
interface AuditUserPickerSettled {
  key: string | null;
  users: AdminUserIdentity[];
  error: boolean;
}

const NO_USERS: AdminUserIdentity[] = [];

/**
 * A searchable single-user picker over the server. Popover and Command, with
 * `shouldFilter` off because the server does the filtering. The search is
 * debounced, and a response from a superseded search is dropped.
 */
export function AuditUserPicker({
  id,
  labelId,
  value,
  onChange,
}: AuditUserPickerProps) {
  const valueId = `${id}-value`;
  const contentId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const requestKey = search.trim();
  const [settled, setSettled] = useState<AuditUserPickerSettled>({
    key: null,
    users: NO_USERS,
    error: false,
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    // The request still fires for an empty search: that is the first ten by name.
    const timer = window.setTimeout(() => {
      createPlatformAdminApi()
        .listUsers({
          q: requestKey || undefined,
          pageSize: PICKER_PAGE_SIZE,
          sort: 'name',
        })
        .then((response) => {
          if (cancelled) return;
          setSettled({
            key: requestKey,
            users: response.data.users,
            error: false,
          });
        })
        .catch(() => {
          if (cancelled) return;
          setSettled({ key: requestKey, users: NO_USERS, error: true });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, requestKey]);

  const pending = settled.key !== requestKey;
  const users = pending || settled.error ? NO_USERS : settled.users;

  const handleSelect = useCallback(
    (user: AdminUserIdentity) => {
      onChange({ id: user.id, name: formatUserDisplayName(user) });
      setOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(undefined);
    setOpen(false);
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-labelledby={`${labelId} ${valueId}`}
          aria-controls={open ? contentId : undefined}
          aria-expanded={open}
          className="h-10 md:h-10 min-w-[160px] justify-between"
        >
          <span id={valueId} className="truncate">
            {value?.name ?? ANY_USER_LABEL}
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className="shrink-0 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        id={contentId}
        align="start"
        className="w-[--radix-popover-trigger-width] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search users"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandGroup>
              <CommandItem value={ANY_USER_VALUE} onSelect={handleClear}>
                {ANY_USER_LABEL}
              </CommandItem>
              {users.map((user) => (
                <CommandItem
                  key={user.id}
                  value={user.id}
                  onSelect={() => handleSelect(user)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                      {formatUserDisplayName(user)}
                    </span>
                    <span className="truncate text-caption text-muted-foreground">
                      {user.email}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {pending ? (
              <p
                role="status"
                className="px-2 py-3 text-body-sm text-muted-foreground"
              >
                {USER_DIRECTORY_MESSAGES.loading}
              </p>
            ) : settled.error ? (
              <p className="px-2 py-3 text-body-sm text-destructive">
                {USER_DIRECTORY_MESSAGES.error}
              </p>
            ) : users.length === 0 ? (
              <p className="px-2 py-3 text-body-sm text-muted-foreground">
                {USER_DIRECTORY_MESSAGES.empty}
              </p>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
