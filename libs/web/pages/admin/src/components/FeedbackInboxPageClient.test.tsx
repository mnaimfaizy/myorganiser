/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

// Mock scrollIntoView which jsdom doesn't support
Element.prototype.scrollIntoView = jest.fn();

import type { AdminFeedbackReportListItemDto } from '@myorganiser/app-api-client';
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
  formatFeedbackReportStatus,
  formatFeedbackReportKind,
} from '../lib/formatFeedbackReport';

import { FeedbackInboxPageClient } from './FeedbackInboxPageClient';

const mockListFeedbackReports = jest.fn();

// Mirrors the component's stopgap page size (#1269 replaces it with paging).
const INBOX_PAGE_SIZE = 100;

function responseFor(items: AdminFeedbackReportListItemDto[]) {
  return {
    data: {
      items,
      total: items.length,
      page: 1,
      pageSize: INBOX_PAGE_SIZE,
    },
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

describe('FeedbackInboxPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      listFeedbackReports: mockListFeedbackReports,
    });
    mockListFeedbackReports.mockResolvedValue(responseFor(sampleReports));
  });

  it('calls listFeedbackReports with only pageSize on mount', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });
  });

  it('renders table rows with report titles and kinds', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(screen.getByText('App crashes on login')).toBeInTheDocument();
    });

    expect(screen.getByText('Add dark mode')).toBeInTheDocument();
    expect(screen.getByText('Lost data after sync')).toBeInTheDocument();
    expect(
      screen.getAllByText(formatFeedbackReportKind('bug_report')),
    ).toHaveLength(2);
    expect(
      screen.getByText(formatFeedbackReportKind('suggestion')),
    ).toBeInTheDocument();
  });

  it('opens status filter dropdown and refetches when status is selected', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });

    const statusTrigger = screen.getByRole('combobox', { name: 'Status' });
    fireEvent.click(statusTrigger);

    const plannedOption = await screen.findByRole('option', {
      name: formatFeedbackReportStatus('planned'),
    });
    fireEvent.click(plannedOption);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        status: 'planned',
        pageSize: INBOX_PAGE_SIZE,
      });
    });
  });

  it('opens kind filter dropdown and refetches when kind is selected', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });

    const kindTrigger = screen.getByRole('combobox', { name: 'Kind' });
    fireEvent.click(kindTrigger);

    const bugOption = await screen.findByRole('option', {
      name: formatFeedbackReportKind('bug_report'),
    });
    fireEvent.click(bugOption);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        kind: 'bug_report',
        pageSize: INBOX_PAGE_SIZE,
      });
    });
  });

  it('clears status filter when All statuses is selected', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });

    // First select a status
    let statusTrigger = screen.getByRole('combobox', { name: 'Status' });
    fireEvent.click(statusTrigger);
    const plannedOption = await screen.findByRole('option', {
      name: formatFeedbackReportStatus('planned'),
    });
    fireEvent.click(plannedOption);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        status: 'planned',
        pageSize: INBOX_PAGE_SIZE,
      });
    });

    // Then select "All statuses"
    statusTrigger = screen.getByRole('combobox', { name: 'Status' });
    fireEvent.click(statusTrigger);
    const allOption = await screen.findByRole('option', {
      name: 'All statuses',
    });
    fireEvent.click(allOption);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenLastCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });
  });

  it('refetches with platform filter when platform text is entered', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });

    const platformInput = screen.getByPlaceholderText(
      'Any platform',
    ) as HTMLInputElement;
    fireEvent.change(platformInput, { target: { value: 'web' } });

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        platform: 'web',
        pageSize: INBOX_PAGE_SIZE,
      });
    });
  });

  it('trims a known platform before sending it to the API', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });

    const platformInput = screen.getByPlaceholderText(
      'Any platform',
    ) as HTMLInputElement;
    fireEvent.change(platformInput, { target: { value: '  ios  ' } });

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        platform: 'ios',
        pageSize: INBOX_PAGE_SIZE,
      });
    });
  });

  it('shows the empty state without calling the API for an unknown platform', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(screen.getByText('App crashes on login')).toBeInTheDocument();
    });
    const callsBeforeInput = mockListFeedbackReports.mock.calls.length;

    const platformInput = screen.getByPlaceholderText(
      'Any platform',
    ) as HTMLInputElement;
    fireEvent.change(platformInput, { target: { value: 'mobile' } });

    await waitFor(() => {
      expect(
        screen.getByText('No feedback reports match these filters.'),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(mockListFeedbackReports).toHaveBeenCalledTimes(callsBeforeInput);
    expect(mockListFeedbackReports).not.toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'mobile' }),
    );
  });

  it('treats a platform with the wrong case as unknown and does not call the API for it', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(screen.getByText('App crashes on login')).toBeInTheDocument();
    });
    const callsBeforeInput = mockListFeedbackReports.mock.calls.length;

    const platformInput = screen.getByPlaceholderText(
      'Any platform',
    ) as HTMLInputElement;
    fireEvent.change(platformInput, { target: { value: 'Web' } });

    await waitFor(() => {
      expect(
        screen.getByText('No feedback reports match these filters.'),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(mockListFeedbackReports).toHaveBeenCalledTimes(callsBeforeInput);
    expect(mockListFeedbackReports).not.toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'Web' }),
    );
  });

  it('refetches with trackingIssueNumber as a number when valid issue number is entered', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });

    const issueInput = screen.getByPlaceholderText(
      'Issue number',
    ) as HTMLInputElement;
    fireEvent.change(issueInput, { target: { value: '42' } });

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        trackingIssueNumber: 42,
        pageSize: INBOX_PAGE_SIZE,
      });
    });
  });

  it('excludes trackingIssueNumber from request when issue field has invalid value', async () => {
    mockListFeedbackReports.mockClear();
    mockListFeedbackReports.mockResolvedValue(responseFor([]));

    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });

    const issueInput = screen.getByPlaceholderText(
      'Issue number',
    ) as HTMLInputElement;
    // Type a negative number (HTML number input doesn't prevent entry, but the onChange handler parses it)
    fireEvent.change(issueInput, { target: { value: '-1' } });

    await waitFor(() => {
      // Negative numbers should be excluded from the request
      const calls = mockListFeedbackReports.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).not.toHaveProperty('trackingIssueNumber');
    });
  });

  it('clears all filters and refetches with empty request when Clear filters is clicked', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });

    // Set a known platform filter
    const platformFilterInput = screen.getByPlaceholderText(
      'Any platform',
    ) as HTMLInputElement;
    fireEvent.change(platformFilterInput, { target: { value: 'android' } });

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        platform: 'android',
        pageSize: INBOX_PAGE_SIZE,
      });
    });

    // Click Clear filters
    const clearButton = screen.getByRole('button', { name: 'Clear filters' });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenLastCalledWith({
        pageSize: INBOX_PAGE_SIZE,
      });
    });
  });

  it('renders the sender name as a link to /admin/users/<id> and shows the email in the same cell', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(screen.getByText('App crashes on login')).toBeInTheDocument();
    });

    const row = screen.getByText('App crashes on login').closest('tr');
    expect(row).not.toBeNull();
    const senderLink = within(row as HTMLElement).getByRole('link', {
      name: 'Test User',
    });
    expect(senderLink).toHaveAttribute('href', '/admin/users/user-123');
    expect(
      within(row as HTMLElement).getByText('test@example.com'),
    ).toBeInTheDocument();
  });

  it('renders the sender email as the link text when the reporter has no name', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Add dark mode')).toBeInTheDocument();
    });

    const row = screen.getByText('Add dark mode').closest('tr');
    expect(row).not.toBeNull();
    const senderLink = within(row as HTMLElement).getByRole('link', {
      name: 'another@example.com',
    });
    expect(senderLink).toHaveAttribute('href', '/admin/users/user-456');
    expect(
      within(row as HTMLElement).getAllByText('another@example.com'),
    ).toHaveLength(1);
  });

  it('renders a null reporter as "Deleted" with no link to a user', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Lost data after sync')).toBeInTheDocument();
    });

    const row = screen.getByText('Lost data after sync').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Deleted')).toBeInTheDocument();
    // The only link left in the row is the report title.
    expect(
      within(row as HTMLElement)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/admin/feedback/report-3']);
  });

  it('shows empty state when API returns no reports', async () => {
    mockListFeedbackReports.mockResolvedValue(responseFor([]));

    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('No feedback reports match these filters.'),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows error message when listFeedbackReports rejects', async () => {
    mockListFeedbackReports.mockRejectedValue(new Error('Network error'));

    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('Unable to load feedback reports. Please try again.'),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
