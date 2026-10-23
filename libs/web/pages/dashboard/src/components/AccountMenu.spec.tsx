/* eslint-disable import/first */
jest.mock('@myorganiser/auth', () => ({
  // isPlatformAdmin is pure, so the real one is used rather than a copy.
  ...jest.requireActual('@myorganiser/auth'),
  getCurrentUser: jest.fn(),
  logout: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  useOptionalVaultSession: jest.fn(),
  useVaultLockState: jest.fn(),
}));

jest.mock('../hooks/use-feedback-dialog', () => ({
  openFeedbackDialog: jest.fn(),
}));

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getCurrentUser, logout } from '@myorganiser/auth';
import { useToast } from '@myorganiser/web-ui';
import { useRouter } from 'next/navigation';
import {
  useOptionalVaultSession,
  useVaultLockState,
} from '@myorganiser/web-vault-ui';
import { openFeedbackDialog } from '../hooks/use-feedback-dialog';
import { AccountMenu } from './AccountMenu';

type Role = 'platform_admin' | 'user';

function stubUser({
  name = 'Ada Lovelace',
  email = 'ada@example.com',
  role = 'platform_admin',
}: { name?: string; email?: string; role?: Role } = {}) {
  (getCurrentUser as jest.Mock).mockReturnValue({ name, email, role });
}

// One state drives both readers, so the lock-state hook and the session the
// menu locks through cannot disagree.
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

function openAccountMenu() {
  const trigger = screen.getByRole('button', { name: /ada@example\.com/ });
  // Radix opens the menu on Enter or Space keydown on the trigger.
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}

async function menuItems() {
  return screen.findAllByRole('menuitem');
}

describe('AccountMenu', () => {
  const push = jest.fn();
  const toast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push });
    (useToast as jest.Mock).mockReturnValue({ toast });
    (logout as jest.Mock).mockResolvedValue(undefined);
    stubUser();
    stubVaultSession('unlocked');
  });

  it('shows the user name and email on the trigger', () => {
    render(<AccountMenu />);

    const trigger = screen.getByRole('button', { name: /ada@example\.com/ });
    expect(trigger).toHaveTextContent('Ada Lovelace');
    expect(trigger).toHaveTextContent('ada@example.com');
  });

  it('lists the menu items in the artboard order for a platform admin with an unlocked session', async () => {
    render(<AccountMenu />);
    openAccountMenu();

    const items = await menuItems();
    expect(items.map((item) => item.textContent)).toEqual([
      'Account settings',
      'Vault and backups',
      'Install the app',
      'Send feedback',
      'Your reports',
      'Admin portal',
      'Lock vault',
      'Log out',
    ]);
  });

  it('points the navigation items at their routes', async () => {
    render(<AccountMenu />);
    openAccountMenu();

    const items = await menuItems();
    const hrefFor = (label: string) =>
      items.find((item) => item.textContent === label)?.getAttribute('href');

    expect(hrefFor('Account settings')).toBe('/dashboard/account');
    expect(hrefFor('Vault and backups')).toBe('/dashboard/vault');
    expect(hrefFor('Install the app')).toBe('/download');
    expect(hrefFor('Your reports')).toBe('/dashboard/account/reports');
    expect(hrefFor('Admin portal')).toBe('/admin');
  });

  it('omits the Admin portal item for a non-admin user', async () => {
    stubUser({ role: 'user' });
    render(<AccountMenu />);
    openAccountMenu();

    await menuItems();
    expect(
      screen.queryByRole('menuitem', { name: 'Admin portal' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Your reports' }),
    ).toBeInTheDocument();
  });

  it('omits Lock vault when the session is locked', async () => {
    stubVaultSession('locked');
    render(<AccountMenu />);
    openAccountMenu();

    await menuItems();
    expect(
      screen.queryByRole('menuitem', { name: 'Lock vault' }),
    ).not.toBeInTheDocument();
  });

  it('omits Lock vault when there is no vault session', async () => {
    stubVaultSession('no-session');
    render(<AccountMenu />);
    openAccountMenu();

    await menuItems();
    expect(
      screen.queryByRole('menuitem', { name: 'Lock vault' }),
    ).not.toBeInTheDocument();
  });

  it('locks the session once when Lock vault is chosen while unlocked', async () => {
    const lock = stubVaultSession('unlocked');
    render(<AccountMenu />);
    openAccountMenu();

    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Lock vault' }),
    );

    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('opens the feedback dialog when Send feedback is chosen', async () => {
    render(<AccountMenu />);
    openAccountMenu();

    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Send feedback' }),
    );

    expect(openFeedbackDialog).toHaveBeenCalledTimes(1);
  });

  it('logs out and then routes to login when Log out is chosen', async () => {
    render(<AccountMenu />);
    openAccountMenu();

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login');
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect((logout as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (push as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it('stays on the page and shows a destructive toast when Log out is rejected', async () => {
    (logout as jest.Mock).mockRejectedValue(new Error('network down'));
    render(<AccountMenu />);
    openAccountMenu();

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: 'Log out failed',
        description: 'You are still signed in. Try again.',
        variant: 'destructive',
      });
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('has no Notifications, Billing or Upgrade to Pro items', async () => {
    render(<AccountMenu />);
    openAccountMenu();

    await menuItems();
    expect(
      screen.queryByRole('menuitem', {
        name: /notifications|billing|upgrade to pro/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('shows two initials from the name in the avatar', () => {
    render(<AccountMenu />);

    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('falls back to the first letter of the email when the name is empty', () => {
    stubUser({ name: '' });
    render(<AccountMenu />);

    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('shows the User icon and no initials in the avatar when the name and email are empty', () => {
    stubUser({ name: '', email: '' });
    const { container } = render(<AccountMenu />);

    // The icon is aria-hidden, so it is found by its lucide class, not by role.
    const icon = container.querySelector('svg.lucide-user');
    expect(icon).toBeInTheDocument();
    expect(icon?.parentElement?.textContent).toBe('');
  });

  it('shows the User icon as the phone trigger fallback when the name and email are empty', () => {
    stubUser({ name: '', email: '' });
    render(<AccountMenu variant="phone" />);

    // The phone trigger is the only button while the menu is closed.
    const trigger = screen.getByRole('button', { name: /Account menu for/ });
    expect(trigger.textContent).toBe('');
    expect(trigger.querySelector('svg.lucide-user')).toBeInTheDocument();
  });

  it('renders the phone trigger as a button named for the account, showing the initials only', () => {
    render(<AccountMenu variant="phone" />);

    const trigger = screen.getByRole('button', {
      name: 'Account menu for Ada Lovelace',
    });
    expect(trigger.textContent).toBe('AL');
    expect(trigger).not.toHaveTextContent('ada@example.com');
  });

  it('names the phone trigger by the email when the name is empty, showing its first letter', () => {
    stubUser({ name: '' });
    render(<AccountMenu variant="phone" />);

    const trigger = screen.getByRole('button', {
      name: 'Account menu for ada@example.com',
    });
    expect(trigger.textContent).toBe('A');
  });

  it('opens the same account menu from the phone trigger', async () => {
    render(<AccountMenu variant="phone" />);
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Account menu for Ada Lovelace' }),
      { key: 'Enter' },
    );

    const items = await menuItems();
    expect(items.map((item) => item.textContent)).toEqual([
      'Account settings',
      'Vault and backups',
      'Install the app',
      'Send feedback',
      'Your reports',
      'Admin portal',
      'Lock vault',
      'Log out',
    ]);
  });

  it('keeps the header trigger with its name and email by default', () => {
    render(<AccountMenu />);

    expect(
      screen.queryByRole('button', { name: /Account menu for/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /ada@example\.com/ }),
    ).toHaveTextContent('Ada Lovelace');
  });
});
