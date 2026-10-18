/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

// Mock scrollIntoView which jsdom doesn't support
Element.prototype.scrollIntoView = jest.fn();

import type { AdminFeedbackReportListItemDto } from '@myorganiser/app-api-client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../lib/apiClient';
import {
  formatFeedbackReportStatus,
  formatFeedbackReportKind,
} from '../lib/formatFeedbackReport';

import { FeedbackInboxPageClient } from './FeedbackInboxPageClient';

const mockListFeedbackReports = jest.fn();

const sampleReports: AdminFeedbackReportListItemDto[] = [
  {
    id: 'report-1',
    title: 'App crashes on login',
    kind: 'bug_report',
    status: 'received',
    platform: 'web',
    trackingIssueNumber: null,
    reporterUserId: 'user-123',
    statusChangedAt: null,
    createdAt: '2026-10-17T10:00:00.000Z',
  },
  {
    id: 'report-2',
    title: 'Add dark mode',
    kind: 'suggestion',
    status: 'under_review',
    platform: 'mobile',
    trackingIssueNumber: 42,
    reporterUserId: 'user-456',
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
    mockListFeedbackReports.mockResolvedValue({
      data: { items: sampleReports },
    });
  });

  it('calls listFeedbackReports with no filter keys on mount', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({});
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
      expect(mockListFeedbackReports).toHaveBeenCalledWith({});
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
      });
    });
  });

  it('opens kind filter dropdown and refetches when kind is selected', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({});
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
      });
    });
  });

  it('clears status filter when All statuses is selected', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({});
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
      expect(mockListFeedbackReports).toHaveBeenLastCalledWith({});
    });
  });

  it('refetches with platform filter when platform text is entered', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({});
    });

    const platformInput = screen.getByPlaceholderText(
      'web',
    ) as HTMLInputElement;
    fireEvent.change(platformInput, { target: { value: 'web' } });

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({ platform: 'web' });
    });
  });

  it('refetches with trackingIssueNumber as a number when valid issue number is entered', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({});
    });

    const issueInput = screen.getByPlaceholderText(
      'Issue number',
    ) as HTMLInputElement;
    fireEvent.change(issueInput, { target: { value: '42' } });

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        trackingIssueNumber: 42,
      });
    });
  });

  it('excludes trackingIssueNumber from request when issue field has invalid value', async () => {
    mockListFeedbackReports.mockClear();
    mockListFeedbackReports.mockResolvedValue({ data: { items: [] } });

    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({});
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
      expect(mockListFeedbackReports).toHaveBeenCalledWith({});
    });

    // Set a platform filter
    const platformFilterInput = screen.getByPlaceholderText(
      'web',
    ) as HTMLInputElement;
    fireEvent.change(platformFilterInput, { target: { value: 'mobile' } });

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenCalledWith({
        platform: 'mobile',
      });
    });

    // Click Clear filters
    const clearButton = screen.getByRole('button', { name: 'Clear filters' });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(mockListFeedbackReports).toHaveBeenLastCalledWith({});
    });
  });

  it('renders report with reporterUserId as a link to /admin/users/<id>', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(screen.getByText('App crashes on login')).toBeInTheDocument();
    });

    const userLink = screen.getByRole('link', { name: 'user-123' });
    expect(userLink).toHaveAttribute('href', '/admin/users/user-123');
  });

  it('renders report with null reporterUserId as "Deleted"', async () => {
    render(<FeedbackInboxPageClient />);

    await waitFor(() => {
      expect(screen.getByText('Lost data after sync')).toBeInTheDocument();
    });

    expect(screen.getByText('Deleted')).toBeInTheDocument();
  });

  it('shows empty state when API returns no reports', async () => {
    mockListFeedbackReports.mockResolvedValue({ data: { items: [] } });

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
