/* eslint-disable import/first */
jest.mock('@myorganiser/web-vault-ui', () => ({
  ...jest.requireActual('@myorganiser/web-vault-ui'),
  useOptionalVaultSession: jest.fn(),
  useVaultLockState: jest.fn(),
  useVaultSyncStatus: jest.fn(),
}));

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { VaultBlobType } from '@myorganiser/app-api-client';
import {
  describeVaultSyncStatus,
  useOptionalVaultSession,
  useVaultLockState,
  useVaultSyncStatus,
} from '@myorganiser/web-vault-ui';
import { SidebarVaultCard } from './SidebarVaultCard';

type SyncStatus = NonNullable<Parameters<typeof describeVaultSyncStatus>[0]>;

const SYNCED: SyncStatus = {
  kind: 'synced',
  pendingTypes: [],
  terminalFailures: [],
  retrying: false,
};

const PENDING: SyncStatus = {
  kind: 'pending',
  pendingTypes: [VaultBlobType.Tasks],
  terminalFailures: [],
  retrying: false,
};

// One state drives both readers, so the lock-state hook and the session the
// card locks through cannot disagree.
function stubVaultSession(state: 'unlocked' | 'locked' | 'no-session') {
  const lock = jest.fn();
  (useOptionalVaultSession as jest.Mock).mockReturnValue(
    state === 'no-session'
      ? null
      : {
          masterKeyBytes: state === 'unlocked' ? new Uint8Array(32) : null,
          lock,
        },
  );
  (useVaultLockState as jest.Mock).mockReturnValue(state);
  return lock;
}

function stubSyncStatus(status: SyncStatus | null) {
  (useVaultSyncStatus as jest.Mock).mockReturnValue({
    status,
    retry: jest.fn(),
  });
}

describe('SidebarVaultCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubVaultSession('unlocked');
    stubSyncStatus(SYNCED);
  });

  it('renders nothing without a vault session', () => {
    stubVaultSession('no-session');
    const { container } = render(<SidebarVaultCard />);

    expect(container).toBeEmptyDOMElement();
  });

  describe('unlocked', () => {
    it('shows Vault unlocked and a Lock vault button that locks the session once', () => {
      const lock = stubVaultSession('unlocked');
      render(<SidebarVaultCard />);

      expect(screen.getByText('Vault unlocked')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }));

      expect(lock).toHaveBeenCalledTimes(1);
    });

    it('shows the sync status label as the meta line when there is one', () => {
      stubSyncStatus(PENDING);
      render(<SidebarVaultCard />);

      expect(screen.getByText('Changes not yet sent')).toBeInTheDocument();
    });

    it('shows Synced as the meta line while the sync status is synced', () => {
      stubSyncStatus(SYNCED);
      render(<SidebarVaultCard />);

      expect(screen.getByText('Synced')).toBeVisible();
    });

    it('shows no meta line before the first sync reading', () => {
      stubSyncStatus(null);
      render(<SidebarVaultCard />);

      expect(screen.getByText('Vault unlocked')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Lock vault' }),
      ).toBeInTheDocument();
      expect(screen.queryByText('Synced')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Changes not yet sent'),
      ).not.toBeInTheDocument();
    });
  });

  describe('locked', () => {
    it('shows Vault locked, the encryption note, and an Unlock link to the vault page', () => {
      stubVaultSession('locked');
      render(<SidebarVaultCard />);

      expect(screen.getByText('Vault locked')).toBeInTheDocument();
      expect(
        screen.getByText('Your data stays encrypted on this device'),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Unlock' })).toHaveAttribute(
        'href',
        '/dashboard/vault',
      );
      expect(screen.queryByText('Synced')).not.toBeInTheDocument();
    });
  });
});
