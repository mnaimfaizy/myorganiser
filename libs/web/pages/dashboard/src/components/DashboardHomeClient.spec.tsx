/* eslint-disable import/first */
jest.mock('@myorganiser/auth', () => ({
  ...jest.requireActual('@myorganiser/auth'),
  getCurrentUser: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  ...jest.requireActual('@myorganiser/web-vault-ui'),
  useOptionalVaultSession: jest.fn(),
  useVaultSyncStatus: jest.fn(),
}));

jest.mock('../home/hooks/use-home-summary', () => ({
  useHomeSummary: jest.fn(),
}));

jest.mock('../home/hooks/use-latest-backup-summary', () => ({
  useLatestBackupSummary: jest.fn(),
}));

jest.mock('../home/hooks/use-youtube-home', () => ({
  useYouTubeHome: jest.fn(),
}));

// The layouts are covered by their own specs. Here each stands in as a marker
// that exposes the view and the lock wiring the client hands it.
jest.mock('../home/components/HomeDesktop', () => ({
  HomeDesktop: ({
    view,
  }: {
    view: {
      unlocked: boolean;
      vaultPrompt: { heroActions: readonly { label: string }[] } | null;
    };
  }) => (
    <div
      data-testid="home-desktop"
      data-unlocked={String(view.unlocked)}
      data-hero-action={view.vaultPrompt?.heroActions[0]?.label ?? ''}
    />
  ),
}));

jest.mock('../home/components/HomePhone', () => ({
  HomePhone: ({
    view,
    onLock,
  }: {
    view: { firstName: string; synced: boolean };
    onLock: () => void;
  }) => (
    <div
      data-testid="home-phone"
      data-first-name={view.firstName}
      data-synced={String(view.synced)}
    >
      <button type="button" onClick={onLock}>
        Lock from phone
      </button>
    </div>
  ),
}));

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { getCurrentUser } from '@myorganiser/auth';
import { useIsMobileState } from '@myorganiser/web-ui';
import {
  useOptionalVaultSession,
  useVaultSyncStatus,
} from '@myorganiser/web-vault-ui';
import { useHomeSummary } from '../home/hooks/use-home-summary';
import { useLatestBackupSummary } from '../home/hooks/use-latest-backup-summary';
import { useYouTubeHome } from '../home/hooks/use-youtube-home';
import { DashboardHomeClient } from './DashboardHomeClient';

const HEALTHY_SYNC = {
  kind: 'synced',
  pendingTypes: [],
  terminalFailures: [],
  retrying: false,
};

const lock = jest.fn();

type AbsentEvidence =
  | { status: 'checking' }
  | { status: 'settled'; result: { kind: 'no-server-vault' } };

function stubVault({
  unlocked,
  syncStatus = null,
  status = 'owned',
  absentEvidence = { status: 'checking' },
}: {
  unlocked: boolean;
  syncStatus?: typeof HEALTHY_SYNC | null;
  status?: 'owned' | 'absent';
  absentEvidence?: AbsentEvidence;
}) {
  const handle = { isUnlocked: unlocked, vaultStatus: () => status };
  (useOptionalVaultSession as jest.Mock).mockReturnValue({
    handle,
    lock,
    absentEvidence,
  });
  (useVaultSyncStatus as jest.Mock).mockReturnValue({
    status: syncStatus,
    retry: jest.fn(),
  });
  return handle;
}

describe('DashboardHomeClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockReturnValue({
      firstName: 'Ada',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    (useHomeSummary as jest.Mock).mockReturnValue({
      now: new Date(2026, 9, 21, 9, 30),
      summary: null,
    });
    (useLatestBackupSummary as jest.Mock).mockReturnValue({
      status: 'pending',
    });
    (useYouTubeHome as jest.Mock).mockReturnValue({
      visible: false,
      state: { status: 'disconnected' },
    });
    stubVault({ unlocked: true, syncStatus: HEALTHY_SYNC });
  });

  it('renders nothing until the breakpoint is known', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(undefined);

    const { container } = render(<DashboardHomeClient />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('home-desktop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-phone')).not.toBeInTheDocument();
  });

  it('renders the desktop layout, with the unlocked view, on a wide breakpoint', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(false);

    render(<DashboardHomeClient />);

    expect(screen.getByTestId('home-desktop')).toHaveAttribute(
      'data-unlocked',
      'true',
    );
    expect(screen.queryByTestId('home-phone')).not.toBeInTheDocument();
  });

  it('renders the phone layout with the first name and a Synced state on a phone breakpoint', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(true);

    render(<DashboardHomeClient />);

    const phone = screen.getByTestId('home-phone');
    expect(phone).toHaveAttribute('data-first-name', 'Ada');
    expect(phone).toHaveAttribute('data-synced', 'true');
    expect(screen.queryByTestId('home-desktop')).not.toBeInTheDocument();
  });

  it('locks the vault session when the phone layout asks to lock', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(true);

    render(<DashboardHomeClient />);
    fireEvent.click(screen.getByRole('button', { name: 'Lock from phone' }));

    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('reports not synced when the sync status has not been read', () => {
    stubVault({ unlocked: true, syncStatus: null });
    (useIsMobileState as jest.Mock).mockReturnValue(true);

    render(<DashboardHomeClient />);

    expect(screen.getByTestId('home-phone')).toHaveAttribute(
      'data-synced',
      'false',
    );
  });

  it('reports not synced on phone when the vault is locked', () => {
    stubVault({ unlocked: false, syncStatus: HEALTHY_SYNC });
    (useIsMobileState as jest.Mock).mockReturnValue(true);

    render(<DashboardHomeClient />);

    expect(screen.getByTestId('home-phone')).toHaveAttribute(
      'data-synced',
      'false',
    );
  });

  it('shows the locked desktop layout when the vault is locked', () => {
    stubVault({ unlocked: false });
    (useIsMobileState as jest.Mock).mockReturnValue(false);

    render(<DashboardHomeClient />);

    expect(screen.getByTestId('home-desktop')).toHaveAttribute(
      'data-unlocked',
      'false',
    );
  });

  it('reads the summary through the session handle, and the latest backup only while unlocked', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    const unlockedHandle = stubVault({ unlocked: true });

    const { unmount } = render(<DashboardHomeClient />);

    expect(useHomeSummary).toHaveBeenLastCalledWith(unlockedHandle);
    expect(useLatestBackupSummary).toHaveBeenLastCalledWith(true);
    unmount();

    const lockedHandle = stubVault({ unlocked: false });
    render(<DashboardHomeClient />);

    expect(useHomeSummary).toHaveBeenLastCalledWith(lockedHandle);
    expect(useLatestBackupSummary).toHaveBeenLastCalledWith(false);
  });

  it('offers Unlock vault when this device holds a locked Vault', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    stubVault({ unlocked: false, status: 'owned' });

    render(<DashboardHomeClient />);

    expect(screen.getByTestId('home-desktop')).toHaveAttribute(
      'data-hero-action',
      'Unlock vault',
    );
  });

  it('offers Create your vault once the server has proved it holds no Vault', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    stubVault({
      unlocked: false,
      status: 'absent',
      absentEvidence: {
        status: 'settled',
        result: { kind: 'no-server-vault' },
      },
    });

    render(<DashboardHomeClient />);

    expect(screen.getByTestId('home-desktop')).toHaveAttribute(
      'data-hero-action',
      'Create your vault',
    );
  });

  it('offers only Open vault while the server question is still out', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    stubVault({
      unlocked: false,
      status: 'absent',
      absentEvidence: { status: 'checking' },
    });

    render(<DashboardHomeClient />);

    expect(screen.getByTestId('home-desktop')).toHaveAttribute(
      'data-hero-action',
      'Open vault',
    );
  });

  it('offers only Open vault, never create, when there is no Vault Session yet', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    (useOptionalVaultSession as jest.Mock).mockReturnValue(null);

    render(<DashboardHomeClient />);

    expect(screen.getByTestId('home-desktop')).toHaveAttribute(
      'data-hero-action',
      'Open vault',
    );
  });
});
