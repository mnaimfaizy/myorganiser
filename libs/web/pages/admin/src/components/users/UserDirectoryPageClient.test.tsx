/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(),
}));

jest.mock('next/link', () => {
  const React = require('react');

  return {
    __esModule: true,
    default: ({
      children,
      href,
      ...props
    }: {
      children: React.ReactNode;
      href: string;
    }) => React.createElement('a', { href, ...props }, children),
  };
});

import type {
  AdminOverviewResponse,
  AdminUserIdentity,
  AdminUserListResponse,
} from '@myorganiser/app-api-client';
import { useIsMobileState } from '@myorganiser/web-ui';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../../lib/apiClient';
import { AdminOverviewProvider } from '../../hooks/use-admin-overview';

import { UserDirectoryPageClient } from './UserDirectoryPageClient';

// jsdom has no pointer capture or scrollIntoView, which Radix Select calls.
Element.prototype.scrollIntoView = jest.fn();
Element.prototype.hasPointerCapture = jest.fn(() => false);
Element.prototype.releasePointerCapture = jest.fn();

const mockGetAdminOverview = jest.fn();
const mockListUsers = jest.fn();

// Local noon on 15 Oct of the current year: "Joined" shows "15 Oct" with no year, in any time zone.
const JOINED_AT = new Date(new Date().getFullYear(), 9, 15, 12).toISOString();

const overviewFixture: AdminOverviewResponse = {
  users: 148,
  usersJoinedLast7Days: 6,
  platformAdmins: 3,
  unverified: 12,
  unverifiedOverAWeek: 5,
  disabled: 4,
  youtubeAccessPlacesUsed: 20,
  youtubeAccessPlacesLeft: 5,
  youtubeAccessCeiling: 25,
  feedbackReportsReceived: 0,
};

function userFixture(
  overrides: Partial<AdminUserIdentity> & Pick<AdminUserIdentity, 'id'>,
): AdminUserIdentity {
  return {
    name: `User ${overrides.id}`,
    email: `${overrides.id}@example.com`,
    firstName: 'First',
    lastName: 'Last',
    role: 'user',
    disabled: false,
    emailVerified: true,
    youtubeAccess: false,
    createdAt: JOINED_AT,
    ...overrides,
  };
}

/** Ada is an unverified admin; Grace is disabled and unverified (disabled wins); Alan is active. */
const directoryFixture: AdminUserIdentity[] = [
  userFixture({
    id: 'u-ada',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'platform_admin',
    emailVerified: false,
  }),
  userFixture({
    id: 'u-grace',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    disabled: true,
    emailVerified: false,
  }),
  userFixture({
    id: 'u-alan',
    name: 'Alan Turing',
    email: 'alan@example.com',
  }),
];

function usersRange(from: number, count: number): AdminUserIdentity[] {
  return Array.from({ length: count }, (_, index) =>
    userFixture({ id: `u${from + index}` }),
  );
}

function listResponse(
  users: AdminUserIdentity[],
  total: number,
  page = 1,
): { data: AdminUserListResponse } {
  return { data: { users, total, page, pageSize: 25 } };
}

function lastListParams(): Record<string, unknown> {
  const calls = mockListUsers.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

function renderDirectory() {
  return render(
    <AdminOverviewProvider>
      <UserDirectoryPageClient />
    </AdminOverviewProvider>,
  );
}

interface FakeObserver {
  callback: IntersectionObserverCallback;
  observe: jest.Mock;
  disconnect: jest.Mock;
}

const createdObservers: FakeObserver[] = [];

/** Captures each observer's callback so a test can report the sentinel as visible. */
class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  observe = jest.fn();
  disconnect = jest.fn();
  unobserve = jest.fn();
  takeRecords = jest.fn(() => []);

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    createdObservers.push(this);
  }
}

describe('UserDirectoryPageClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      listUsers: mockListUsers,
      getAdminOverview: mockGetAdminOverview,
    });
    mockGetAdminOverview.mockResolvedValue({ data: overviewFixture });
    mockListUsers.mockResolvedValue(listResponse(directoryFixture, 3));
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    createdObservers.length = 0;
  });

  afterEach(() => {
    delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  describe('desktop', () => {
    it('renders one Users h1 and the account summary once the overview loads', async () => {
      renderDirectory();

      await screen.findByText('148 accounts · 3 platform admins');
      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent('Users');
    });

    it('renders each user as a link with name, role and status pills, and joined date', async () => {
      renderDirectory();

      const ada = await screen.findByRole('link', { name: /Ada Lovelace/ });
      expect(ada).toHaveAttribute('href', '/admin/users/u-ada');
      expect(ada).toHaveTextContent('ada@example.com');
      expect(within(ada).getByText('Admin')).toBeInTheDocument();
      expect(within(ada).getByText('Unverified')).toBeInTheDocument();
      expect(ada).toHaveTextContent('Joined 15 Oct');

      const grace = screen.getByRole('link', { name: /Grace Hopper/ });
      expect(grace).toHaveAttribute('href', '/admin/users/u-grace');
      expect(within(grace).getByText('User')).toBeInTheDocument();
      expect(within(grace).getByText('Disabled')).toBeInTheDocument();
      expect(within(grace).queryByText('Unverified')).not.toBeInTheDocument();

      const alan = screen.getByRole('link', { name: /Alan Turing/ });
      expect(within(alan).getByText('Active')).toBeInTheDocument();

      expect(screen.getByText('Showing 1–3 of 3')).toBeInTheDocument();
    });

    it.each([
      [
        'still loading',
        () =>
          mockGetAdminOverview.mockReturnValue(new Promise(() => undefined)),
      ],
      [
        'failed',
        () =>
          mockGetAdminOverview.mockRejectedValue(new Error('overview down')),
      ],
    ])(
      'omits the account summary while the overview is %s, and still lists users',
      async (_label, arrangeOverview) => {
        arrangeOverview();

        renderDirectory();

        await screen.findByRole('link', { name: /Ada Lovelace/ });
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
          'Users',
        );
        expect(screen.queryByText(/accounts ·/)).not.toBeInTheDocument();
      },
    );

    it('renders the header and summary, and no list, while the breakpoint is undecided', async () => {
      (useIsMobileState as jest.Mock).mockReturnValue(undefined);

      renderDirectory();

      await screen.findByText('148 accounts · 3 platform admins');
      expect(
        screen.getByRole('heading', { level: 1, name: 'Users' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Users' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('shows the loading message while the first request is pending', async () => {
      mockListUsers.mockReturnValue(new Promise(() => undefined));

      renderDirectory();

      expect(screen.getByText('Loading…')).toBeInTheDocument();
      await screen.findByText('148 accounts · 3 platform admins');
    });

    it('shows the error message and no pager when the list request is rejected', async () => {
      mockListUsers.mockRejectedValue(new Error('list down'));

      renderDirectory();

      await screen.findByText('Unable to load users. Please try again.');
      expect(
        screen.queryByRole('navigation', { name: 'Pages' }),
      ).not.toBeInTheDocument();
    });

    it('shows the empty message and no pager when there are no users', async () => {
      mockListUsers.mockResolvedValue(listResponse([], 0));

      renderDirectory();

      await screen.findByText('No users found.');
      expect(
        screen.queryByRole('navigation', { name: 'Pages' }),
      ).not.toBeInTheDocument();
    });

    it('presses Unverified, refetches with that status, and ignores a second press', async () => {
      renderDirectory();
      await screen.findByRole('link', { name: /Ada Lovelace/ });

      const unverified = screen.getByRole('button', { name: 'Unverified' });
      fireEvent.click(unverified);

      await waitFor(() => {
        expect(mockListUsers).toHaveBeenCalledTimes(2);
      });
      expect(lastListParams()).toEqual(
        expect.objectContaining({ status: 'unverified', page: 1 }),
      );
      expect(unverified).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );

      fireEvent.click(unverified);

      expect(mockListUsers).toHaveBeenCalledTimes(2);
    });

    it('fetches with role platform_admin when the Admin role chip is pressed', async () => {
      renderDirectory();
      await screen.findByRole('link', { name: /Ada Lovelace/ });

      fireEvent.click(screen.getByRole('button', { name: 'Admin' }));

      await waitFor(() => {
        expect(lastListParams()).toEqual(
          expect.objectContaining({ role: 'platform_admin', page: 1 }),
        );
      });
    });

    it('trims the search text into q, and clears q when the field is submitted empty', async () => {
      renderDirectory();
      await screen.findByRole('link', { name: /Ada Lovelace/ });
      const input = screen.getByRole('textbox', { name: 'Search users' });

      fireEvent.change(input, { target: { value: '  ada ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));

      await waitFor(() => {
        expect(lastListParams()).toEqual(expect.objectContaining({ q: 'ada' }));
      });

      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));

      await waitFor(() => {
        expect(lastListParams()).toEqual(
          expect.objectContaining({ q: undefined }),
        );
      });
    });

    it('pages from 1–25 to 26–30 of 30, and disables Next on the last page', async () => {
      mockListUsers.mockImplementation(({ page }: { page: number }) =>
        Promise.resolve(
          page === 1
            ? listResponse(usersRange(1, 25), 30, 1)
            : listResponse(usersRange(26, 5), 30, 2),
        ),
      );

      renderDirectory();
      await screen.findByText('Showing 1–25 of 30');
      const pages = screen.getByRole('navigation', { name: 'Pages' });
      expect(
        within(pages).getByRole('button', { name: 'Previous' }),
      ).toBeDisabled();

      fireEvent.click(within(pages).getByRole('button', { name: 'Next' }));

      await screen.findByText('Showing 26–30 of 30');
      expect(lastListParams()).toEqual(expect.objectContaining({ page: 2 }));
      expect(
        within(screen.getByRole('navigation', { name: 'Pages' })).getByRole(
          'button',
          {
            name: 'Next',
          },
        ),
      ).toBeDisabled();
    });

    it('sorts by name when Name is chosen in the Sort select', async () => {
      renderDirectory();
      await screen.findByRole('link', { name: /Ada Lovelace/ });

      const sortTrigger = screen.getByRole('combobox', { name: 'Sort' });
      fireEvent.keyDown(sortTrigger, { key: 'Enter' });
      fireEvent.click(await screen.findByRole('option', { name: 'Name' }));

      await waitFor(() => {
        expect(lastListParams()).toEqual(
          expect.objectContaining({ sort: 'name' }),
        );
      });
    });
  });

  describe('phone', () => {
    beforeEach(() => {
      (useIsMobileState as jest.Mock).mockReturnValue(true);
    });

    it('shows the account count, five chips, and the Admin · Joined meta, without Sort or Pages', async () => {
      renderDirectory();

      await screen.findByText('148 accounts');
      const toolbar = screen.getByRole('toolbar', { name: 'Filter users' });
      expect(
        within(toolbar)
          .getAllByRole('button')
          .map((chip) => chip.textContent),
      ).toEqual(['All', 'Active', 'Unverified', 'Disabled', 'Admins']);
      expect(
        screen.queryByRole('combobox', { name: 'Sort' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'Pages' }),
      ).not.toBeInTheDocument();

      const ada = await screen.findByRole('link', { name: /Ada Lovelace/ });
      expect(
        within(ada).getByText('Admin · Joined 15 Oct'),
      ).toBeInTheDocument();
    });

    it('fetches admins only when the Admins chip is pressed, with no status filter', async () => {
      renderDirectory();
      await screen.findByRole('link', { name: /Ada Lovelace/ });

      const admins = within(
        screen.getByRole('toolbar', { name: 'Filter users' }),
      ).getByRole('button', { name: 'Admins' });
      fireEvent.click(admins);

      await waitFor(() => {
        expect(lastListParams()).toEqual(
          expect.objectContaining({
            role: 'platform_admin',
            status: undefined,
            page: 1,
          }),
        );
      });
      expect(admins).toHaveAttribute('aria-pressed', 'true');
    });

    it('appends the next page from the sentinel and counts 30 of 30', async () => {
      window.IntersectionObserver =
        FakeIntersectionObserver as unknown as typeof IntersectionObserver;
      mockListUsers.mockImplementation(({ page }: { page: number }) =>
        Promise.resolve(
          page === 1
            ? listResponse(usersRange(1, 25), 30, 1)
            : listResponse(usersRange(26, 5), 30, 2),
        ),
      );

      renderDirectory();
      await screen.findByText('Scroll for more · 25 of 30');

      const observer = createdObservers[createdObservers.length - 1];
      act(() => {
        observer.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          observer as unknown as IntersectionObserver,
        );
      });

      await waitFor(() => {
        expect(lastListParams()).toEqual(expect.objectContaining({ page: 2 }));
      });
      await screen.findByText('30 of 30');
      const userLinks = screen
        .getAllByRole('link')
        .filter((link) =>
          link.getAttribute('href')?.startsWith('/admin/users/'),
        );
      expect(userLinks).toHaveLength(30);
    });
  });
});
