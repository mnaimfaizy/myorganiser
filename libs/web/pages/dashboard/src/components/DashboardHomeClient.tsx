'use client';

import { getCurrentUser } from '@myorganiser/auth';
import { useIsMobileState } from '@myorganiser/web-ui';
import {
  ABSENT_EVIDENCE_WITHOUT_OWNER,
  deriveVaultHomeState,
  describeVaultSyncStatus,
  useOptionalVaultSession,
  useVaultSyncStatus,
} from '@myorganiser/web-vault-ui';
import { useCallback, useMemo } from 'react';

import { HomeDesktop } from '../home/components/HomeDesktop';
import { HomePhone } from '../home/components/HomePhone';
import { buildHomeView } from '../home/home-view';
import { useHomeSummary } from '../home/hooks/use-home-summary';
import { useLatestBackupSummary } from '../home/hooks/use-latest-backup-summary';
import { useYouTubeHome } from '../home/hooks/use-youtube-home';

/**
 * The Home page. Reads the vault and YouTube, then renders the phone or the
 * desktop layout. Renders nothing until the breakpoint is known, so a phone
 * never paints the desktop page first (the Tasks pattern).
 */
export function DashboardHomeClient() {
  const user = useMemo(() => getCurrentUser(), []);
  const session = useOptionalVaultSession();
  const handle = session?.handle ?? null;
  const unlocked = handle?.isUnlocked === true;

  const { now, summary } = useHomeSummary(handle);
  const backup = useLatestBackupSummary(unlocked);
  const youtube = useYouTubeHome();
  const { status } = useVaultSyncStatus();
  const isPhone = useIsMobileState();

  const lockVault = useCallback(() => {
    session?.lock();
  }, [session]);

  if (isPhone === undefined) {
    return null;
  }

  // Healthy sync shows the Synced chip; any other state shows the shell's
  // sync widget instead.
  const synced =
    unlocked &&
    status !== null &&
    describeVaultSyncStatus(status).label === null;

  const vault = deriveVaultHomeState({
    status: handle?.vaultStatus() ?? null,
    unlocked,
    absentEvidence: session?.absentEvidence ?? ABSENT_EVIDENCE_WITHOUT_OWNER,
  });

  const view = buildHomeView({
    now,
    firstName: user?.firstName ?? null,
    vault,
    summary,
    backup,
    youtube,
    synced,
  });

  return isPhone ? (
    <HomePhone view={view} onLock={lockVault} />
  ) : (
    <HomeDesktop view={view} />
  );
}
