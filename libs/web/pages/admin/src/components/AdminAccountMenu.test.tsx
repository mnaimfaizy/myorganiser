/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

const mockPush = jest.fn();
// Stable router reference, matching next/navigation.
const mockRouter = { push: mockPush };

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

jest.mock('@myorganiser/auth', () => ({
  getCurrentUser: jest.fn(),
  logout: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useSidebar: jest.fn(),
  useToast: jest.fn(),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCurrentUser, logout } from '@myorganiser/auth';
import { useSidebar, useToast } from '@myorganiser/web-ui';

import { AdminAccountMenu } from './AdminAccountMenu';

const adminUser = { name: 'Test Admin', email: 'admin@example.com' };
const mockToast = jest.fn();

function stubSidebar(isMobile: boolean) {
  const sidebar = {
    state: 'expanded',
    open: true,
    isMobile,
    openMobile: false,
    setOpen: jest.fn(),
    setOpenMobile: jest.fn(),
    toggleSidebar: jest.fn(),
  };
  (useSidebar as jest.Mock).mockReturnValue(sidebar);
  return sidebar;
}

function openMenu(trigger: HTMLElement) {
  // Radix opens the menu on Enter/Space keydown on the trigger.
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('AdminAccountMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockReturnValue(adminUser);
    (logout as jest.Mock).mockResolvedValue(undefined);
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    stubSidebar(false);
  });

  it('should show the name and email on the header trigger', () => {
    render(<AdminAccountMenu variant="header" />);

    const trigger = screen.getByRole('button');

    expect(trigger).toHaveTextContent('Test Admin');
    expect(trigger).toHaveTextContent('admin@example.com');
  });

  it('should label the phone trigger with the user name', () => {
    render(<AdminAccountMenu variant="phone" />);

    expect(
      screen.getByRole('button', { name: 'Account menu for Test Admin' }),
    ).toBeInTheDocument();
  });

  it('should fall back to the email in the phone trigger label when the name is empty', () => {
    (getCurrentUser as jest.Mock).mockReturnValue({
      name: '',
      email: 'admin@example.com',
    });

    render(<AdminAccountMenu variant="phone" />);

    expect(
      screen.getByRole('button', {
        name: 'Account menu for admin@example.com',
      }),
    ).toBeInTheDocument();
  });

  it('should offer Log out when the menu is opened', async () => {
    render(<AdminAccountMenu variant="header" />);

    openMenu(screen.getByRole('button'));

    expect(
      await screen.findByRole('menuitem', { name: 'Log out' }),
    ).toBeInTheDocument();
  });

  it('should log out and then navigate to login on success', async () => {
    render(<AdminAccountMenu variant="header" />);

    openMenu(screen.getByRole('button'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect((logout as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      mockPush.mock.invocationCallOrder[0],
    );
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('should close the mobile drawer when Log out is chosen', async () => {
    const sidebar = stubSidebar(true);

    render(<AdminAccountMenu variant="phone" />);

    openMenu(
      screen.getByRole('button', { name: 'Account menu for Test Admin' }),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
  });

  it('should log out without touching the drawer on desktop', async () => {
    const sidebar = stubSidebar(false);

    render(<AdminAccountMenu variant="header" />);

    openMenu(screen.getByRole('button'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
  });

  it('should stay on the page and show a destructive toast when the sign-out is rejected', async () => {
    (logout as jest.Mock).mockRejectedValue(new Error('network down'));

    render(<AdminAccountMenu variant="header" />);

    openMenu(screen.getByRole('button'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Log out failed',
        description: 'You are still signed in. Try again.',
        variant: 'destructive',
      });
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
