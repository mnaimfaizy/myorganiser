/* eslint-disable import/first */
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  // The drawing is decorative SVG with no role. The header only decides
  // whether it mounts, so the illustration is stubbed to a marker carrying its kind.
  Illustration: ({ kind }: { kind: string }) => (
    <div data-testid="illustration" data-kind={kind} />
  ),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  ...jest.requireActual('@myorganiser/web-vault-ui'),
  useOptionalVaultSession: jest.fn(),
  useVaultLockState: jest.fn(),
  useVaultSyncStatus: jest.fn(),
  // The real widget reads its own module-local status hook, which the barrel
  // mock cannot reach. The bar only decides its className, so the widget is
  // stubbed to a marker that exposes that className.
  SyncStatusWidget: ({ className }: { className?: string }) => (
    <div data-testid="sync-status-widget" className={className} />
  ),
}));

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { TooltipProvider } from '@myorganiser/web-ui';
import {
  describeVaultSyncStatus,
  useOptionalVaultSession,
  useVaultLockState,
  useVaultSyncStatus,
} from '@myorganiser/web-vault-ui';
import { PhoneAppBar } from './PhoneAppBar';

type SyncStatus = NonNullable<Parameters<typeof describeVaultSyncStatus>[0]>;

const SYNCED: SyncStatus = {
  kind: 'synced',
  pendingTypes: [],
  terminalFailures: [],
  retrying: false,
};

const lock = jest.fn();

function stubVaultLockState(state: 'unlocked' | 'locked' | 'no-session') {
  (useVaultLockState as jest.Mock).mockReturnValue(state);
  (useOptionalVaultSession as jest.Mock).mockReturnValue({ lock });
}

function stubSyncStatus(status: SyncStatus | null) {
  (useVaultSyncStatus as jest.Mock).mockReturnValue({
    status,
    retry: jest.fn(),
  });
}

function renderAppBar(pathname: string) {
  (usePathname as jest.Mock).mockReturnValue(pathname);
  return render(
    <TooltipProvider>
      <PhoneAppBar />
    </TooltipProvider>,
  );
}

/**
 * The compact bar that appears once the large title scrolls away is not
 * covered here: it needs an IntersectionObserver, which jsdom does not provide,
 * so the header never leaves its unscrolled state. It is checked in the browser.
 */
describe('PhoneAppBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubSyncStatus(null);
    stubVaultLockState('unlocked');
  });

  it('draws no title row, illustration, or lock button on the More root even when unlocked', () => {
    renderAppBar('/dashboard/more');

    expect(screen.getByTestId('sync-status-widget')).toBeInTheDocument();
    expect(screen.queryByText('More')).not.toBeInTheDocument();
    expect(screen.queryByTestId('illustration')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Lock vault' }),
    ).not.toBeInTheDocument();
  });

  it('draws no title row, illustration, or lock button on the Home root when unlocked', () => {
    renderAppBar('/dashboard');

    expect(screen.getByTestId('sync-status-widget')).toBeInTheDocument();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.queryByTestId('illustration')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Lock vault' }),
    ).not.toBeInTheDocument();
  });

  it('draws no title row or lock button on the Home root when the vault is locked', () => {
    stubVaultLockState('locked');
    renderAppBar('/dashboard');

    expect(screen.getByTestId('sync-status-widget')).toBeInTheDocument();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Lock vault' }),
    ).not.toBeInTheDocument();
  });

  it('shows the title row with its illustration and the lock button on the Tasks root when unlocked', () => {
    renderAppBar('/dashboard/tasks');

    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByTestId('illustration')).toHaveAttribute(
      'data-kind',
      'tasks',
    );
    expect(
      screen.getByRole('button', { name: 'Lock vault' }),
    ).toBeInTheDocument();
  });

  it('locks the vault once when Lock vault is pressed on the unlocked Tasks root', () => {
    renderAppBar('/dashboard/tasks');

    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }));

    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('shows no Lock vault button on the Tasks root when the vault is locked', () => {
    stubVaultLockState('locked');
    renderAppBar('/dashboard/tasks');

    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Lock vault' }),
    ).not.toBeInTheDocument();
  });

  it('hides the sync widget visually when the status is healthy', () => {
    stubSyncStatus(SYNCED);
    // Guard: the healthy fixture must be one the bar reads as healthy.
    expect(describeVaultSyncStatus(SYNCED).label).toBeNull();
    renderAppBar('/dashboard');

    expect(screen.getByTestId('sync-status-widget')).toHaveClass('sr-only');
  });

  it('links a pushed Account screen back to More', () => {
    renderAppBar('/dashboard/account');

    expect(screen.getByRole('link', { name: 'Back to More' })).toHaveAttribute(
      'href',
      '/dashboard/more',
    );
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('renders no title paragraph on a pushed screen with no title of its own', () => {
    const { container } = renderAppBar('/dashboard/groceries/abc123');

    expect(
      screen.getByRole('link', { name: 'Back to Groceries' }),
    ).toHaveAttribute('href', '/dashboard/groceries');
    expect(container.querySelector('p')).toBeNull();
  });
});
