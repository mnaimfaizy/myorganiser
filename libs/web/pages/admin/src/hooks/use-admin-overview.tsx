'use client';

import type { AdminOverviewResponse } from '@myorganiser/app-api-client';
import * as React from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';

export interface AdminOverviewState {
  overview: AdminOverviewResponse | null;
  loading: boolean;
  error: boolean;
  /** Fetches the overview again. Clears the error and shows loading. */
  reload: () => void;
}

const AdminOverviewContext = React.createContext<AdminOverviewState | null>(
  null,
);

interface AdminOverviewProviderProps {
  children: React.ReactNode;
}

/**
 * Fetches `/admin/overview` once on mount and shares it with the sidebar
 * badges and the Overview page, so the shell makes one request. Mounted in the
 * admin layout.
 */
export function AdminOverviewProvider({
  children,
}: AdminOverviewProviderProps) {
  const [overview, setOverview] = React.useState<AdminOverviewResponse | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;

    createPlatformAdminApi()
      .getAdminOverview()
      .then((response) => {
        if (cancelled) return;
        setOverview(response.data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = React.useCallback(() => {
    setLoading(true);
    setError(false);
    setAttempt((count) => count + 1);
  }, []);

  const value = React.useMemo<AdminOverviewState>(
    () => ({ overview, loading, error, reload }),
    [overview, loading, error, reload],
  );

  return (
    <AdminOverviewContext.Provider value={value}>
      {children}
    </AdminOverviewContext.Provider>
  );
}

/**
 * The shared overview state. Must be called inside `AdminOverviewProvider`;
 * outside it the hook throws, so a missing provider fails loudly rather than
 * rendering an empty shell.
 */
export function useAdminOverview(): AdminOverviewState {
  const state = React.useContext(AdminOverviewContext);
  if (state === null) {
    throw new Error(
      'useAdminOverview must be used inside AdminOverviewProvider',
    );
  }
  return state;
}
