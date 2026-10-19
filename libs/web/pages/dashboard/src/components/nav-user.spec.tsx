/* eslint-disable import/first */
const mockPush = jest.fn();
// Stable router reference, matching next/navigation.
const mockRouter = { push: mockPush };

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

jest.mock('@myorganiser/auth', () => ({
  logout: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useSidebar: jest.fn(),
}));

jest.mock('../hooks/use-feedback-dialog', () => ({
  openFeedbackDialog: jest.fn(),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { logout } from '@myorganiser/auth';
import { SidebarProvider, useSidebar } from '@myorganiser/web-ui';
import { openFeedbackDialog } from '../hooks/use-feedback-dialog';
import { NavUser } from './nav-user';

const user = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  avatar: '',
};

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

// The real SidebarProvider is required by SidebarMenuButton; its useIsMobile
// reads window.matchMedia, which jsdom does not provide.
function stubMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
}

function renderNavUser() {
  return render(
    <SidebarProvider>
      <NavUser user={user} />
    </SidebarProvider>,
  );
}

function openUserMenu() {
  const trigger = screen.getByRole('button', { name: /ada@example\.com/ });
  // Radix opens the menu on Enter/Space keydown on the trigger.
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}

describe('NavUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubMatchMedia();
    (logout as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('should navigate to the account page and close the mobile drawer when Account is chosen', async () => {
    const sidebar = stubSidebar(true);

    renderNavUser();
    const trigger = openUserMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Account' }));

    expect(mockPush).toHaveBeenCalledWith('/dashboard/account');
    expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(
        screen.queryByRole('menuitem', { name: 'Account' }),
      ).not.toBeInTheDocument();
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('should log out, navigate to login, and close the mobile drawer when Log out is chosen', async () => {
    const sidebar = stubSidebar(true);

    renderNavUser();
    const trigger = openUserMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('should navigate and close the menu without touching the drawer on desktop', async () => {
    const sidebar = stubSidebar(false);

    renderNavUser();
    const trigger = openUserMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Account' }));

    expect(mockPush).toHaveBeenCalledWith('/dashboard/account');
    expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('Send feedback menu item', () => {
    it('should open the feedback dialog when Send feedback is chosen', async () => {
      stubSidebar(true);

      renderNavUser();
      openUserMenu();
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Send feedback' }),
      );

      expect(openFeedbackDialog).toHaveBeenCalledTimes(1);
    });

    it('should close the mobile drawer when Send feedback is chosen', async () => {
      const sidebar = stubSidebar(true);

      renderNavUser();
      const trigger = openUserMenu();
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Send feedback' }),
      );

      expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
      await waitFor(() => {
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
      });
    });

    it('should not close the drawer on desktop when Send feedback is chosen', async () => {
      const sidebar = stubSidebar(false);

      renderNavUser();
      openUserMenu();
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Send feedback' }),
      );

      expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
    });
  });
});
