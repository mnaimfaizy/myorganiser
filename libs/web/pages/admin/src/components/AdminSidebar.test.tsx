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
  // The top-level Sidebar branches on the real context (Sheet on phone width).
  // Stub it so the mocked isMobile value is the only width signal under test.
  Sidebar: (props: React.ComponentProps<'div'>) => (
    <div data-testid="sidebar">{props.children}</div>
  ),
  AppLogo: () => <div data-testid="app-logo" />,
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCurrentUser, logout } from '@myorganiser/auth';
import { SidebarProvider, useSidebar } from '@myorganiser/web-ui';
import { AdminSidebar } from './AdminSidebar';

const adminUser = { name: 'Test Admin', email: 'admin@example.com' };

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

// jsdom cannot navigate; without this it logs "Not implemented: navigation" for
// every admin link click. Only anchor activation is blocked, not React handlers.
function preventAnchorNavigation(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('a[href]')) {
    event.preventDefault();
  }
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

function renderAdminSidebar() {
  return render(
    <SidebarProvider>
      <AdminSidebar />
    </SidebarProvider>,
  );
}

function openUserMenu() {
  const trigger = screen.getByRole('button', { name: /admin@example\.com/ });
  // Radix opens the menu on Enter/Space keydown on the trigger.
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}

describe('AdminSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubMatchMedia();
    (getCurrentUser as jest.Mock).mockReturnValue(adminUser);
    (logout as jest.Mock).mockResolvedValue(undefined);
    document.addEventListener('click', preventAnchorNavigation);
  });

  afterEach(() => {
    document.removeEventListener('click', preventAnchorNavigation);
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('should close the mobile drawer when an admin nav link is chosen', () => {
    const sidebar = stubSidebar(true);

    renderAdminSidebar();
    fireEvent.click(screen.getByRole('link', { name: 'Users' }));

    expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
    expect(sidebar.setOpen).not.toHaveBeenCalled();
  });

  it('should log out, navigate to login, and close the mobile drawer when Log out is chosen', async () => {
    const sidebar = stubSidebar(true);

    renderAdminSidebar();
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

  it('should not touch drawer state on desktop when an admin nav link is chosen', () => {
    const sidebar = stubSidebar(false);

    renderAdminSidebar();
    fireEvent.click(screen.getByRole('link', { name: 'Users' }));

    expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
    expect(sidebar.setOpen).not.toHaveBeenCalled();
  });

  it('should render Feedback nav link with correct href', () => {
    stubSidebar(false);

    renderAdminSidebar();
    const feedbackLink = screen.getByRole('link', { name: 'Feedback' });

    expect(feedbackLink).toBeInTheDocument();
    expect(feedbackLink).toHaveAttribute('href', '/admin/feedback');
  });
});
