/* eslint-disable import/first */
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { usePathname } from 'next/navigation';
import { SidebarProvider } from '@myorganiser/web-ui';
import { isNavItemActive, NavMain } from './nav-main';

const leafItems = [
  { title: 'Home', url: '/dashboard' },
  { title: 'Groceries', url: '/dashboard/groceries' },
  { title: 'Tasks', url: '/dashboard/tasks' },
];

const collapsibleItems = [
  {
    title: 'Account',
    url: '/dashboard/account',
    items: [{ title: 'Billing', url: '/dashboard/account/billing' }],
  },
];

function setPathname(pathname: string | null): void {
  (usePathname as jest.Mock).mockReturnValue(pathname);
}

// The real SidebarProvider reads window.matchMedia through useIsMobile,
// which jsdom does not provide.
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

function renderNavMain(items: Parameters<typeof NavMain>[0]['items']) {
  return render(
    <SidebarProvider>
      <NavMain items={items} />
    </SidebarProvider>,
  );
}

describe('isNavItemActive', () => {
  it.each<[string, string, boolean]>([
    ['/dashboard/groceries', '/dashboard/groceries', true],
    ['/dashboard/groceries/abc123', '/dashboard/groceries', true],
    ['/dashboard/groceriesX', '/dashboard/groceries', false],
    ['/dashboard', '/dashboard', true],
    ['/dashboard/groceries', '/dashboard', false],
    ['/dashboard/groceries/', '/dashboard/groceries', true],
    ['', '/dashboard/groceries', false],
  ])('isNavItemActive(%p, %p) returns %p', (pathname, url, expected) => {
    expect(isNavItemActive(pathname, url)).toBe(expected);
  });
});

describe('NavMain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubMatchMedia();
    setPathname('/dashboard');
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('marks only the exact leaf link as active with aria-current="page"', () => {
    setPathname('/dashboard/groceries');
    renderNavMain(leafItems);

    const groceries = screen.getByRole('link', { name: 'Groceries' });
    expect(groceries).toHaveAttribute('href', '/dashboard/groceries');
    expect(groceries).toHaveAttribute('data-active', 'true');
    expect(groceries).toHaveAttribute('aria-current', 'page');

    for (const name of ['Home', 'Tasks']) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('data-active', 'false');
      expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it('keeps the Home link inactive for a nested path under another item', () => {
    setPathname('/dashboard/groceries/list-1');
    renderNavMain(leafItems);

    expect(screen.getByRole('link', { name: 'Groceries' })).toHaveAttribute(
      'data-active',
      'true',
    );
    const home = screen.getByRole('link', { name: 'Home' });
    expect(home).toHaveAttribute('data-active', 'false');
    expect(home).not.toHaveAttribute('aria-current');
  });

  it('activates Home only when the pathname is exactly /dashboard', () => {
    setPathname('/dashboard');
    renderNavMain(leafItems);

    const home = screen.getByRole('link', { name: 'Home' });
    expect(home).toHaveAttribute('data-active', 'true');
    expect(home).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Groceries' })).toHaveAttribute(
      'data-active',
      'false',
    );
  });

  it('renders without throwing and marks no link active when usePathname returns null', () => {
    setPathname(null);
    renderNavMain(leafItems);

    for (const name of ['Home', 'Groceries', 'Tasks']) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('data-active', 'false');
      expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it('opens a collapsible group by default and marks its active sub-link and trigger', () => {
    setPathname('/dashboard/account/billing');
    renderNavMain(collapsibleItems);

    const trigger = screen.getByRole('button', { name: 'Account' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('data-active', 'true');

    const billing = screen.getByRole('link', { name: 'Billing' });
    expect(billing).toHaveAttribute('href', '/dashboard/account/billing');
    expect(billing).toHaveAttribute('data-active', 'true');
    expect(billing).toHaveAttribute('aria-current', 'page');
  });

  it('marks the group trigger active when the group url itself is the pathname', () => {
    setPathname('/dashboard/account');
    renderNavMain(collapsibleItems);

    const trigger = screen.getByRole('button', { name: 'Account' });
    expect(trigger).toHaveAttribute('data-active', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a collapsible group when item.isActive is set, even with a non-matching pathname', () => {
    setPathname('/dashboard/tasks');
    renderNavMain([{ ...collapsibleItems[0], isActive: true }]);

    const trigger = screen.getByRole('button', { name: 'Account' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute(
      'data-active',
      'false',
    );
  });
});
