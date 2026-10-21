/* eslint-disable import/first */
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { PhoneTabBar } from './PhoneTabBar';

function setPathname(pathname: string | null): void {
  (usePathname as jest.Mock).mockReturnValue(pathname);
}

function renderTabBar(pathname: string | null) {
  setPathname(pathname);
  return render(<PhoneTabBar />);
}

describe('PhoneTabBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPathname('/dashboard');
  });

  it('renders the five tabs in bar order with their hrefs', () => {
    renderTabBar('/dashboard');

    const nav = screen.getByRole('navigation', { name: 'App sections' });
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => ({
        label: link.textContent,
        href: link.getAttribute('href'),
      }));

    expect(links).toEqual([
      { label: 'Home', href: '/dashboard' },
      { label: 'Tasks', href: '/dashboard/tasks' },
      { label: 'Groceries', href: '/dashboard/groceries' },
      { label: 'Vault', href: '/dashboard/vault' },
      { label: 'More', href: '/dashboard/more' },
    ]);
  });

  it('marks Home as the only current tab on the dashboard root', () => {
    renderTabBar('/dashboard');

    const nav = screen.getByRole('navigation', { name: 'App sections' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const name of ['Tasks', 'Groceries', 'Vault', 'More']) {
      expect(within(nav).getByRole('link', { name })).not.toHaveAttribute(
        'aria-current',
      );
    }
  });

  it('marks Groceries as the only current tab on the groceries root', () => {
    renderTabBar('/dashboard/groceries');

    const nav = screen.getByRole('navigation', { name: 'App sections' });
    expect(
      within(nav).getByRole('link', { name: 'Groceries' }),
    ).toHaveAttribute('aria-current', 'page');
    for (const name of ['Home', 'Tasks', 'Vault', 'More']) {
      expect(within(nav).getByRole('link', { name })).not.toHaveAttribute(
        'aria-current',
      );
    }
  });

  it('marks Tasks as the only current tab on the tasks route', () => {
    renderTabBar('/dashboard/tasks');

    const nav = screen.getByRole('navigation', { name: 'App sections' });
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(
      within(nav).getByRole('link', { name: 'Vault' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('marks Vault as the only current tab on the vault route', () => {
    renderTabBar('/dashboard/vault');

    const nav = screen.getByRole('navigation', { name: 'App sections' });
    expect(within(nav).getByRole('link', { name: 'Vault' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'More' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('marks More as the only current tab on the more route', () => {
    renderTabBar('/dashboard/more');

    const nav = screen.getByRole('navigation', { name: 'App sections' });
    expect(within(nav).getByRole('link', { name: 'More' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(nav).getByRole('link', { name: 'Vault' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('renders no tab bar on a pushed section reached from More', () => {
    renderTabBar('/dashboard/subscriptions');

    expect(
      screen.queryByRole('navigation', { name: 'App sections' }),
    ).not.toBeInTheDocument();
  });

  it('renders no tab bar on a pushed detail screen', () => {
    renderTabBar('/dashboard/groceries/abc123');

    expect(
      screen.queryByRole('navigation', { name: 'App sections' }),
    ).not.toBeInTheDocument();
  });

  it('treats a null pathname as Home', () => {
    renderTabBar(null);

    const nav = screen.getByRole('navigation', { name: 'App sections' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
  });
});
