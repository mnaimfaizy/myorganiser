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

jest.mock('@myorganiser/auth', () => ({
  getCurrentUser: jest.fn(),
  logout: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useSidebar: jest.fn(),
  useToast: jest.fn(),
}));

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCurrentUser } from '@myorganiser/auth';
import { TooltipProvider, useSidebar, useToast } from '@myorganiser/web-ui';

import { AdminHeader } from './AdminHeader';

function stubSidebar(state: 'expanded' | 'collapsed', isMobile: boolean) {
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

// Radix Tooltip requires a TooltipProvider above the trigger.
function renderHeader() {
  return render(
    <TooltipProvider>
      <AdminHeader />
    </TooltipProvider>,
  );
}

describe('AdminHeader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname.mockReturnValue('/admin');
    stubSidebar('expanded', false);
    (getCurrentUser as jest.Mock).mockReturnValue({
      name: 'Test Admin',
      email: 'admin@example.com',
    });
    (useToast as jest.Mock).mockReturnValue({ toast: jest.fn() });
  });

  it('should title the portal root Overview with an unlinked Admin portal crumb', () => {
    renderHeader();

    expect(screen.getByText('Overview', { selector: 'p' })).toBeInTheDocument();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(breadcrumb).queryByRole('link', { name: 'Admin portal' }),
    ).not.toBeInTheDocument();
    expect(
      within(breadcrumb).getByText('Admin portal', { selector: 'span' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('should title a deeper section route Details with linked breadcrumbs', () => {
    mockPathname.mockReturnValue('/admin/users/abc');

    renderHeader();

    expect(screen.getByText('Details', { selector: 'p' })).toBeInTheDocument();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(breadcrumb).getByRole('link', { name: 'Admin portal' }),
    ).toHaveAttribute('href', '/admin');
    expect(
      within(breadcrumb).getByRole('link', { name: 'Users' }),
    ).toHaveAttribute('href', '/admin/users');
  });

  it('should show the Platform admin chip', () => {
    renderHeader();

    expect(screen.getByText('Platform admin')).toBeInTheDocument();
  });

  it('should label the expanded sidebar toggle Collapse sidebar and call toggleSidebar on click', () => {
    const sidebar = stubSidebar('expanded', false);

    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(sidebar.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('should label the collapsed sidebar toggle Expand sidebar and call toggleSidebar on click', () => {
    const sidebar = stubSidebar('collapsed', false);

    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

    expect(sidebar.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('should label the sidebar toggle Open sidebar on phone width', () => {
    stubSidebar('collapsed', true);

    renderHeader();

    expect(
      screen.getByRole('button', { name: 'Open sidebar' }),
    ).toBeInTheDocument();
  });
});
