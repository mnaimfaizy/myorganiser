'use client';

import { getAccessToken } from '@myorganiser/auth';
import {
  COUNTRIES,
  detectTimeZone,
  getAccountSettings,
  getApiBaseUrl,
  setAccountSettings,
  subscribeAccountSettings,
  SUPPORTED_CURRENCIES,
} from '@myorganiser/core';
import type { CurrencyCode } from '@myorganiser/vault-core';
import {
  Button,
  Card,
  CardContent,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@myorganiser/web-ui';
import { LastBackupCard } from '@myorganiser/web-vault-ui';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useLatestBackup } from '../hooks/useLatestBackup';
import { DeleteAccountSection } from './DeleteAccountSection';
import { InstallAppSection } from './InstallAppSection';
import { YourReportsSummaryLink } from './YourReportsSummaryLink';

export function AccountPageClient() {
  const { toast } = useToast();

  const [countryCode, setCountryCode] = useState<string>('AU');
  const [preferredCurrency, setPreferredCurrency] =
    useState<CurrencyCode>('AUD');

  // YouTube notification settings
  const [ytEnabled, setYtEnabled] = useState(false);
  const [ytWeekday, setYtWeekday] = useState(1);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytConnected, setYtConnected] = useState(false);

  useEffect(() => {
    const apply = () => {
      const settings = getAccountSettings();
      setCountryCode(settings.countryCode);
      setPreferredCurrency(settings.preferredCurrency);
    };

    apply();
    return subscribeAccountSettings(apply);
  }, []);

  // Fetch YouTube notification settings
  useEffect(() => {
    (async () => {
      try {
        const token = getAccessToken();
        const authHeaders = token
          ? { Authorization: `Bearer ${token}` }
          : undefined;
        const status = await fetch(`${getApiBaseUrl()}/youtube/status`, {
          headers: authHeaders,
          credentials: 'include',
        });
        if (!status.ok) return;
        const statusData = await status.json();
        setYtConnected(statusData.connected);
        if (!statusData.connected) return;

        const res = await fetch(
          `${getApiBaseUrl()}/youtube/notification-settings`,
          {
            headers: authHeaders,
            credentials: 'include',
          },
        );
        if (!res.ok) return;
        const data = await res.json();
        setYtEnabled(data.enabled);
        setYtWeekday(data.preferredWeekday);
      } catch {
        // YouTube not connected or API unavailable
      }
    })();
  }, []);

  const saveYouTubeSettings = useCallback(async () => {
    setYtLoading(true);
    try {
      const token = getAccessToken();
      const timeZone = detectTimeZone();
      const res = await fetch(
        `${getApiBaseUrl()}/youtube/notification-settings`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({
            enabled: ytEnabled,
            preferredWeekday: ytWeekday,
            timeZone,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to save');
      }
      toast({
        title: 'Saved',
        description: 'Weekly digest settings updated.',
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to update digest settings.';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setYtLoading(false);
    }
  }, [ytEnabled, ytWeekday, toast]);

  const countries = useMemo(() => COUNTRIES, []);

  const latestBackup = useLatestBackup();
  const latestBackupRecord =
    latestBackup.status === 'loaded'
      ? latestBackup.record
      : latestBackup.status === 'empty'
        ? null
        : undefined;

  const persist = useCallback(
    (next: { countryCode: string; preferredCurrency: CurrencyCode }) => {
      setAccountSettings(next);
      toast({
        title: 'Saved',
        description: 'Account settings updated.',
      });
    },
    [toast],
  );

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-col gap-2">
        <LastBackupCard
          record={latestBackupRecord}
          isLoading={latestBackup.status === 'loading'}
        />
        <Link
          href="/dashboard/vault"
          className="text-sm text-primary underline"
        >
          Go to Vault →
        </Link>
      </div>
      <Card className="p-4">
        <CardTitle className="text-lg">Settings</CardTitle>{' '}
        <CardContent className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Country</Label>
            <Select
              value={countryCode}
              onValueChange={(v) => setCountryCode(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Preferred currency</Label>
            <Select
              value={preferredCurrency}
              onValueChange={(v) => setPreferredCurrency(v as CurrencyCode)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() =>
              persist({
                countryCode,
                preferredCurrency,
              })
            }
            className="w-full"
          >
            Save
          </Button>
        </CardContent>
      </Card>

      <InstallAppSection />

      <YourReportsSummaryLink />

      {ytConnected && (
        <Card className="p-4">
          <CardTitle className="text-lg">Weekly YouTube digest</CardTitle>
          <CardContent className="mt-4 space-y-4">
            <div className="flex items-center gap-2">
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={ytEnabled}
                  onChange={() => setYtEnabled(!ytEnabled)}
                  aria-label="Email me a weekly digest"
                  className="peer sr-only"
                />
                <div className="peer h-5 w-9 rounded-full bg-muted after:absolute after:start-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-border after:bg-card after:transition-all after:content-[''] peer-checked:bg-brand peer-checked:after:translate-x-full peer-checked:after:border-card" />
              </label>
              <Label>Email me a weekly digest</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Digest lists only Cached Uploads that are still New — Watched
              uploads are left out. Weeks with nothing new are skipped entirely.
            </p>

            <div className="space-y-2">
              <Label htmlFor="weekday-select">Send on</Label>
              <Select
                value={String(ytWeekday)}
                onValueChange={(v) => setYtWeekday(parseInt(v, 10))}
                disabled={!ytEnabled}
              >
                <SelectTrigger id="weekday-select">
                  <SelectValue placeholder="Select day" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Sunday</SelectItem>
                  <SelectItem value="1">Monday</SelectItem>
                  <SelectItem value="2">Tuesday</SelectItem>
                  <SelectItem value="3">Wednesday</SelectItem>
                  <SelectItem value="4">Thursday</SelectItem>
                  <SelectItem value="5">Friday</SelectItem>
                  <SelectItem value="6">Saturday</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Sent on your chosen day, in your time zone (
                {detectTimeZone() || 'UTC'}).
              </p>
            </div>

            <Button
              onClick={saveYouTubeSettings}
              disabled={ytLoading}
              className="w-full"
            >
              {ytLoading ? 'Saving…' : 'Save digest settings'}
            </Button>
          </CardContent>
        </Card>
      )}

      <DeleteAccountSection />
    </div>
  );
}
