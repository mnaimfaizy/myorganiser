'use client';

import type { AdminAuditLogEntry } from '@myorganiser/app-api-client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@myorganiser/web-ui';
import { useCallback, useEffect, useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import { formatAuditAction, formatAuditTimestamp } from '../lib/formatAuditLog';

export function AuditLogPageClient() {
  const [entries, setEntries] = useState<AdminAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAuditLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const api = createPlatformAdminApi();
      const response = await api.listAuditLogs({ pageSize: 50 });
      setEntries(response.data.entries);
    } catch {
      setError('Unable to load audit log. Please try again.');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAuditLogs();
  }, [loadAuditLogs]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <h1 className="text-2xl font-semibold tracking-tight">Admin Audit Log</h1>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No audit log entries yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{formatAuditTimestamp(entry.createdAt)}</TableCell>
                <TableCell>{formatAuditAction(entry.action)}</TableCell>
                <TableCell>{entry.actorUserId}</TableCell>
                <TableCell>{entry.targetUserId}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
