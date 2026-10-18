/* eslint-disable import/first */
jest.mock('../lib/apiClient', () => ({
  createFeedbackApi: jest.fn(),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createFeedbackApi } from '../lib/apiClient';
import { YourReportsPageClient } from './YourReportsPageClient';
import type { FeedbackReportListItemDto } from '@myorganiser/app-api-client';

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

  it('should not render CHANGELOG link when changelogUrl is null despite other links existing', async () => {
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

      // Verify exactly one "Send follow-up" button
      const buttons = screen.getAllByRole('button', { name: /Send follow-up/ });
      expect(buttons).toHaveLength(1);
    });
  });
});
