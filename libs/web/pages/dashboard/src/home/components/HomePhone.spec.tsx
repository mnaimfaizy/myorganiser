/* eslint-disable import/first */
jest.mock('@myorganiser/auth', () => ({
  ...jest.requireActual('@myorganiser/auth'),
  getCurrentUser: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  ...jest.requireActual('@myorganiser/web-vault-ui'),
  useOptionalVaultSession: jest.fn(),
  useVaultLockState: jest.fn(),
}));

import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { getCurrentUser } from '@myorganiser/auth';
import { useToast } from '@myorganiser/web-ui';
import {
  useOptionalVaultSession,
  useVaultLockState,
} from '@myorganiser/web-vault-ui';
import { useRouter } from 'next/navigation';
import { HomePhone } from './HomePhone';
import {
  buildFixtureView,
  EMPTY_UNLOCKED_SUMMARY,
} from '../testing/home-view-fixtures';

describe('HomePhone', () => {
  const onLock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockReturnValue({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn() });
    (useToast as jest.Mock).mockReturnValue({ toast: jest.fn() });
    (useVaultLockState as jest.Mock).mockReturnValue('unlocked');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      lock: jest.fn(),
    });
  });

  it('shows the first name as the one h1 under the greeting', () => {
    render(<HomePhone view={buildFixtureView()} onLock={onLock} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Ada' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Good morning')).toBeInTheDocument();
  });

  it('shows the Today card with the headline, progress line and an Open link to tasks', () => {
    render(<HomePhone view={buildFixtureView()} onLock={onLock} />);

    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('3 tasks due')).toBeInTheDocument();
    expect(
      within(today).getByText('1 of 3 done · 2 renew this week'),
    ).toBeInTheDocument();
    expect(
      within(today).getByRole('link', { name: "Open today's tasks" }),
    ).toHaveAttribute('href', '/dashboard/tasks');
  });

  it('shows the Synced pill only when the sync line reads healthy', () => {
    const { rerender } = render(
      <HomePhone view={buildFixtureView({ synced: true })} onLock={onLock} />,
    );
    expect(screen.getByText('Synced')).toBeInTheDocument();

    rerender(
      <HomePhone view={buildFixtureView({ synced: false })} onLock={onLock} />,
    );
    expect(screen.queryByText('Synced')).not.toBeInTheDocument();
    // The lock control stays while unlocked, even when the sync is not healthy.
    expect(
      screen.getByRole('button', { name: 'Lock vault' }),
    ).toBeInTheDocument();
  });

  it('calls onLock once when Lock vault is pressed', () => {
    render(<HomePhone view={buildFixtureView()} onLock={onLock} />);

    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }));

    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('opens the quick-add FAB onto the five add flows while unlocked', () => {
    render(
      <HomePhone
        view={buildFixtureView({ summary: EMPTY_UNLOCKED_SUMMARY })}
        onLock={onLock}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Quick add' }), {
      key: 'Enter',
    });

    expect(
      screen.getAllByRole('menuitem').map((item) => item.getAttribute('href')),
    ).toEqual([
      '/dashboard/tasks',
      '/dashboard/groceries',
      '/dashboard/addresses',
      '/dashboard/subscriptions',
      '/dashboard/mobile-numbers',
    ]);
  });

  it('shows the locked card with Unlock and recovery links, and no FAB or lock control, when locked', () => {
    render(
      <HomePhone
        view={buildFixtureView({
          unlocked: false,
          summary: null,
          backup: { status: 'pending' },
        })}
        onLock={onLock}
      />,
    );

    const locked = screen.getByRole('region', { name: 'Vault locked' });
    expect(
      within(locked).getByText('Your data stays encrypted on this device'),
    ).toBeInTheDocument();
    expect(
      within(locked).getByRole('link', { name: 'Unlock' }),
    ).toHaveAttribute('href', '/dashboard/vault');
    expect(
      within(locked).getByRole('link', { name: 'Use recovery key instead' }),
    ).toHaveAttribute('href', '/dashboard/vault');
    expect(
      within(screen.getByRole('banner')).getByText('Locked'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Lock vault' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Quick add' }),
    ).not.toBeInTheDocument();
  });

  it('shows the Today card as nothing due, with no progressbar, when no tasks are due', () => {
    render(
      <HomePhone
        view={buildFixtureView({ summary: EMPTY_UNLOCKED_SUMMARY })}
        onLock={onLock}
      />,
    );

    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('Nothing due today')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows Groceries and Subscriptions tiles and no Tasks tile', () => {
    render(<HomePhone view={buildFixtureView()} onLock={onLock} />);

    expect(screen.getByRole('link', { name: /^Groceries/ })).toHaveAttribute(
      'href',
      '/dashboard/groceries',
    );
    expect(
      screen.getByRole('link', { name: /^Subscriptions/ }),
    ).toHaveAttribute('href', '/dashboard/subscriptions');
    expect(
      screen.queryByRole('link', { name: /^Tasks/ }),
    ).not.toBeInTheDocument();
  });
});
