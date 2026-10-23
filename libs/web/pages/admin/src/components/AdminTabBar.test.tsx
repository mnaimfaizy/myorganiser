/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

const mockPathname = jest.fn(() => '/admin');

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AdminTabBar } from './AdminTabBar';

function tabBar() {
  return screen.getByRole('navigation', { name: 'Admin sections' });
}

describe('AdminTabBar', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/admin');
  });

  it('should link the four admin sections and My app back to the dashboard', () => {
    render(<AdminTabBar />);

    const links = within(tabBar()).getAllByRole('link');

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/admin',
      '/admin/users',
      '/admin/audit-logs',
      '/admin/feedback',
      '/dashboard',
    ]);
    expect(links.map((link) => link.textContent)).toEqual([
      'Overview',
      'Users',
      'Audit log',
      'Feedback',
      'My app',
    ]);
  });

  it('should mark Feedback as the current page at /admin/feedback/abc', () => {
    mockPathname.mockReturnValue('/admin/feedback/abc');

    render(<AdminTabBar />);

    expect(
      within(tabBar()).getByRole('link', { name: 'Feedback' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(tabBar()).getByRole('link', { name: 'Users' }),
    ).not.toHaveAttribute('aria-current');
    expect(
      within(tabBar()).getByRole('link', { name: 'My app' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('should mark Overview as the current page at /admin', () => {
    render(<AdminTabBar />);

    expect(
      within(tabBar()).getByRole('link', { name: 'Overview' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(tabBar()).getByRole('link', { name: 'Feedback' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('should carry the phone tab bar data attribute', () => {
    render(<AdminTabBar />);

    expect(tabBar()).toHaveAttribute('data-phone-tab-bar');
  });
});
