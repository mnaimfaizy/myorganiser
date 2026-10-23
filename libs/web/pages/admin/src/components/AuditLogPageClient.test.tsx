/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
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
  AdminAuditLogEntry,
  AdminAuditLogListResponse,
  AdminUserIdentity,
  AdminUserListResponse,
} from '@myorganiser/app-api-client';
import { useIsMobileState } from '@myorganiser/web-ui';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../lib/apiClient';
import { formatDayMonth } from '../lib/userDirectory';

import { AuditLogPageClient } from './AuditLogPageClient';

// jsdom has no pointer capture or scrollIntoView, which Radix menus and popovers call.
Element.prototype.scrollIntoView = jest.fn();
Element.prototype.hasPointerCapture = jest.fn(() => false);
Element.prototype.releasePointerCapture = jest.fn();

// jsdom has no ResizeObserver, which the picker's Command list (cmdk) observes.
class ResizeObserverStub {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}
window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const mockListAuditLogs = jest.fn();
const mockListUsers = jest.fn();

// Local-time fixtures: "Today" and "Yesterday" are relative to the run's clock.
const now = new Date();
const todayAt = (hour: number, minute: number) =>
  new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
  ).toISOString();
const yesterdayAt = (hour: number, minute: number) =>
  new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    hour,
    minute,
  ).toISOString();
const twoDaysAgoAt = (hour: number, minute: number) =>
  new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 2,
    hour,
    minute,
  ).toISOString();

function auditPage(
  entries: AdminAuditLogEntry[],
  total = entries.length,
  page = 1,
): { data: AdminAuditLogListResponse } {
  return { data: { entries, total, page, pageSize: 25 } };
}

function userPage(users: AdminUserIdentity[]): {
  data: AdminUserListResponse;
} {
  return {
    data: { users, total: users.length, page: 1, pageSize: 10 },
  };
}

const anaUser: AdminUserIdentity = {
  id: 'u-ana',
  name: 'Ana Costa',
  email: 'ana@example.com',
  firstName: 'Ana',
  lastName: 'Costa',
  role: 'user',
  disabled: false,
  emailVerified: true,
  youtubeAccess: false,
  createdAt: todayAt(8, 0),
};

const sampleEntries: AdminAuditLogEntry[] = [
  {
    id: 'audit-1',
    action: 'disable',
    actorUserId: 'u-ana',
    targetUserId: 'u-ben',
    actorName: 'Ana Costa',
    targetName: 'Ben Okafor',
    actorDeleted: false,
    targetDeleted: false,
    createdAt: todayAt(9, 58),
  },
  {
    id: 'audit-2',
    action: 'youtube_access_grant',
    actorUserId: 'u-ana',
    targetUserId: 'u-cy',
    actorName: 'Ana Costa',
    targetName: 'Cy Lindqvist',
    actorDeleted: false,
    targetDeleted: false,
    createdAt: yesterdayAt(17, 20),
  },
  {
    id: 'audit-3',
    action: 'enable',
    actorUserId: null,
    targetUserId: 'u-dee',
    actorName: null,
    targetName: 'Dee Park',
    actorDeleted: true,
    targetDeleted: false,
    createdAt: twoDaysAgoAt(11, 3),
  },
];

/** A full desktop page of identical enable rows, so the range reads 1–25. */
function fullPage(count: number, prefix: string): AdminAuditLogEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    ...sampleEntries[0],
    id: `${prefix}-${index}`,
    action: 'enable',
    createdAt: todayAt(9, 58),
  }));
}

/** Thirty entries across two pages, so the pager and footer read "of 30". */
function arrangeThirtyEntries() {
  mockListAuditLogs.mockImplementation(async ({ page }: { page: number }) =>
    page === 1
      ? auditPage(fullPage(25, 'p1'), 30, 1)
      : auditPage(fullPage(5, 'p2'), 30, 2),
  );
}

function renderPage() {
  return render(<AuditLogPageClient />);
}

describe('AuditLogPageClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      listAuditLogs: mockListAuditLogs,
      listUsers: mockListUsers,
    });
    mockListAuditLogs.mockResolvedValue(auditPage(sampleEntries));
    mockListUsers.mockResolvedValue(userPage([anaUser]));
    (useIsMobileState as jest.Mock).mockReturnValue(false);
  });

  describe('desktop', () => {
    it('shows loading, then requests page 1 at 25 rows with the one h1 and subtitle', async () => {
      mockListAuditLogs.mockReturnValue(new Promise(() => undefined));

      renderPage();

      expect(
        screen.getByRole('heading', { level: 1, name: 'Audit log' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Every admin action, newest first. Entries can't be edited or removed.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(mockListAuditLogs).toHaveBeenCalledWith({
        userId: undefined,
        action: undefined,
        page: 1,
        pageSize: 25,
      });
    });

    it('renders names as links to their user pages, with pill labels and "Today HH:mm" times', async () => {
      renderPage();

      const rows = await screen.findAllByRole('listitem');
      expect(rows).toHaveLength(3);

      const first = within(rows[0]);
      expect(first.getByText('Today 09:58')).toBeInTheDocument();
      expect(first.getByText('Disable')).toBeInTheDocument();
      expect(first.getByRole('link', { name: 'Ana Costa' })).toHaveAttribute(
        'href',
        '/admin/users/u-ana',
      );
      expect(first.getByRole('link', { name: 'Ben Okafor' })).toHaveAttribute(
        'href',
        '/admin/users/u-ben',
      );

      const second = within(rows[1]);
      expect(second.getByText('Grant YouTube Access')).toBeInTheDocument();
      expect(second.getByText('Yesterday 17:20')).toBeInTheDocument();

      expect(screen.queryByText('u-ana')).not.toBeInTheDocument();
      expect(screen.queryByText('actor-1')).not.toBeInTheDocument();
    });

    it('shows a deleted party as plain "Deleted user" text, with no link on that name', async () => {
      renderPage();

      const rows = await screen.findAllByRole('listitem');
      const deleted = within(rows[2]).getByText('Deleted user');

      expect(deleted.closest('a')).toBeNull();
      expect(
        within(rows[2]).getByRole('link', { name: 'Dee Park' }),
      ).toHaveAttribute('href', '/admin/users/u-dee');
    });

    it('reads the range from the first page and pages Older to page 2, with Newer disabled on page 1', async () => {
      arrangeThirtyEntries();

      renderPage();

      await screen.findByText('Showing 1–25 of 30 entries');
      const pager = screen.getByRole('navigation', { name: 'Pages' });
      expect(
        within(pager).getByRole('button', { name: 'Newer' }),
      ).toBeDisabled();

      fireEvent.click(within(pager).getByRole('button', { name: 'Older' }));

      await waitFor(() => {
        expect(mockListAuditLogs).toHaveBeenLastCalledWith({
          userId: undefined,
          action: undefined,
          page: 2,
          pageSize: 25,
        });
      });
      await screen.findByText('Showing 26–30 of 30 entries');
      expect(
        within(pager).getByRole('button', { name: 'Older' }),
      ).toBeDisabled();
    });

    it('filters by action from the menu: re-requests on page 1, keeps the menu open, and reads "matching entries"', async () => {
      arrangeThirtyEntries();

      renderPage();

      const trigger = await screen.findByRole('button', {
        name: 'Action Any action',
      });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      fireEvent.click(
        await screen.findByRole('menuitemcheckbox', { name: 'Disable' }),
      );

      await waitFor(() => {
        expect(mockListAuditLogs).toHaveBeenLastCalledWith({
          userId: undefined,
          action: ['disable'],
          page: 1,
          pageSize: 25,
        });
      });
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

      expect(
        await screen.findByRole('button', { name: 'Action Disable' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Showing 1–25 of 30 matching entries'),
      ).toBeInTheDocument();
    });

    it('filters by user from the picker, and the trigger shows the chosen name', async () => {
      renderPage();

      const picker = await screen.findByRole('combobox', {
        name: 'User Any user',
      });
      fireEvent.click(picker);

      await waitFor(() => {
        expect(mockListUsers).toHaveBeenCalledWith({
          q: undefined,
          pageSize: 10,
          sort: 'name',
        });
      });
      fireEvent.click(await screen.findByRole('option', { name: /Ana Costa/ }));

      await waitFor(() => {
        expect(mockListAuditLogs).toHaveBeenLastCalledWith({
          userId: 'u-ana',
          action: undefined,
          page: 1,
          pageSize: 25,
        });
      });
      expect(
        screen.getByRole('combobox', { name: 'User Ana Costa' }),
      ).toBeInTheDocument();
    });

    it('keeps Clear filters disabled until a filter is set, then clears both filters in one request', async () => {
      renderPage();

      await screen.findByText('Disable');
      expect(
        screen.getByRole('button', { name: 'Clear filters' }),
      ).toBeDisabled();

      const trigger = screen.getByRole('button', { name: 'Action Any action' });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      fireEvent.click(
        await screen.findByRole('menuitemcheckbox', { name: 'Disable' }),
      );
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

      fireEvent.click(
        await screen.findByRole('combobox', { name: 'User Any user' }),
      );
      fireEvent.click(await screen.findByRole('option', { name: /Ana Costa/ }));

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Clear filters' }),
        ).toBeEnabled();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

      await waitFor(() => {
        expect(mockListAuditLogs).toHaveBeenLastCalledWith({
          userId: undefined,
          action: undefined,
          page: 1,
          pageSize: 25,
        });
      });
      expect(
        screen.getByRole('button', { name: 'Clear filters' }),
      ).toBeDisabled();
    });

    it('shows the unfiltered empty message and no pager when there are no entries', async () => {
      mockListAuditLogs.mockResolvedValue(auditPage([]));

      renderPage();

      expect(
        await screen.findByText('No audit log entries yet.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'Pages' }),
      ).not.toBeInTheDocument();
    });

    it('shows the filtered empty message when a filter matches nothing', async () => {
      mockListAuditLogs.mockImplementation(async ({ action }) =>
        action ? auditPage([]) : auditPage(sampleEntries),
      );

      renderPage();

      const trigger = await screen.findByRole('button', {
        name: 'Action Any action',
      });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      fireEvent.click(
        await screen.findByRole('menuitemcheckbox', { name: 'Disable' }),
      );

      expect(
        await screen.findByText('No audit log entries match these filters.'),
      ).toBeInTheDocument();
    });

    it('shows the error message and no pager when listAuditLogs rejects', async () => {
      mockListAuditLogs.mockRejectedValue(new Error('Network error'));

      renderPage();

      expect(
        await screen.findByText('Unable to load audit log. Please try again.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'Pages' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('phone', () => {
    beforeEach(() => {
      (useIsMobileState as jest.Mock).mockReturnValue(true);
    });

    it('shows the h1 with a Filters button that opens a sheet with the Action legend and checkboxes', async () => {
      renderPage();

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Audit log' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Every admin action, newest first/),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

      const sheet = await screen.findByRole('dialog', { name: 'Filters' });
      expect(
        within(sheet).getByRole('group', { name: 'Action' }),
      ).toBeInTheDocument();
      expect(within(sheet).getAllByRole('checkbox')).toHaveLength(13);
      expect(
        within(sheet).getByRole('checkbox', { name: 'Disable' }),
      ).toBeInTheDocument();
      expect(
        within(sheet).getByRole('button', { name: 'Clear filters' }),
      ).toBeDisabled();
      expect(
        within(sheet).getByRole('button', { name: 'Done' }),
      ).toBeInTheDocument();
    });

    it('ticks an action in the sheet, shows the count and a removable chip, and removes the filter from the chip', async () => {
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Filters' }));
      const sheet = await screen.findByRole('dialog', { name: 'Filters' });
      fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Disable' }));

      await waitFor(() => {
        expect(mockListAuditLogs).toHaveBeenLastCalledWith({
          userId: undefined,
          action: ['disable'],
          page: 1,
          pageSize: 25,
        });
      });

      fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));

      expect(
        await screen.findByRole('button', { name: 'Filters · 1' }),
      ).toBeInTheDocument();
      const chips = screen.getByRole('list', { name: 'Active filters' });
      fireEvent.click(
        within(chips).getByRole('button', { name: 'Remove filter Disable' }),
      );

      await waitFor(() => {
        expect(mockListAuditLogs).toHaveBeenLastCalledWith({
          userId: undefined,
          action: undefined,
          page: 1,
          pageSize: 25,
        });
      });
      expect(
        screen.queryByRole('list', { name: 'Active filters' }),
      ).not.toBeInTheDocument();
    });

    it('groups entries under Today, Yesterday and a date heading, with HH:mm times and "actor to target" rows', async () => {
      renderPage();

      const today = await screen.findByRole('heading', {
        level: 2,
        name: 'Today',
      });
      const todayRow = within(today.parentElement as HTMLElement).getByRole(
        'listitem',
      );
      expect(within(todayRow).getByText('09:58')).toBeInTheDocument();
      expect(todayRow).toHaveTextContent('Ana Costa → to Ben Okafor');

      const yesterday = screen.getByRole('heading', {
        level: 2,
        name: 'Yesterday',
      });
      const yesterdayRow = within(
        yesterday.parentElement as HTMLElement,
      ).getByRole('listitem');
      expect(within(yesterdayRow).getByText('17:20')).toBeInTheDocument();
      expect(yesterdayRow).toHaveTextContent('Ana Costa → to Cy Lindqvist');

      const earlier = screen.getByRole('heading', {
        level: 2,
        name: formatDayMonth(new Date(twoDaysAgoAt(11, 3)), now),
      });
      expect(
        within(earlier.parentElement as HTMLElement).getByText('Deleted user'),
      ).toBeInTheDocument();
      expect(screen.getByText('3 of 3')).toBeInTheDocument();
    });

    it('shows the footer as "Scroll for more · n of total" while more pages remain', async () => {
      arrangeThirtyEntries();

      renderPage();

      expect(
        await screen.findByText('Scroll for more · 25 of 30'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'Pages' }),
      ).not.toBeInTheDocument();
    });
  });

  it('does not render fields outside the entry contract from bloated entries', async () => {
    const leakSentinels = [
      'LEAK-SENTINEL-VAULT',
      'LEAK-SENTINEL-OPS',
      'LEAK-SENTINEL-NOTE',
    ] as const;

    const bloatedEntry = {
      ...sampleEntries[0],
      vaultCiphertext: 'LEAK-SENTINEL-VAULT',
      extraOperationalField: 'LEAK-SENTINEL-OPS',
      internalNote: 'LEAK-SENTINEL-NOTE',
    } as unknown as AdminAuditLogEntry;

    mockListAuditLogs.mockResolvedValue(auditPage([bloatedEntry]));

    renderPage();

    await screen.findByText('Disable');
    expect(screen.getByText('Ben Okafor')).toBeInTheDocument();

    for (const sentinel of leakSentinels) {
      expect(document.body.textContent).not.toContain(sentinel);
    }
  });
});
