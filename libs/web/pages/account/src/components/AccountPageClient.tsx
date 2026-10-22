'use client';

import { getCurrentUser } from '@myorganiser/auth';
import { useIsMobileState } from '@myorganiser/web-ui';

import type { AccountVariant } from '../account-view';
import { useAccountPreferences } from '../hooks/use-account-preferences';
import { useYouTubeDigestSettings } from '../hooks/use-youtube-digest-settings';
import { useLatestBackup } from '../hooks/useLatestBackup';
import { AccountBackupSummary } from './AccountBackupSummary';
import { AccountProfileHeader } from './AccountProfileHeader';
import { DeleteAccountSection } from './DeleteAccountSection';
import { InstallAppSection } from './InstallAppSection';
import { PreferencesSection } from './PreferencesSection';
import { YourReportsSummaryLink } from './YourReportsSummaryLink';
import { YouTubeDigestSection } from './YouTubeDigestSection';

const DESKTOP_LAYOUT = 'mx-auto flex w-full max-w-[880px] flex-col gap-6 p-8';
const PHONE_LAYOUT =
  'flex flex-col gap-3 px-4 pt-3 pb-6 pl-[calc(1rem_+_env(safe-area-inset-left))] pr-[calc(1rem_+_env(safe-area-inset-right))]';

export function AccountPageClient() {
  const isPhone = useIsMobileState();
  const preferences = useAccountPreferences();
  const digest = useYouTubeDigestSettings();
  const latestBackup = useLatestBackup();

  // Hold the first frame until the breakpoint is known, so a phone never
  // flashes the desktop layout.
  if (isPhone === undefined) return null;

  const variant: AccountVariant = isPhone ? 'phone' : 'desktop';
  const user = getCurrentUser();

  return (
    <div className={isPhone ? PHONE_LAYOUT : DESKTOP_LAYOUT}>
      <AccountProfileHeader
        variant={variant}
        name={user?.name ?? ''}
        email={user?.email ?? ''}
      />
      <AccountBackupSummary variant={variant} state={latestBackup} />
      <PreferencesSection
        variant={variant}
        countryCode={preferences.countryCode}
        onCountryCodeChange={preferences.setCountryCode}
        preferredCurrency={preferences.preferredCurrency}
        onPreferredCurrencyChange={preferences.setPreferredCurrency}
        onSave={preferences.save}
      />
      {digest.connected && (
        <YouTubeDigestSection
          variant={variant}
          enabled={digest.enabled}
          onEnabledChange={digest.setEnabled}
          weekday={digest.weekday}
          onWeekdayChange={digest.setWeekday}
          saving={digest.saving}
          onSave={digest.save}
          timeZone={digest.timeZone}
        />
      )}
      <InstallAppSection variant={variant} />
      <YourReportsSummaryLink variant={variant} />
      <DeleteAccountSection variant={variant} />
    </div>
  );
}
