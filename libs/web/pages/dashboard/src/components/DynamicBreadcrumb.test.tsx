/* eslint-disable import/first */
jest.mock('next/navigation');

import { render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { DynamicBreadcrumb, getBreadcrumbItems } from './DynamicBreadcrumb';

describe('getBreadcrumbItems (pure resolver)', () => {
  describe('root and fallback paths', () => {
    it.each([
      ['', 'empty string'],
      ['/', 'root slash'],
    ])('returns Dashboard-only for %s (%s)', (pathname) => {
      const result = getBreadcrumbItems(pathname);
      expect(result).toEqual([{ label: 'Dashboard', href: '/dashboard' }]);
    });

    it('returns Dashboard-only for non-dashboard paths', () => {
      const result = getBreadcrumbItems('/login');
      expect(result).toEqual([{ label: 'Dashboard', href: '/dashboard' }]);
    });
  });

  describe('single-level known routes', () => {
    it.each([
      ['/dashboard/tasks', 'Tasks', '/dashboard/tasks'],
      ['/dashboard/groceries', 'Groceries', '/dashboard/groceries'],
      ['/dashboard/addresses', 'Addresses', '/dashboard/addresses'],
      [
        '/dashboard/mobile-numbers',
        'Mobile numbers',
        '/dashboard/mobile-numbers',
      ],
      ['/dashboard/subscriptions', 'Subscriptions', '/dashboard/subscriptions'],
      ['/dashboard/youtube', 'YouTube', '/dashboard/youtube'],
      ['/dashboard/vault', 'Vault', '/dashboard/vault'],
      ['/dashboard/account', 'Account', '/dashboard/account'],
    ])(
      'resolves %s to Dashboard and %s with cumulative href',
      (pathname, expectedLabel, expectedHref) => {
        const result = getBreadcrumbItems(pathname);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ label: 'Dashboard', href: '/dashboard' });
        expect(result[1]).toEqual({ label: expectedLabel, href: expectedHref });
      },
    );
  });

  describe('trailing slash normalization', () => {
    it.each([
      ['/dashboard/tasks/', 'Tasks'],
      ['/dashboard/addresses/', 'Addresses'],
      ['/dashboard/subscriptions/', 'Subscriptions'],
    ])(
      'normalizes %s to match path without trailing slash',
      (pathname, expectedLabel) => {
        const resultWithSlash = getBreadcrumbItems(pathname);
        const resultWithoutSlash = getBreadcrumbItems(pathname.slice(0, -1));
        expect(resultWithSlash).toEqual(resultWithoutSlash);
        expect(resultWithSlash[1].label).toBe(expectedLabel);
      },
    );
  });

  describe('nested known routes', () => {
    it('resolves /dashboard/youtube/shorts with cumulative hrefs', () => {
      const result = getBreadcrumbItems('/dashboard/youtube/shorts');
      expect(result).toHaveLength(3);
      expect(result).toEqual([
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'YouTube', href: '/dashboard/youtube' },
        { label: 'Shorts', href: '/dashboard/youtube/shorts' },
      ]);
    });

    it('resolves /dashboard/youtube/callback with cumulative hrefs', () => {
      const result = getBreadcrumbItems('/dashboard/youtube/callback');
      expect(result).toHaveLength(3);
      expect(result).toEqual([
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'YouTube', href: '/dashboard/youtube' },
        { label: 'Connecting', href: '/dashboard/youtube/callback' },
      ]);
    });
  });

  describe('dynamic IDs (unrecognized segments resolve to Details)', () => {
    it.each([
      ['/dashboard/groceries/abc123', 'Groceries', 'Details'],
      ['/dashboard/addresses/42', 'Addresses', 'Details'],
      ['/dashboard/subscriptions/7', 'Subscriptions', 'Details'],
      ['/dashboard/mobile-numbers/9', 'Mobile numbers', 'Details'],
    ])(
      'resolves %s to Dashboard / %s / %s',
      (pathname, parentLabel, detailsLabel) => {
        const result = getBreadcrumbItems(pathname);
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ label: 'Dashboard', href: '/dashboard' });
        expect(result[1]).toEqual({
          label: parentLabel,
          href: pathname.split('/').slice(0, 3).join('/'),
        });
        expect(result[2]).toEqual({ label: detailsLabel, href: pathname });
      },
    );
  });

  describe('unknown segment resolution', () => {
    it('resolves unknown single-level segments to Details', () => {
      const result = getBreadcrumbItems('/dashboard/unknown-path');
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Details', href: '/dashboard/unknown-path' },
      ]);
    });

    it('resolves deeply nested unknown paths with Details for unrecognized segments', () => {
      const result = getBreadcrumbItems(
        '/dashboard/groceries/xyz/another-unknown',
      );
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ label: 'Dashboard', href: '/dashboard' });
      expect(result[1]).toEqual({
        label: 'Groceries',
        href: '/dashboard/groceries',
      });
      expect(result[2]).toEqual({
        label: 'Details',
        href: '/dashboard/groceries/xyz',
      });
      expect(result[3]).toEqual({
        label: 'Details',
        href: '/dashboard/groceries/xyz/another-unknown',
      });
    });
  });
});

describe('DynamicBreadcrumb (component)', () => {
  beforeEach(() => {
    (usePathname as jest.Mock).mockClear();
  });

  describe('root dashboard route', () => {
    it('renders a single Dashboard breadcrumb item as current page', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard');
      render(<DynamicBreadcrumb />);

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });
      expect(navElement).toBeInTheDocument();

      // Dashboard should be rendered as BreadcrumbPage (span with aria-current="page")
      const currentPage = screen.getByRole('link', {
        name: 'Dashboard',
        current: 'page',
      });
      expect(currentPage).toBeInTheDocument();

      // Should not render any separators for single item
      const separators = navElement.querySelectorAll('[role="presentation"]');
      expect(separators).toHaveLength(0);
    });

    it('applies hidden md:block class to Dashboard item when it is the only item', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard');
      render(<DynamicBreadcrumb />);

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });
      const items = navElement.querySelectorAll('li');

      expect(items[0]).toHaveClass('hidden', 'md:block');
    });
  });

  describe('single-level routes', () => {
    it.each([
      ['/dashboard/tasks', 'Tasks'],
      ['/dashboard/groceries', 'Groceries'],
      ['/dashboard/addresses', 'Addresses'],
      ['/dashboard/mobile-numbers', 'Mobile numbers'],
      ['/dashboard/subscriptions', 'Subscriptions'],
      ['/dashboard/youtube', 'YouTube'],
      ['/dashboard/vault', 'Vault'],
      ['/dashboard/account', 'Account'],
    ])(
      'renders Dashboard > %s breadcrumb for %s',
      (pathname, expectedLabel) => {
        (usePathname as jest.Mock).mockReturnValue(pathname);
        render(<DynamicBreadcrumb />);

        // Dashboard as link
        const dashboardLink = screen.getByRole('link', { name: 'Dashboard' });
        expect(dashboardLink).toBeInTheDocument();
        expect(dashboardLink).toHaveAttribute('href', '/dashboard');

        // Last item as current page (not a link)
        const currentPage = screen.getByRole('link', {
          name: expectedLabel,
          current: 'page',
        });
        expect(currentPage).toBeInTheDocument();
        expect(currentPage).not.toHaveAttribute('href');

        // One separator between items
        const navElement = screen.getByRole('navigation', {
          name: 'breadcrumb',
        });
        const separators = navElement.querySelectorAll('[role="presentation"]');
        expect(separators).toHaveLength(1);
        expect(separators[0]).toHaveClass('hidden md:block');
      },
    );

    it('hides the first Dashboard item on mobile for two-item breadcrumbs', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/tasks');
      render(<DynamicBreadcrumb />);

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });
      const items = navElement.querySelectorAll('li');

      expect(items[0]).toHaveClass('hidden', 'md:block');
    });
  });

  describe('nested routes', () => {
    it('renders Dashboard > YouTube > Shorts breadcrumb for /dashboard/youtube/shorts', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/youtube/shorts');
      render(<DynamicBreadcrumb />);

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });

      // Dashboard as link
      const dashboardLink = screen.getByRole('link', { name: 'Dashboard' });
      expect(dashboardLink).toBeInTheDocument();
      expect(dashboardLink).toHaveAttribute('href', '/dashboard');

      // YouTube as link
      const youtubeLink = screen.getByRole('link', { name: 'YouTube' });
      expect(youtubeLink).toBeInTheDocument();
      expect(youtubeLink).toHaveAttribute('href', '/dashboard/youtube');

      // Shorts as current page
      const shortsPage = screen.getByRole('link', {
        name: 'Shorts',
        current: 'page',
      });
      expect(shortsPage).toBeInTheDocument();
      expect(shortsPage).not.toHaveAttribute('href');

      // Two separators
      const separators = navElement.querySelectorAll('[role="presentation"]');
      expect(separators).toHaveLength(2);
      separators.forEach((separator) => {
        expect(separator).toHaveClass('hidden md:block');
      });
    });

    it('hides the first Dashboard item on mobile for three-item breadcrumbs', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/youtube/shorts');
      render(<DynamicBreadcrumb />);

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });
      const allItems = navElement.querySelectorAll('li');

      expect(allItems[0]).toHaveClass('hidden', 'md:block');

      const breadcrumbItems = navElement.querySelectorAll(
        'li:not([role="presentation"])',
      );
      expect(breadcrumbItems[1]).not.toHaveClass('hidden md:block');
    });
  });

  describe('dynamic IDs and deep nesting', () => {
    it('renders Details for dynamic ID: /dashboard/groceries/abc123', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/groceries/abc123');
      render(<DynamicBreadcrumb />);

      const dashboardLink = screen.getByRole('link', { name: 'Dashboard' });
      expect(dashboardLink).toHaveAttribute('href', '/dashboard');

      const groceriesLink = screen.getByRole('link', { name: 'Groceries' });
      expect(groceriesLink).toHaveAttribute('href', '/dashboard/groceries');

      const detailsPage = screen.getByRole('link', {
        name: 'Details',
        current: 'page',
      });
      expect(detailsPage).toBeInTheDocument();
      expect(detailsPage).not.toHaveAttribute('href');
    });

    it.each([
      ['/dashboard/addresses/42', 'Addresses', '/dashboard/addresses'],
      [
        '/dashboard/subscriptions/7',
        'Subscriptions',
        '/dashboard/subscriptions',
      ],
      [
        '/dashboard/mobile-numbers/9',
        'Mobile numbers',
        '/dashboard/mobile-numbers',
      ],
    ])(
      'renders Details for dynamic ID: %s',
      (pathname, parentLabel, parentHref) => {
        (usePathname as jest.Mock).mockReturnValue(pathname);
        render(<DynamicBreadcrumb />);

        const parentLink = screen.getByRole('link', { name: parentLabel });
        expect(parentLink).toHaveAttribute('href', parentHref);

        const detailsPage = screen.getByRole('link', {
          name: 'Details',
          current: 'page',
        });
        expect(detailsPage).toBeInTheDocument();
      },
    );
  });

  describe('trailing slash and normalization', () => {
    it('normalizes trailing slash: /dashboard/tasks/ matches /dashboard/tasks', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/tasks/');
      render(<DynamicBreadcrumb />);

      const dashboardLink = screen.getByRole('link', { name: 'Dashboard' });
      expect(dashboardLink).toHaveAttribute('href', '/dashboard');

      const tasksPage = screen.getByRole('link', {
        name: 'Tasks',
        current: 'page',
      });
      expect(tasksPage).toBeInTheDocument();
    });
  });

  describe('fallback to Dashboard for non-dashboard paths', () => {
    it('falls back to Dashboard breadcrumb for completely unrelated route', () => {
      (usePathname as jest.Mock).mockReturnValue('/some/other/path');
      render(<DynamicBreadcrumb />);

      const currentPage = screen.getByRole('link', {
        name: 'Dashboard',
        current: 'page',
      });
      expect(currentPage).toBeInTheDocument();

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });
      const separators = navElement.querySelectorAll('[role="presentation"]');
      expect(separators).toHaveLength(0);
    });
  });

  describe('aria attributes', () => {
    it('sets aria-current="page" on the current breadcrumb item', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/tasks');
      render(<DynamicBreadcrumb />);

      const tasksPage = screen.getByRole('link', {
        name: 'Tasks',
        current: 'page',
      });
      expect(tasksPage).toHaveAttribute('aria-current', 'page');
    });

    it('sets aria-disabled="true" on the current breadcrumb item', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/tasks');
      render(<DynamicBreadcrumb />);

      const tasksPage = screen.getByRole('link', {
        name: 'Tasks',
        current: 'page',
      });
      expect(tasksPage).toHaveAttribute('aria-disabled', 'true');
    });

    it('does not set aria-current on non-current breadcrumb items', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/tasks');
      render(<DynamicBreadcrumb />);

      const dashboardLink = screen.getByRole('link', { name: 'Dashboard' });
      expect(dashboardLink).not.toHaveAttribute('aria-current');
      expect(dashboardLink).not.toHaveAttribute('aria-disabled');
    });

    it('marks separator elements as presentation-only', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/tasks');
      render(<DynamicBreadcrumb />);

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });
      const separators = navElement.querySelectorAll('[role="presentation"]');

      separators.forEach((separator) => {
        expect(separator).toHaveAttribute('aria-hidden', 'true');
      });
    });
  });

  describe('responsive design', () => {
    it('hides all separators on mobile', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/tasks');
      render(<DynamicBreadcrumb />);

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });
      const separators = navElement.querySelectorAll('[role="presentation"]');

      separators.forEach((separator) => {
        expect(separator).toHaveClass('hidden md:block');
      });
    });

    it('hides multiple separators on mobile for nested routes', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/youtube/shorts');
      render(<DynamicBreadcrumb />);

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });
      const separators = navElement.querySelectorAll('[role="presentation"]');

      expect(separators.length).toBeGreaterThan(0);
      separators.forEach((separator) => {
        expect(separator).toHaveClass('hidden md:block');
      });
    });
  });

  describe('breadcrumb structure', () => {
    it('renders Breadcrumb as a nav element with aria-label', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard');
      render(<DynamicBreadcrumb />);

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });
      expect(navElement.tagName).toBe('NAV');
    });

    it('renders BreadcrumbList as an ordered list', () => {
      (usePathname as jest.Mock).mockReturnValue('/dashboard/tasks');
      render(<DynamicBreadcrumb />);

      const navElement = screen.getByRole('navigation', { name: 'breadcrumb' });
      const listElement = navElement.querySelector('ol');
      expect(listElement).toBeInTheDocument();
    });
  });
});
