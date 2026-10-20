/* eslint-disable import/first */
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { usePathname } from 'next/navigation';
import { TooltipProvider } from '@myorganiser/web-ui';
import { isNavItemActive, NavMain, type NavGroup } from './nav-main';

const groups: NavGroup[] = [
  {
    label: 'OVERVIEW',
    items: [{ title: 'Home', url: '/dashboard', kind: 'home' }],
  },
  {
    label: 'ORGANISE',
    items: [
      { title: 'Tasks', url: '/dashboard/tasks', kind: 'tasks' },
      { title: 'Groceries', url: '/dashboard/groceries', kind: 'groceries' },
    ],
  },
];

const groupsWithCount: NavGroup[] = [
  {
    label: 'ORGANISE',
    items: [
      { title: 'Tasks', url: '/dashboard/tasks', kind: 'tasks', count: 3 },
      { title: 'Groceries', url: '/dashboard/groceries', kind: 'groceries' },
    ],
  },
];

function setPathname(pathname: string | null): void {
  (usePathname as jest.Mock).mockReturnValue(pathname);
}

function renderNavMain(props: Parameters<typeof NavMain>[0]) {
  return render(
    <TooltipProvider>
      <NavMain {...props} />
    </TooltipProvider>,
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
  ])('isNavItemActive(%p, %p) returns %p', (pathname, url, expected) => {
    expect(isNavItemActive(pathname, url)).toBe(expected);
  });
});

describe('NavMain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPathname('/dashboard');
  });

  describe('expanded', () => {
    it('renders group labels in the given order with each link title and href', () => {
      renderNavMain({ groups, collapsed: false, countsVisible: true });

      const nav = screen.getByRole('navigation', { name: 'Sections' });
      const rendered = Array.from(nav.children).map((group) => ({
        label: group.querySelector('span')?.textContent,
        links: Array.from(group.querySelectorAll('a')).map((a) => ({
          title: a.textContent,
          href: a.getAttribute('href'),
        })),
      }));

      expect(rendered).toEqual([
        {
          label: 'OVERVIEW',
          links: [{ title: 'Home', href: '/dashboard' }],
        },
        {
          label: 'ORGANISE',
          links: [
            { title: 'Tasks', href: '/dashboard/tasks' },
            { title: 'Groceries', href: '/dashboard/groceries' },
          ],
        },
      ]);
    });

    it('marks only the sub-path link as current when the pathname is under Groceries', () => {
      setPathname('/dashboard/groceries/abc');
      renderNavMain({ groups, collapsed: false, countsVisible: true });

      expect(screen.getByRole('link', { name: 'Groceries' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute(
        'aria-current',
      );
      expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
        'aria-current',
      );
    });

    it('marks Home current only at the exact dashboard path', () => {
      setPathname('/dashboard');
      const { rerender } = renderNavMain({
        groups,
        collapsed: false,
        countsVisible: true,
      });

      expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
        'aria-current',
        'page',
      );

      setPathname('/dashboard/tasks');
      rerender(
        <TooltipProvider>
          <NavMain groups={groups} collapsed={false} countsVisible />
        </TooltipProvider>,
      );

      expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
        'aria-current',
      );
      expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('marks no link current when usePathname returns null', () => {
      setPathname(null);
      renderNavMain({ groups, collapsed: false, countsVisible: true });

      for (const name of ['Home', 'Tasks', 'Groceries']) {
        expect(screen.getByRole('link', { name })).not.toHaveAttribute(
          'aria-current',
        );
      }
    });

    it('shows an item count when counts are visible', () => {
      renderNavMain({
        groups: groupsWithCount,
        collapsed: false,
        countsVisible: true,
      });

      const tasks = screen.getByRole('link', { name: /Tasks/ });
      expect(within(tasks).getByText('3')).toBeInTheDocument();
    });

    it('hides an item count while counts are not visible', () => {
      renderNavMain({
        groups: groupsWithCount,
        collapsed: false,
        countsVisible: false,
      });

      expect(screen.queryByText('3')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Tasks' })).toHaveTextContent(
        /^Tasks$/,
      );
    });

    it('renders no badge for an item without a count', () => {
      renderNavMain({ groups, collapsed: false, countsVisible: true });

      expect(screen.getByRole('link', { name: 'Groceries' })).toHaveTextContent(
        /^Groceries$/,
      );
    });
  });

  describe('collapsed icon rail', () => {
    it('renders no group labels and names each tile link by its title', () => {
      renderNavMain({ groups, collapsed: true, countsVisible: true });

      expect(screen.queryByText('OVERVIEW')).not.toBeInTheDocument();
      expect(screen.queryByText('ORGANISE')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute(
        'href',
        '/dashboard/tasks',
      );
      expect(screen.getByRole('link', { name: 'Groceries' })).toHaveAttribute(
        'href',
        '/dashboard/groceries',
      );
    });

    it('marks the active tile with aria-current="page"', () => {
      setPathname('/dashboard/groceries');
      renderNavMain({ groups, collapsed: true, countsVisible: true });

      expect(screen.getByRole('link', { name: 'Groceries' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
        'aria-current',
      );
    });
  });
});
