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
  AdminFeedbackReportListItemDto,
  FeedbackReportKind,
  FeedbackReportPlatform,
  FeedbackReportStatus,
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
import {
  FEEDBACK_INBOX_PAGE_SIZE,
  formatFeedbackPhoneSent,
  formatFeedbackReportPlatform,
} from '../lib/feedbackInbox';
import {
  formatFeedbackReportKind,
  formatFeedbackReportStatus,
} from '../lib/formatFeedbackReport';

import { FeedbackInboxPageClient } from './FeedbackInboxPageClient';

// jsdom has no pointer capture or scrollIntoView, which Radix Select and Dialog call.
Element.prototype.scrollIntoView = jest.fn();
Element.prototype.hasPointerCapture = jest.fn(() => false);
Element.prototype.releasePointerCapture = jest.fn();

const mockListFeedbackReports = jest.fn();

/** The request shape the hook sends. Unset filters are `undefined`. */
interface ListParams {
  status?: FeedbackReportStatus;
  kind?: FeedbackReportKind;
  platform?: FeedbackReportPlatform;
  trackingIssueNumber?: number;
  page?: number;
  pageSize: number;
}

/** The second request on mount: `pageSize: 1`, read only for its total. */
const RECEIVED_TOTAL = 6;
const UNFILTERED_TOTAL = 30;

function listPage(
  items: AdminFeedbackReportListItemDto[],
  total: number,
  page = 1,
) {
  return {
    data: { items, total, page, pageSize: FEEDBACK_INBOX_PAGE_SIZE },
  };
}

const sampleReports: AdminFeedbackReportListItemDto[] = [
  {
    id: 'report-1',
    title: 'App crashes on login',
    kind: 'bug_report',
    status: 'received',
    platform: 'web',
    trackingIssueNumber: null,
    reporterUserId: 'user-123',
    reporter: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
    statusChangedAt: null,
    createdAt: '2026-10-17T10:00:00.000Z',
  },
  {
    id: 'report-2',
    title: 'Add dark mode',
    kind: 'suggestion',
    status: 'under_review',
    platform: 'android',
    trackingIssueNumber: 42,
    reporterUserId: 'user-456',
    reporter: { id: 'user-456', name: null, email: 'another@example.com' },
    statusChangedAt: null,
    createdAt: '2026-10-16T15:30:00.000Z',
  },
  {
    id: 'report-3',
    title: 'Lost data after sync',
    kind: 'bug_report',
    status: 'planned',
    platform: 'web',
    trackingIssueNumber: null,
    reporterUserId: null,
    reporter: null,
    statusChangedAt: null,
    createdAt: '2026-10-15T08:45:00.000Z',
  },
];

/** Fills page 1 to a full 25 rows, so the range reads "1–25 of 30". */
const fillerReports: AdminFeedbackReportListItemDto[] = Array.from(
  { length: FEEDBACK_INBOX_PAGE_SIZE - sampleReports.length },
  (_, index) => ({
    id: `filler-${index + 1}`,
    title: `Filler report ${index + 1}`,
    kind: 'suggestion',
    status: 'received',
    platform: 'web',
    trackingIssueNumber: null,
    reporterUserId: null,
    reporter: null,
    statusChangedAt: null,
    createdAt: '2026-10-14T09:00:00.000Z',
  }),
);

const firstPage = [...sampleReports, ...fillerReports];

const laterPage: AdminFeedbackReportListItemDto[] = Array.from(
  { length: UNFILTERED_TOTAL - FEEDBACK_INBOX_PAGE_SIZE },
  (_, index) => ({
    id: `later-${index + 1}`,
    title: `Later report ${index + 1}`,
    kind: 'bug_report',
    status: 'received',
    platform: 'ios',
    trackingIssueNumber: null,
    reporterUserId: null,
    reporter: null,
    statusChangedAt: null,
    createdAt: '2026-10-13T09:00:00.000Z',
  }),
);

function hasFilter(params: ListParams): boolean {
  return (
    params.status !== undefined ||
    params.kind !== undefined ||
    params.platform !== undefined ||
    params.trackingIssueNumber !== undefined
  );
}

/** Narrows the sample reports the way the API would, for any filter that is set. */
function matchesFilters(
  report: AdminFeedbackReportListItemDto,
  params: ListParams,
): boolean {
  return (
    (params.status === undefined || report.status === params.status) &&
    (params.kind === undefined || report.kind === params.kind) &&
    (params.platform === undefined || report.platform === params.platform) &&
    (params.trackingIssueNumber === undefined ||
      report.trackingIssueNumber === params.trackingIssueNumber)
  );
}

function respond(params: ListParams) {
  if (params.pageSize === 1) return listPage([], RECEIVED_TOTAL);
  if (hasFilter(params)) {
    const matches = sampleReports.filter((report) =>
      matchesFilters(report, params),
    );
    return listPage(matches, matches.length);
  }
  if (params.page === 2) return listPage(laterPage, UNFILTERED_TOTAL, 2);
  return listPage(firstPage, UNFILTERED_TOTAL, 1);
}

function lastListParams(): ListParams {
  const calls = mockListFeedbackReports.mock.calls;
  return calls[calls.length - 1][0] as ListParams;
}

describe('FeedbackInboxPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      listFeedbackReports: mockListFeedbackReports,
    });
    mockListFeedbackReports.mockImplementation((params: ListParams) =>
      Promise.resolve(respond(params)),
    );
  });

  describe('desktop', () => {
    beforeEach(() => {
      (useIsMobileState as jest.Mock).mockReturnValue(false);
    });

    it('renders one Feedback heading and a subtitle with the Received count from the second request', async () => {
      render(<FeedbackInboxPageClient />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Feedback' }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText(
          /Bug Reports and Suggestions, newest first\. 6 are Received and waiting for triage\./,
        ),
      ).toBeInTheDocument();
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        status: 'received',
        pageSize: 1,
      });
    });

    it('links each title to its report, shows the kind, status, and raw platform, and links a tracking issue to GitHub in a new tab (or a dash)', async () => {
      render(<FeedbackInboxPageClient />);

      const titleLink = await screen.findByRole('link', {
        name: 'App crashes on login',
      });
      expect(titleLink).toHaveAttribute('href', '/admin/feedback/report-1');

      const row = titleLink.closest('tr') as HTMLElement;
      expect(within(row).getByText('Bug report')).toBeInTheDocument();
      expect(within(row).getByText('Received')).toBeInTheDocument();
      expect(within(row).getByText('web')).toBeInTheDocument();
      expect(within(row).getByText('—')).toBeInTheDocument();

      const issueRow = (
        await screen.findByRole('link', { name: 'Add dark mode' })
      ).closest('tr') as HTMLElement;
      const issueLink = within(issueRow).getByRole('link', { name: /^42/ });
      expect(issueLink).toHaveAttribute(
        'href',
        'https://github.com/mnaimfaizy/myorganiser/issues/42',
      );
      expect(issueLink).toHaveAttribute('target', '_blank');
    });

    it('links the sender to their user page, with the email beneath a named sender, and shows Deleted for a removed reporter', async () => {
      render(<FeedbackInboxPageClient />);

      const row = (
        await screen.findByRole('link', { name: 'App crashes on login' })
      ).closest('tr') as HTMLElement;
      expect(
        within(row).getByRole('link', { name: 'Test User' }),
      ).toHaveAttribute('href', '/admin/users/user-123');
      expect(within(row).getByText('test@example.com')).toBeInTheDocument();

      // Unnamed sender: the email is the link text, with no second copy beneath.
      const unnamedRow = screen
        .getByRole('link', { name: 'Add dark mode' })
        .closest('tr') as HTMLElement;
      expect(
        within(unnamedRow).getByRole('link', { name: 'another@example.com' }),
      ).toHaveAttribute('href', '/admin/users/user-456');
      expect(
        within(unnamedRow).getAllByText('another@example.com'),
      ).toHaveLength(1);

      const deletedRow = screen
        .getByRole('link', { name: 'Lost data after sync' })
        .closest('tr') as HTMLElement;
      expect(within(deletedRow).getByText('Deleted')).toBeInTheDocument();
      expect(
        within(deletedRow)
          .getAllByRole('link')
          .map((link) => link.getAttribute('href')),
      ).toEqual(['/admin/feedback/report-3']);
    });

    it('sends the Status, Kind, and Platform selections, each on page 1', async () => {
      render(<FeedbackInboxPageClient />);
      await screen.findByRole('link', { name: 'App crashes on login' });

      fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
      fireEvent.click(
        await screen.findByRole('option', {
          name: formatFeedbackReportStatus('planned'),
        }),
      );
      await waitFor(() => {
        expect(lastListParams()).toEqual(
          expect.objectContaining({ status: 'planned', page: 1 }),
        );
      });

      fireEvent.click(screen.getByRole('combobox', { name: 'Kind' }));
      fireEvent.click(
        await screen.findByRole('option', {
          name: formatFeedbackReportKind('bug_report'),
        }),
      );
      await waitFor(() => {
        expect(lastListParams()).toEqual(
          expect.objectContaining({ kind: 'bug_report', page: 1 }),
        );
      });

      fireEvent.click(screen.getByRole('combobox', { name: 'Platform' }));
      fireEvent.click(
        await screen.findByRole('option', {
          name: formatFeedbackReportPlatform('ios'),
        }),
      );
      await waitFor(() => {
        expect(lastListParams()).toEqual(
          expect.objectContaining({
            status: 'planned',
            kind: 'bug_report',
            platform: 'ios',
            page: 1,
            pageSize: FEEDBACK_INBOX_PAGE_SIZE,
          }),
        );
      });
    });

    it('ignores non-numeric tracking issue text and sends a whole number as trackingIssueNumber', async () => {
      render(<FeedbackInboxPageClient />);
      await screen.findByRole('link', { name: 'App crashes on login' });
      const callsBefore = mockListFeedbackReports.mock.calls.length;

      const issueInput = screen.getByPlaceholderText(
        'Issue number',
      ) as HTMLInputElement;
      fireEvent.change(issueInput, { target: { value: 'abc' } });
      expect(issueInput).toHaveValue('abc');
      expect(mockListFeedbackReports).toHaveBeenCalledTimes(callsBefore);

      fireEvent.change(issueInput, { target: { value: '42' } });
      await waitFor(() => {
        expect(lastListParams()).toEqual(
          expect.objectContaining({ trackingIssueNumber: 42, page: 1 }),
        );
      });
    });

    it('clears every filter and refetches without filters when Clear filters is clicked', async () => {
      render(<FeedbackInboxPageClient />);
      await screen.findByRole('link', { name: 'App crashes on login' });

      fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
      fireEvent.click(
        await screen.findByRole('option', {
          name: formatFeedbackReportStatus('planned'),
        }),
      );
      fireEvent.click(screen.getByRole('combobox', { name: 'Kind' }));
      fireEvent.click(
        await screen.findByRole('option', {
          name: formatFeedbackReportKind('bug_report'),
        }),
      );
      fireEvent.click(screen.getByRole('combobox', { name: 'Platform' }));
      fireEvent.click(
        await screen.findByRole('option', {
          name: formatFeedbackReportPlatform('ios'),
        }),
      );
      const issueInput = screen.getByPlaceholderText(
        'Issue number',
      ) as HTMLInputElement;
      fireEvent.change(issueInput, { target: { value: '42' } });
      await waitFor(() => {
        expect(lastListParams()).toEqual(
          expect.objectContaining({
            status: 'planned',
            kind: 'bug_report',
            platform: 'ios',
            trackingIssueNumber: 42,
          }),
        );
      });

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

      await waitFor(() => {
        expect(mockListFeedbackReports).toHaveBeenLastCalledWith({
          page: 1,
          pageSize: FEEDBACK_INBOX_PAGE_SIZE,
        });
      });
      expect(
        screen.getByRole('combobox', { name: 'Status' }),
      ).toHaveTextContent('All statuses');
      expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveTextContent(
        'All kinds',
      );
      expect(
        screen.getByRole('combobox', { name: 'Platform' }),
      ).toHaveTextContent('Any platform');
      expect(issueInput).toHaveValue('');
    });

    it('shows the unfiltered range with Newer disabled on page 1', async () => {
      render(<FeedbackInboxPageClient />);

      expect(
        await screen.findByText('Showing 1–25 of 30 reports'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();
    });

    it('says "matching reports" in the range under a filter', async () => {
      render(<FeedbackInboxPageClient />);
      await screen.findByRole('link', { name: 'App crashes on login' });

      fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
      fireEvent.click(
        await screen.findByRole('option', {
          name: formatFeedbackReportStatus('planned'),
        }),
      );

      expect(
        await screen.findByText('Showing 1–1 of 1 matching reports'),
      ).toBeInTheDocument();
    });

    it('pages forward with Older (Older disabled on the last page) and back with Newer to page 1', async () => {
      render(<FeedbackInboxPageClient />);
      const older = await screen.findByRole('button', { name: 'Older' });
      expect(older).toBeEnabled();

      fireEvent.click(older);

      await waitFor(() => {
        expect(mockListFeedbackReports).toHaveBeenLastCalledWith({
          page: 2,
          pageSize: FEEDBACK_INBOX_PAGE_SIZE,
        });
      });
      expect(
        await screen.findByText('Showing 26–30 of 30 reports'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Newer' }));

      await waitFor(() => {
        expect(mockListFeedbackReports).toHaveBeenLastCalledWith({
          page: 1,
          pageSize: FEEDBACK_INBOX_PAGE_SIZE,
        });
      });
      expect(
        await screen.findByText('Showing 1–25 of 30 reports'),
      ).toBeInTheDocument();
    });

    it('shows the loading wording while the first request is pending', async () => {
      mockListFeedbackReports.mockImplementation((params: ListParams) =>
        params.pageSize === 1
          ? Promise.resolve(listPage([], RECEIVED_TOTAL))
          : new Promise(() => {}),
      );

      render(<FeedbackInboxPageClient />);
      // Let the Received-count request settle inside act.
      await screen.findByText(/are Received and waiting for triage/);

      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'Pages' }),
      ).not.toBeInTheDocument();
    });

    it('shows the error wording and no pager when the list request rejects', async () => {
      mockListFeedbackReports.mockImplementation((params: ListParams) =>
        params.pageSize === 1
          ? Promise.resolve(listPage([], RECEIVED_TOTAL))
          : Promise.reject(new Error('Network error')),
      );

      render(<FeedbackInboxPageClient />);

      expect(
        await screen.findByText(
          'Unable to load feedback reports. Please try again.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'Pages' }),
      ).not.toBeInTheDocument();
    });

    it('shows the empty wording and no pager when no report matches', async () => {
      mockListFeedbackReports.mockImplementation((params: ListParams) =>
        Promise.resolve(
          params.pageSize === 1
            ? listPage([], RECEIVED_TOTAL)
            : listPage([], 0),
        ),
      );

      render(<FeedbackInboxPageClient />);

      expect(
        await screen.findByText('No feedback reports match these filters.'),
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

    it('starts with All statuses pressed, and pressing Received sends that status and flips the pressed chip', async () => {
      render(<FeedbackInboxPageClient />);

      const toolbar = screen.getByRole('toolbar', { name: 'Status' });
      const allChip = within(toolbar).getByRole('button', {
        name: 'All statuses',
      });
      const receivedChip = within(toolbar).getByRole('button', {
        name: 'Received',
      });
      expect(allChip).toHaveAttribute('aria-pressed', 'true');
      expect(receivedChip).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(receivedChip);

      await waitFor(() => {
        expect(mockListFeedbackReports).toHaveBeenLastCalledWith({
          status: 'received',
          page: 1,
          pageSize: FEEDBACK_INBOX_PAGE_SIZE,
        });
      });
      expect(receivedChip).toHaveAttribute('aria-pressed', 'true');
      expect(allChip).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows the phone caption, a row that links to its report with a summary line, and the scroll count', async () => {
      render(<FeedbackInboxPageClient />);

      expect(
        await screen.findByText('6 Received, waiting for triage'),
      ).toBeInTheDocument();

      const link = await screen.findByRole('link', {
        name: /App crashes on login/,
      });
      expect(link).toHaveAttribute('href', '/admin/feedback/report-1');
      expect(
        within(link).getByText(
          `${formatFeedbackReportKind('bug_report')} · Test User · ${formatFeedbackPhoneSent('2026-10-17T10:00:00.000Z')}`,
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByText('Scroll for more · 25 of 30'),
      ).toBeInTheDocument();
    });

    it('shows the error wording and no scroll count when the list request rejects', async () => {
      mockListFeedbackReports.mockImplementation((params: ListParams) =>
        params.pageSize === 1
          ? Promise.resolve(listPage([], RECEIVED_TOTAL))
          : Promise.reject(new Error('Network error')),
      );

      render(<FeedbackInboxPageClient />);

      expect(
        await screen.findByText(
          'Unable to load feedback reports. Please try again.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Scroll for more/)).not.toBeInTheDocument();
    });

    it('applies a Kind chosen in the filter sheet, shows the count on the trigger, and closes to a 1 of 1 footer', async () => {
      render(<FeedbackInboxPageClient />);
      await screen.findByRole('link', { name: /App crashes on login/ });

      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
      fireEvent.click(await screen.findByRole('combobox', { name: 'Kind' }));
      fireEvent.click(
        await screen.findByRole('option', {
          name: formatFeedbackReportKind('suggestion'),
        }),
      );

      await waitFor(() => {
        expect(lastListParams()).toEqual(
          expect.objectContaining({ kind: 'suggestion', page: 1 }),
        );
      });

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));

      expect(
        await screen.findByRole('button', { name: 'Filters · 1' }),
      ).toBeInTheDocument();
      expect(await screen.findByText('1 of 1')).toBeInTheDocument();
    });
  });
});
