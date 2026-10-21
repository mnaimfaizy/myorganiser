'use client';

import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@myorganiser/web-ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent, MouseEvent } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import {
  formatBooleanLabel,
  formatUserDisplayName,
  formatUserRole,
} from '../lib/formatUserIdentity';

export function UserDirectoryPageClient() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState<string | undefined>(
    undefined,
  );
  const [users, setUsers] = useState<AdminUserIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async (query?: string) => {
    setLoading(true);
    setError(null);

    try {
      const api = createPlatformAdminApi();
      const response = await api.listUsers({ q: query, pageSize: 100 });
      setUsers(response.data.users);
    } catch {
      setError('Unable to load users. Please try again.');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers(appliedQuery);
  }, [appliedQuery, loadUsers]);

  const handleSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = searchInput.trim();
      setAppliedQuery(trimmed || undefined);
    },
    [searchInput],
  );

  const handleSearchInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSearchInput(event.target.value);
    },
    [],
  );

  const handleRowClick = useCallback(
    (event: MouseEvent<HTMLTableRowElement>) => {
      const userId = event.currentTarget.dataset.userId;

      if (userId) {
        router.push(`/admin/users/${userId}`);
      }
    },
    [router],
  );

  const handleViewLinkClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.stopPropagation();
    },
    [],
  );

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>

      <form onSubmit={handleSearchSubmit} className="flex max-w-md gap-2">
        <Input
          value={searchInput}
          onChange={handleSearchInputChange}
          placeholder="Search by name or email"
          aria-label="Search users"
        />
        <Button type="submit">Search</Button>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Disabled</TableHead>
              <TableHead>Email verified</TableHead>
              <TableHead className="w-[80px]">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow
                key={user.id}
                data-user-id={user.id}
                className="cursor-pointer"
                onClick={handleRowClick}
              >
                <TableCell className="font-medium">
                  {formatUserDisplayName(user)}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{formatUserRole(user.role)}</TableCell>
                <TableCell>{formatBooleanLabel(user.disabled)}</TableCell>
                <TableCell>{formatBooleanLabel(user.emailVerified)}</TableCell>
                <TableCell>
                  <Link
                    href={`/admin/users/${user.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={handleViewLinkClick}
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
