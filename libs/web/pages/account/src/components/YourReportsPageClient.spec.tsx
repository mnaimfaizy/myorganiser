/* eslint-disable import/first */
jest.mock('../lib/apiClient', () => ({
  createFeedbackApi: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(),
  openFeedbackDialog: jest.fn(),
}));

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { format } from 'date-fns';
import { openFeedbackDialog, useIsMobileState } from '@myorganiser/web-ui';
import { createFeedbackApi } from '../lib/apiClient';
import { YourReportsPageClient } from './YourReportsPageClient';
import type { FeedbackReportListItemDto } from '@myorganiser/app-api-client';

function buildReport(
  overrides: Partial<FeedbackReportListItemDto> = {},
): FeedbackReportListItemDto {
  return {
    id: 'report-1',
    title: 'Export fails',
    kind: 'bug_report',
    status: 'received',
    statusNote: null,
    changelogUrl: null,
    releaseTag: null,
    statusChangedAt: null,
    followUp: null,
    createdAt: '2026-10-15T10:00:00Z',
    ...overrides,
  };
}

const mockListReports = jest.fn();
const mockMarkReportsSeen = jest.fn();
const mockAddFollowUp = jest.fn();

function setupMocks() {
  (createFeedbackApi as jest.Mock).mockReturnValue({
    listReports: mockListReports,
    markReportsSeen: mockMarkReportsSeen,
    addFollowUp: mockAddFollowUp,
  });
}

describe('YourReportsPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
    (useIsMobileState as jest.Mock).mockReturnValue(false);
  });

  it('should show loading state before fetch resolves', () => {
    // Keep listReports pending
    mockListReports.mockImplementation(
      () => new Promise(() => {}), // Never resolves
    );
    mockMarkReportsSeen.mockResolvedValue(undefined);

    render(<YourReportsPageClient />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('should show empty state when no reports exist', async () => {
    mockListReports.mockResolvedValue({
      data: { items: [], hasChangedSinceLastSeen: false },
    });
    mockMarkReportsSeen.mockResolvedValue(undefined);

    render(<YourReportsPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText("You haven't sent any feedback yet."),
      ).toBeInTheDocument();
    });
  });

  it('should show error state when listReports fails', async () => {
    mockListReports.mockRejectedValue(new Error('Network error'));
    mockMarkReportsSeen.mockResolvedValue(undefined);

    render(<YourReportsPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Failed to load your reports. Please try refreshing the page.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('should render a bug report with title, kind label, and status badge', async () => {
    const report: FeedbackReportListItemDto = {
      id: 'report-1',
      title: 'Login button unresponsive',
      kind: 'bug_report',
      status: 'received',
      statusNote: null,
      changelogUrl: null,
      releaseTag: null,
      statusChangedAt: null,
      followUp: null,
      createdAt: '2026-10-15T10:00:00Z',
    };

    mockListReports.mockResolvedValue({
      data: { items: [report], hasChangedSinceLastSeen: false },
    });
    mockMarkReportsSeen.mockResolvedValue(undefined);

    render(<YourReportsPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Login button unresponsive')).toBeInTheDocument();
    });

    expect(screen.getByText('Bug report')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('should render statusNote text when present', async () => {
    const report: FeedbackReportListItemDto = {
      id: 'report-1',
      title: 'Login issue',
      kind: 'bug_report',
      status: 'wont_do',
      statusNote: 'This is by design and not a bug.',
      changelogUrl: null,
      releaseTag: null,
      statusChangedAt: null,
      followUp: null,
      createdAt: '2026-10-15T10:00:00Z',
    };

    mockListReports.mockResolvedValue({
      data: { items: [report], hasChangedSinceLastSeen: false },
    });
    mockMarkReportsSeen.mockResolvedValue(undefined);

    render(<YourReportsPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('This is by design and not a bug.'),
      ).toBeInTheDocument();
    });
  });

  it('should render CHANGELOG link when report is fixed with changelogUrl and releaseTag', async () => {
    const report: FeedbackReportListItemDto = {
      id: 'report-1',
      title: 'Search bug',
      kind: 'bug_report',
      status: 'fixed',
      statusNote: null,
      changelogUrl: 'https://example.com/changelog#v1.2.0',
      releaseTag: 'v1.2.0',
      statusChangedAt: null,
      followUp: null,
      createdAt: '2026-10-15T10:00:00Z',
    };

    mockListReports.mockResolvedValue({
      data: { items: [report], hasChangedSinceLastSeen: false },
    });
    mockMarkReportsSeen.mockResolvedValue(undefined);

    render(<YourReportsPageClient />);

    await waitFor(() => {
      const link = screen.getByRole('link', {
        name: /Fixed in v1.2.0.*View CHANGELOG/,
      });
      expect(link).toHaveAttribute(
        'href',
        'https://example.com/changelog#v1.2.0',
      );
      expect(link).toHaveAttribute('target', '_blank');
    });
  });

  it('should render CHANGELOG link with "Shipped in" text when status is shipped', async () => {
    const report: FeedbackReportListItemDto = {
      id: 'report-1',
      title: 'Shipped feature',
      kind: 'suggestion',
      status: 'shipped',
      statusNote: null,
      changelogUrl: 'https://example.com/changelog#v1.3.0',
      releaseTag: 'v1.3.0',
      statusChangedAt: null,
      followUp: null,
      createdAt: '2026-10-15T10:00:00Z',
    };

    mockListReports.mockResolvedValue({
      data: { items: [report], hasChangedSinceLastSeen: false },
    });
    mockMarkReportsSeen.mockResolvedValue(undefined);

    render(<YourReportsPageClient />);

    await waitFor(() => {
      const link = screen.getByRole('link', {
        name: /Shipped in v1.3.0.*View CHANGELOG/,
      });
      expect(link).toHaveAttribute(
        'href',
        'https://example.com/changelog#v1.3.0',
      );
    });
  });

  it('should not render a CHANGELOG link for a planned report while a fixed report has one', async () => {
    const reports: FeedbackReportListItemDto[] = [
      {
        id: 'report-1',
        title: 'Fixed bug',
        kind: 'bug_report',
        status: 'fixed',
        statusNote: null,
        changelogUrl: 'https://example.com/changelog#v1.2.0',
        releaseTag: 'v1.2.0',
        statusChangedAt: null,
        followUp: null,
        createdAt: '2026-10-15T10:00:00Z',
      },
      {
        id: 'report-2',
        title: 'Planned feature',
        kind: 'suggestion',
        status: 'planned',
        statusNote: null,
        changelogUrl: null,
        releaseTag: null,
        statusChangedAt: null,
        followUp: null,
        createdAt: '2026-10-14T10:00:00Z',
      },
    ];

    mockListReports.mockResolvedValue({
      data: { items: reports, hasChangedSinceLastSeen: false },
    });
    mockMarkReportsSeen.mockResolvedValue(undefined);

    render(<YourReportsPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Planned feature')).toBeInTheDocument();
    });

    // Should have exactly one link (from the fixed report)
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('Fixed in v1.2.0');
  });

  it.each<[string, Partial<FeedbackReportListItemDto>]>([
    [
      'changelogUrl is null',
      {
        kind: 'bug_report',
        status: 'fixed',
        changelogUrl: null,
        releaseTag: 'v1.2.0',
      },
    ],
    [
      'releaseTag is null',
      {
        kind: 'bug_report',
        status: 'fixed',
        changelogUrl: 'https://example.com/changelog#v1.2.0',
        releaseTag: null,
      },
    ],
    [
      'the status is not the delivered status for the kind',
      {
        kind: 'suggestion',
        status: 'fixed',
        changelogUrl: 'https://example.com/changelog#v1.2.0',
        releaseTag: 'v1.2.0',
      },
    ],
  ])(
    'should not render a CHANGELOG link when %s',
    async (_label, overrides) => {
      mockListReports.mockResolvedValue({
        data: {
          items: [buildReport({ ...overrides, title: 'Delivered candidate' })],
          hasChangedSinceLastSeen: false,
        },
      });
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      expect(
        await screen.findByRole('heading', {
          level: 2,
          name: 'Delivered candidate',
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('link')).toBeNull();
    },
  );

  it('should call markReportsSeen exactly once on mount', async () => {
    const report: FeedbackReportListItemDto = {
      id: 'report-1',
      title: 'Test report',
      kind: 'bug_report',
      status: 'received',
      statusNote: null,
      changelogUrl: null,
      releaseTag: null,
      statusChangedAt: null,
      followUp: null,
      createdAt: '2026-10-15T10:00:00Z',
    };

    mockListReports.mockResolvedValue({
      data: { items: [report], hasChangedSinceLastSeen: false },
    });
    mockMarkReportsSeen.mockResolvedValue(undefined);

    render(<YourReportsPageClient />);

    await waitFor(() => {
      expect(mockMarkReportsSeen).toHaveBeenCalledTimes(1);
    });
  });

  it('should preserve list order as returned by API', async () => {
    const reports: FeedbackReportListItemDto[] = [
      {
        id: 'report-newest',
        title: 'Newest issue',
        kind: 'bug_report',
        status: 'received',
        statusNote: null,
        changelogUrl: null,
        releaseTag: null,
        statusChangedAt: null,
        followUp: null,
        createdAt: '2026-10-17T10:00:00Z',
      },
      {
        id: 'report-oldest',
        title: 'Oldest issue',
        kind: 'suggestion',
        status: 'received',
        statusNote: null,
        changelogUrl: null,
        releaseTag: null,
        statusChangedAt: null,
        followUp: null,
        createdAt: '2026-10-01T10:00:00Z',
      },
    ];

    mockListReports.mockResolvedValue({
      data: { items: reports, hasChangedSinceLastSeen: false },
    });
    mockMarkReportsSeen.mockResolvedValue(undefined);

    const { container } = render(<YourReportsPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Newest issue')).toBeInTheDocument();
    });

    // Verify order by checking that Newest appears before Oldest in the HTML
    const html = container.innerHTML;
    const newestIndex = html.indexOf('Newest issue');
    const oldestIndex = html.indexOf('Oldest issue');
    expect(newestIndex).toBeLessThan(oldestIndex);
  });

  describe('Follow-up box', () => {
    it('should show the follow-up form for cannot_reproduce status without existing follow-up', async () => {
      const report: FeedbackReportListItemDto = {
        id: 'report-1',
        title: 'Cannot reproduce this issue',
        kind: 'bug_report',
        status: 'cannot_reproduce',
        statusNote: "Can't repro — please add detail.",
        changelogUrl: null,
        releaseTag: null,
        statusChangedAt: null,
        followUp: null,
        createdAt: '2026-10-15T10:00:00Z',
      };

      mockListReports.mockResolvedValue({
        data: { items: [report], hasChangedSinceLastSeen: false },
      });
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Send follow-up/ }),
        ).toBeInTheDocument();
      });
    });

    it('should hide follow-up form and show read-only text when follow-up already exists', async () => {
      const report: FeedbackReportListItemDto = {
        id: 'report-1',
        title: 'Issue with follow-up',
        kind: 'bug_report',
        status: 'cannot_reproduce',
        statusNote: null,
        changelogUrl: null,
        releaseTag: null,
        statusChangedAt: null,
        followUp: 'Already sent this.',
        createdAt: '2026-10-15T10:00:00Z',
      };

      mockListReports.mockResolvedValue({
        data: { items: [report], hasChangedSinceLastSeen: false },
      });
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      await waitFor(() => {
        expect(screen.getByText('Already sent this.')).toBeInTheDocument();
      });

      expect(
        screen.queryByRole('button', { name: /Send follow-up/ }),
      ).not.toBeInTheDocument();
    });

    it('should not show follow-up form for non-cannot_reproduce statuses', async () => {
      const report: FeedbackReportListItemDto = {
        id: 'report-1',
        title: 'Received issue',
        kind: 'bug_report',
        status: 'received',
        statusNote: null,
        changelogUrl: null,
        releaseTag: null,
        statusChangedAt: null,
        followUp: null,
        createdAt: '2026-10-15T10:00:00Z',
      };

      mockListReports.mockResolvedValue({
        data: { items: [report], hasChangedSinceLastSeen: false },
      });
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      await waitFor(() => {
        expect(screen.getByText('Received issue')).toBeInTheDocument();
      });

      expect(
        screen.queryByRole('button', { name: /Send follow-up/ }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Your follow-up')).not.toBeInTheDocument();
    });

    it('should show read-only follow-up text even when status changes after initial follow-up', async () => {
      const report: FeedbackReportListItemDto = {
        id: 'report-1',
        title: 'Report moved to under review',
        kind: 'bug_report',
        status: 'under_review',
        statusNote: null,
        changelogUrl: null,
        releaseTag: null,
        statusChangedAt: null,
        followUp: 'My extra detail.',
        createdAt: '2026-10-15T10:00:00Z',
      };

      mockListReports.mockResolvedValue({
        data: { items: [report], hasChangedSinceLastSeen: false },
      });
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      await waitFor(() => {
        expect(screen.getByText('My extra detail.')).toBeInTheDocument();
      });

      expect(
        screen.queryByRole('button', { name: /Send follow-up/ }),
      ).not.toBeInTheDocument();
    });

    it('should update report status and show follow-up text after successful submission', async () => {
      const initialReport: FeedbackReportListItemDto = {
        id: 'report-1',
        title: 'Issue needing follow-up',
        kind: 'bug_report',
        status: 'cannot_reproduce',
        statusNote: null,
        changelogUrl: null,
        releaseTag: null,
        statusChangedAt: null,
        followUp: null,
        createdAt: '2026-10-15T10:00:00Z',
      };

      const updatedReport: FeedbackReportListItemDto = {
        ...initialReport,
        status: 'under_review',
        followUp: 'Extra detail added',
      };

      mockListReports.mockResolvedValue({
        data: { items: [initialReport], hasChangedSinceLastSeen: false },
      });
      mockMarkReportsSeen.mockResolvedValue(undefined);
      mockAddFollowUp.mockResolvedValue({
        data: updatedReport,
      });

      render(<YourReportsPageClient />);

      // Wait for the follow-up form button to appear
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Send follow-up/ }),
        ).toBeInTheDocument();
      });

      // Find the textarea and type a message
      const textarea = screen.getByPlaceholderText('Add more detail…');
      fireEvent.change(textarea, { target: { value: 'Extra detail added' } });

      // Click the submit button
      const submitButton = screen.getByRole('button', {
        name: /Send follow-up/,
      });
      fireEvent.click(submitButton);

      // Wait for the form to be replaced with the read-only text
      await waitFor(() => {
        expect(screen.getByText('Extra detail added')).toBeInTheDocument();
      });

      // Verify the form is gone
      expect(
        screen.queryByRole('button', { name: /Send follow-up/ }),
      ).not.toBeInTheDocument();

      expect(mockAddFollowUp).toHaveBeenCalledWith({
        reportId: 'report-1',
        addFollowUpRequest: { followUp: 'Extra detail added' },
      });

      // Verify the status changed
      expect(screen.getByText('Under review')).toBeInTheDocument();
    });

    it('should show follow-up form only for eligible report when multiple reports exist', async () => {
      const reportA: FeedbackReportListItemDto = {
        id: 'report-a',
        title: 'Cannot reproduce',
        kind: 'bug_report',
        status: 'cannot_reproduce',
        statusNote: null,
        changelogUrl: null,
        releaseTag: null,
        statusChangedAt: null,
        followUp: null,
        createdAt: '2026-10-15T10:00:00Z',
      };

      const reportB: FeedbackReportListItemDto = {
        id: 'report-b',
        title: 'Planned feature',
        kind: 'suggestion',
        status: 'planned',
        statusNote: null,
        changelogUrl: null,
        releaseTag: null,
        statusChangedAt: null,
        followUp: null,
        createdAt: '2026-10-14T10:00:00Z',
      };

      mockListReports.mockResolvedValue({
        data: { items: [reportA, reportB], hasChangedSinceLastSeen: false },
      });
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      await waitFor(() => {
        expect(screen.getByText('Cannot reproduce')).toBeInTheDocument();
      });

      const eligibleCard = screen
        .getByRole('heading', { level: 2, name: 'Cannot reproduce' })
        .closest('article') as HTMLElement;
      const plannedCard = screen
        .getByRole('heading', { level: 2, name: 'Planned feature' })
        .closest('article') as HTMLElement;

      expect(
        within(eligibleCard).getByRole('button', { name: /Send follow-up/ }),
      ).toBeInTheDocument();
      expect(
        within(plannedCard).queryByRole('button', { name: /Send follow-up/ }),
      ).toBeNull();
    });
  });

  describe('header', () => {
    it('renders one visible h1 and a Send feedback button on desktop, which opens the dialog once', () => {
      mockListReports.mockImplementation(() => new Promise(() => {}));
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent('Your reports');
      expect(headings[0]).toBeVisible();

      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

      expect(openFeedbackDialog).toHaveBeenCalledTimes(1);
    });

    it('renders one h1 and a Send feedback button on phone, which opens the dialog once', () => {
      (useIsMobileState as jest.Mock).mockReturnValue(true);
      mockListReports.mockImplementation(() => new Promise(() => {}));
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent('Your reports');

      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

      expect(openFeedbackDialog).toHaveBeenCalledTimes(1);
    });
  });

  describe('empty state', () => {
    it('shows its own heading and Send feedback button, which opens the dialog', async () => {
      mockListReports.mockResolvedValue({
        data: { items: [], hasChangedSinceLastSeen: false },
      });
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      const heading = await screen.findByRole('heading', {
        level: 2,
        name: "You haven't sent any feedback yet.",
      });
      // Desktop shows the header button and the empty-card button.
      expect(
        screen.getAllByRole('button', { name: 'Send feedback' }),
      ).toHaveLength(2);

      const emptyCard = heading.parentElement as HTMLElement;
      fireEvent.click(
        within(emptyCard).getByRole('button', { name: 'Send feedback' }),
      );

      expect(openFeedbackDialog).toHaveBeenCalledTimes(1);
    });
  });

  describe('report card', () => {
    const dateLabel = format(new Date('2026-10-15T10:00:00Z'), 'PP');

    it('renders the title as a heading in an article, with kind, status and date as separate elements on desktop', async () => {
      mockListReports.mockResolvedValue({
        data: { items: [buildReport()], hasChangedSinceLastSeen: false },
      });
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      const article = await screen.findByRole('article');
      expect(
        within(article).getByRole('heading', {
          level: 2,
          name: 'Export fails',
        }),
      ).toBeInTheDocument();
      expect(within(article).getByText('Bug report')).toBeInTheDocument();
      expect(within(article).getByText('Received')).toBeInTheDocument();
      expect(within(article).getByText(dateLabel)).toBeInTheDocument();
      expect(
        within(article).queryByText(`Bug report · ${dateLabel}`),
      ).toBeNull();
    });

    it('combines kind and date on one line and drops the standalone date on phone', async () => {
      (useIsMobileState as jest.Mock).mockReturnValue(true);
      mockListReports.mockResolvedValue({
        data: { items: [buildReport()], hasChangedSinceLastSeen: false },
      });
      mockMarkReportsSeen.mockResolvedValue(undefined);

      render(<YourReportsPageClient />);

      const article = await screen.findByRole('article');
      expect(
        within(article).getByText(`Bug report · ${dateLabel}`),
      ).toBeInTheDocument();
      expect(within(article).getByText('Received')).toBeInTheDocument();
      expect(within(article).queryByText(dateLabel)).toBeNull();
    });
  });

  describe('status labels', () => {
    const statusRows: Array<[FeedbackReportListItemDto['status'], string]> = [
      ['received', 'Received'],
      ['under_review', 'Under review'],
      ['planned', 'Planned'],
      ['fixed', 'Fixed'],
      ['shipped', 'Shipped'],
      ['wont_do', "Won't do"],
      ['cannot_reproduce', "Can't reproduce"],
    ];

    it.each(statusRows)(
      'renders the %s status as "%s"',
      async (status, label) => {
        mockListReports.mockResolvedValue({
          data: {
            items: [buildReport({ status })],
            hasChangedSinceLastSeen: false,
          },
        });
        mockMarkReportsSeen.mockResolvedValue(undefined);

        render(<YourReportsPageClient />);

        const article = await screen.findByRole('article');
        expect(within(article).getByText(label)).toBeInTheDocument();
      },
    );
  });

  describe('mark-as-seen failure', () => {
    it('still renders the reports when markReportsSeen rejects', async () => {
      const debugSpy = jest
        .spyOn(console, 'debug')
        .mockImplementation(() => {});
      mockListReports.mockResolvedValue({
        data: {
          items: [buildReport({ title: 'Still visible' })],
          hasChangedSinceLastSeen: false,
        },
      });
      mockMarkReportsSeen.mockRejectedValue(new Error('Mark failed'));

      render(<YourReportsPageClient />);

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Still visible' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          'Failed to load your reports. Please try refreshing the page.',
        ),
      ).toBeNull();
      debugSpy.mockRestore();
    });
  });

  describe('breakpoint not yet decided', () => {
    it('renders nothing but still fetches reports and marks them seen', () => {
      (useIsMobileState as jest.Mock).mockReturnValue(undefined);
      mockListReports.mockImplementation(() => new Promise(() => {}));
      mockMarkReportsSeen.mockResolvedValue(undefined);

      const { container } = render(<YourReportsPageClient />);

      expect(container).toBeEmptyDOMElement();
      expect(mockListReports).toHaveBeenCalledTimes(1);
      expect(mockMarkReportsSeen).toHaveBeenCalledTimes(1);
    });
  });
});
