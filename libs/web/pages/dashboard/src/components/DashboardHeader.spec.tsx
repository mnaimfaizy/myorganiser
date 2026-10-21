/* eslint-disable import/first */
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useSidebar: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  ...jest.requireActual('@myorganiser/web-vault-ui'),
  useOptionalVaultSession: jest.fn(),
  useVaultSyncStatus: jest.fn(),
  // The real widget reads its own module-local status hook, which the barrel
  // mock cannot reach. The header only decides its className, so the widget
  // is stubbed to a marker that exposes that className.
  SyncStatusWidget: ({ className }: { className?: string }) => (
    <div data-testid="sync-status-widget" className={className} />
  ),
}));

// The account menu has its own spec; here it is a marker.
jest.mock('./AccountMenu', () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { VaultBlobType } from '@myorganiser/app-api-client';
import { TooltipProvider, useSidebar } from '@myorganiser/web-ui';
import {
  describeVaultSyncStatus,
  useOptionalVaultSession,
  useVaultSyncStatus,
} from '@myorganiser/web-vault-ui';
import { DashboardHeader } from './DashboardHeader';

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

const SESSION_ENDED: SyncStatus = {
  kind: 'session-ended',
  pendingTypes: [],
  terminalFailures: [],
  retrying: false,
};

function stubSidebar({
  isMobile = false,
  state = 'expanded',
}: {
  isMobile?: boolean;
  state?: 'expanded' | 'collapsed';
} = {}) {
  const sidebar = {
    state,
    open: state === 'expanded',
    isMobile,
    openMobile: false,
    setOpen: jest.fn(),
    setOpenMobile: jest.fn(),
    toggleSidebar: jest.fn(),
  };
  (useSidebar as jest.Mock).mockReturnValue(sidebar);
  return sidebar;
}

function stubVaultSession(state: 'unlocked' | 'locked' | 'no-session') {
  (useOptionalVaultSession as jest.Mock).mockReturnValue(
    state === 'no-session'
      ? null
      : {
          masterKeyBytes: state === 'unlocked' ? new Uint8Array(32) : null,
        },
  );
}

function stubSyncStatus(status: SyncStatus | null) {
  (useVaultSyncStatus as jest.Mock).mockReturnValue({
    status,
    retry: jest.fn(),
  });
}

function renderHeader() {
  return render(
    <TooltipProvider>
      <DashboardHeader />
    </TooltipProvider>,
  );
}

describe('DashboardHeader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (usePathname as jest.Mock).mockReturnValue('/dashboard');
    stubSidebar();
    stubVaultSession('unlocked');
    stubSyncStatus(SYNCED);
  });

  describe('title', () => {
    it('shows Home at the dashboard root, with or without a trailing slash', () => {
      const { unmount } = renderHeader();
      expect(screen.getByText('Home')).toBeInTheDocument();
      unmount();

      (usePathname as jest.Mock).mockReturnValue('/dashboard/');
      renderHeader();
      expect(screen.getByText('Home')).toBeInTheDocument();
    });

    it('shows the last breadcrumb label on a section page', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/groceries');
      renderHeader();

      // The breadcrumb also ends in Groceries, so the title is the paragraph.
      expect(
        screen.getByText('Groceries', { selector: 'p' }),
      ).toBeInTheDocument();
    });

    it('renders no heading role, because each page keeps its own h1', () => {
      renderHeader();

      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });
  });

  it('renders the breadcrumb navigation', () => {
    renderHeader();

    expect(
      screen.getByRole('navigation', { name: 'breadcrumb' }),
    ).toBeInTheDocument();
  });

  describe('sidebar toggle', () => {
    it('is labelled Collapse sidebar while the sidebar is expanded', () => {
      stubSidebar({ state: 'expanded' });
      renderHeader();

      expect(
        screen.getByRole('button', { name: 'Collapse sidebar' }),
      ).toBeInTheDocument();
    });

    it('is labelled Expand sidebar while the sidebar is collapsed', () => {
      stubSidebar({ state: 'collapsed' });
      renderHeader();

      expect(
        screen.getByRole('button', { name: 'Expand sidebar' }),
      ).toBeInTheDocument();
    });

    it('is labelled Open sidebar on mobile', () => {
      stubSidebar({ isMobile: true });
      renderHeader();

      expect(
        screen.getByRole('button', { name: 'Open sidebar' }),
      ).toBeInTheDocument();
    });

    it('calls toggleSidebar when clicked', () => {
      const sidebar = stubSidebar();
      renderHeader();

      fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

      expect(sidebar.toggleSidebar).toHaveBeenCalledTimes(1);
    });
  });

  describe('vault state chip', () => {
    it('shows Vault locked and hides the live widget visually when the session is locked', () => {
      stubVaultSession('locked');
      renderHeader();

      expect(screen.getByText('Vault locked')).toBeInTheDocument();
      expect(screen.getByTestId('sync-status-widget')).toHaveClass('sr-only');
    });

    it('shows Synced and hides the live widget visually when the sync status is synced', () => {
      renderHeader();

      expect(screen.getByText('Synced')).toBeInTheDocument();
      expect(screen.getByTestId('sync-status-widget')).toHaveClass('sr-only');
    });

    it('shows no chip for a sync status that is not synced, and shows the widget visibly', () => {
      stubSyncStatus(PENDING);
      renderHeader();

      expect(screen.queryByText('Synced')).not.toBeInTheDocument();
      expect(screen.queryByText('Vault locked')).not.toBeInTheDocument();
      expect(screen.getByTestId('sync-status-widget')).not.toHaveClass(
        'sr-only',
      );
    });

    it('shows no chip for a session-ended status, and shows the widget visibly', () => {
      stubSyncStatus(SESSION_ENDED);
      renderHeader();

      expect(screen.queryByText('Synced')).not.toBeInTheDocument();
      expect(screen.queryByText('Vault locked')).not.toBeInTheDocument();
      expect(screen.getByTestId('sync-status-widget')).not.toHaveClass(
        'sr-only',
      );
    });

    it('shows no chip and a visible widget while the first sync reading is still null', () => {
      stubSyncStatus(null);
      renderHeader();

      expect(screen.queryByText('Synced')).not.toBeInTheDocument();
      expect(screen.queryByText('Vault locked')).not.toBeInTheDocument();
      expect(screen.getByTestId('sync-status-widget')).not.toHaveClass(
        'sr-only',
      );
    });
  });

  it('has no search box and no notifications control', () => {
    renderHeader();

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /notification/i }),
    ).not.toBeInTheDocument();
  });
});
