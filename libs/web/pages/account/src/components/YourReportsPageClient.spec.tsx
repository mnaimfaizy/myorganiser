/* eslint-disable import/first */
jest.mock('../lib/apiClient', () => ({
  createFeedbackApi: jest.fn(),
}));

import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createFeedbackApi } from '../lib/apiClient';
import { YourReportsPageClient } from './YourReportsPageClient';
import type { FeedbackReportListItemDto } from '@myorganiser/app-api-client';

const mockListReports = jest.fn();
const mockMarkReportsSeen = jest.fn();

function setupMocks() {
  (createFeedbackApi as jest.Mock).mockReturnValue({
    listReports: mockListReports,
    markReportsSeen: mockMarkReportsSeen,
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
});
