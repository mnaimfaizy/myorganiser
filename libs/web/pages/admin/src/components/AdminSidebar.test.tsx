/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

const mockPush = jest.fn();
// Stable router reference, matching next/navigation.
const mockRouter = { push: mockPush };
const mockPathname = jest.fn(() => '/admin');

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname(),
}));

jest.mock('../hooks/use-admin-overview', () => ({
  useAdminOverview: jest.fn(),
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

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { AdminOverviewResponse } from '@myorganiser/app-api-client';
import { SidebarProvider, useSidebar } from '@myorganiser/web-ui';

import { useAdminOverview } from '../hooks/use-admin-overview';

import { AdminSidebar } from './AdminSidebar';

function stubSidebar(
  isMobile: boolean,
  state: 'expanded' | 'collapsed' = 'expanded',
) {
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

function stubOverview(overview: AdminOverviewResponse | null) {
  (useAdminOverview as jest.Mock).mockReturnValue({
    overview,
    loading: overview === null,
    error: false,
    reload: jest.fn(),
  });
}

function overviewWith(counts: {
  unverified: number;
  feedbackReportsReceived: number;
}): AdminOverviewResponse {
  return {
    users: 40,
    usersJoinedLast7Days: 3,
    platformAdmins: 2,
    unverifiedOverAWeek: 0,
    disabled: 1,
    youtubeAccessPlacesUsed: 0,
    youtubeAccessPlacesLeft: 0,
    youtubeAccessCeiling: 0,
    ...counts,
  };
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

function adminNav() {
  return screen.getByRole('navigation', { name: 'Admin sections' });
}

describe('AdminSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubMatchMedia();
    mockPathname.mockReturnValue('/admin');
    stubOverview(null);
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

  it('should not touch drawer state on desktop when an admin nav link is chosen', () => {
    const sidebar = stubSidebar(false);

    renderAdminSidebar();
    fireEvent.click(screen.getByRole('link', { name: 'Users' }));

    expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
    expect(sidebar.setOpen).not.toHaveBeenCalled();
  });

  it('should list the four admin sections in nav order', () => {
    stubSidebar(false);

    renderAdminSidebar();
    const links = within(adminNav()).getAllByRole('link');

    expect(links.map((link) => link.textContent)).toEqual([
      'Overview',
      'Users',
      'Audit log',
      'Feedback',
    ]);
  });

  it('should mark Overview as the current page at /admin', () => {
    stubSidebar(false);

    renderAdminSidebar();

    expect(
      within(adminNav()).getByRole('link', { name: 'Overview' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(adminNav()).getByRole('link', { name: 'Users' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('should mark Users as the current page at /admin/users/123', () => {
    stubSidebar(false);
    mockPathname.mockReturnValue('/admin/users/123');

    renderAdminSidebar();

    expect(
      within(adminNav()).getByRole('link', { name: 'Users' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(adminNav()).getByRole('link', { name: 'Overview' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('should render Feedback nav link with correct href', () => {
    stubSidebar(false);

    renderAdminSidebar();
    const feedbackLink = screen.getByRole('link', { name: 'Feedback' });

    expect(feedbackLink).toHaveAttribute('href', '/admin/feedback');
  });

  it('should show the unverified count on Users and the received reports on Feedback', () => {
    stubSidebar(false);
    stubOverview(overviewWith({ unverified: 12, feedbackReportsReceived: 5 }));

    renderAdminSidebar();

    expect(
      within(adminNav()).getByRole('link', { name: /Users/ }),
    ).toHaveTextContent('12');
    expect(
      within(adminNav()).getByRole('link', { name: /Feedback/ }),
    ).toHaveTextContent('5');
  });

  it('should render no badge for zero counts', () => {
    stubSidebar(false);
    stubOverview(overviewWith({ unverified: 0, feedbackReportsReceived: 0 }));

    renderAdminSidebar();

    expect(
      within(adminNav()).getByRole('link', { name: 'Users' }),
    ).toHaveTextContent(/^Users$/);
    expect(
      within(adminNav()).getByRole('link', { name: 'Feedback' }),
    ).toHaveTextContent(/^Feedback$/);
  });

  it('should render no badges while the overview is still loading', () => {
    stubSidebar(false);
    stubOverview(null);

    renderAdminSidebar();

    expect(
      within(adminNav()).getByRole('link', { name: 'Users' }),
    ).toHaveTextContent(/^Users$/);
    expect(
      within(adminNav()).getByRole('link', { name: 'Feedback' }),
    ).toHaveTextContent(/^Feedback$/);
  });

  it('should link the footer back to the personal dashboard', () => {
    stubSidebar(false);

    renderAdminSidebar();

    expect(
      screen.getByRole('link', { name: 'Back to MyOrganiser' }),
    ).toHaveAttribute('href', '/dashboard');
  });

  it('should render the collapsed rail as labelled icon links', () => {
    stubSidebar(false, 'collapsed');

    renderAdminSidebar();

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'href',
      '/admin',
    );
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
    expect(screen.getByRole('link', { name: 'Audit log' })).toHaveAttribute(
      'href',
      '/admin/audit-logs',
    );
    expect(screen.getByRole('link', { name: 'Feedback' })).toHaveAttribute(
      'href',
      '/admin/feedback',
    );
  });

  it('should render no badge text on the collapsed rail even with non-zero counts', () => {
    stubSidebar(false, 'collapsed');
    stubOverview(overviewWith({ unverified: 12, feedbackReportsReceived: 5 }));

    renderAdminSidebar();

    expect(screen.queryByText('12')).not.toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();
  });

  it('should keep the footer link back to the dashboard on the collapsed rail', () => {
    stubSidebar(false, 'collapsed');

    renderAdminSidebar();

    expect(
      screen.getByRole('link', { name: 'Back to MyOrganiser' }),
    ).toHaveAttribute('href', '/dashboard');
  });

  it('should leave the phone drawer open when a non-link footer region is clicked', () => {
    const sidebar = stubSidebar(true);

    renderAdminSidebar();
    fireEvent.click(
      screen.getByText(/Admin actions are recorded in the audit log/),
    );

    expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
  });

  it('should not touch the drawer on desktop when the footer link back to the dashboard is chosen', () => {
    const sidebar = stubSidebar(false);

    renderAdminSidebar();
    fireEvent.click(screen.getByRole('link', { name: 'Back to MyOrganiser' }));

    expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
  });

  it('should close the phone drawer when the footer link back to the dashboard is chosen', () => {
    const sidebar = stubSidebar(true);

    renderAdminSidebar();
    fireEvent.click(screen.getByRole('link', { name: 'Back to MyOrganiser' }));

    expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
  });
});
