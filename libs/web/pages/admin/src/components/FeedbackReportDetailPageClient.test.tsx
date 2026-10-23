/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
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

jest.mock('./FeedbackReportTriageActions', () => ({
  FeedbackReportTriageActions: () => (
    <div data-testid="feedback-report-triage-actions">Triage Actions</div>
  ),
}));

import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useIsMobileState } from '@myorganiser/web-ui';
import { useParams } from 'next/navigation';

import { createPlatformAdminApi } from '../lib/apiClient';
import { FeedbackReportDetailPageClient } from './FeedbackReportDetailPageClient';

const mockGetFeedbackReport = jest.fn();

function createAxios404Error() {
  return Object.assign(new Error('Not Found'), {
    isAxiosError: true,
    response: { status: 404 },
  });
}

function createTestReport(
  overrides: Partial<AdminFeedbackReportDetailDto> = {},
): AdminFeedbackReportDetailDto {
  return {
    id: 'report-1',
    title: 'Test Report',
    description: 'Test Description',
    kind: 'bug_report',
    status: 'received',
    platform: 'web',
    reporterUserId: 'user-1',
    reporter: {
      id: 'user-1',
      name: 'Test User',
      email: 'user@example.com',
    },
    context: {
      platform: 'web',
      appVersion: '1.0.0',
      browser: 'Chrome',
      operatingSystem: 'macOS',
      path: '/dashboard',
      sentAt: '2026-01-01T00:00:00.000Z',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    expectedOutcome: null,
    followUp: null,
    statusNote: null,
    releaseTag: null,
    fixNoticeOptIn: true,
    trackingIssueNumber: null,
    statusChangedAt: null,
    ...overrides,
  };
}

describe('FeedbackReportDetailPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      getFeedbackReport: mockGetFeedbackReport,
    });
    (useParams as jest.Mock).mockReturnValue({ reportId: 'report-1' });
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    mockGetFeedbackReport.mockResolvedValue({ data: createTestReport() });
  });

  it('loads report and renders title, description, Report Context fields, and status badge', async () => {
    render(<FeedbackReportDetailPageClient />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetFeedbackReport).toHaveBeenCalledWith({
        reportId: 'report-1',
      });
    });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Test Report' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Test Description')).toBeInTheDocument();

    // Report Context fields
    const reportContextHeading = screen.getByRole('heading', {
      name: 'Report context',
    });
    expect(reportContextHeading).toBeInTheDocument();

    // Verify Report Context section content
    const contextSection = reportContextHeading.closest('section');
    expect(contextSection).toHaveTextContent('Platform');
    expect(contextSection).toHaveTextContent('web');
    expect(contextSection).toHaveTextContent('App version');
    expect(contextSection).toHaveTextContent('1.0.0');
    expect(contextSection).toHaveTextContent('Browser');
    expect(contextSection).toHaveTextContent('Chrome');
    expect(contextSection).toHaveTextContent('Operating system');
    expect(contextSection).toHaveTextContent('macOS');
    expect(contextSection).toHaveTextContent('Path');
    expect(contextSection).toHaveTextContent('/dashboard');

    // Status badge
    expect(screen.getByText('Received')).toBeInTheDocument();
  });

  it('renders 404 message when API returns 404', async () => {
    mockGetFeedbackReport.mockRejectedValue(createAxios404Error());

    render(<FeedbackReportDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('That feedback report does not exist.'),
      ).toBeInTheDocument();
    });
  });

  it('renders generic error message on non-404 API error', async () => {
    mockGetFeedbackReport.mockRejectedValue(new Error('Network error'));

    render(<FeedbackReportDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('Unable to load feedback report. Please try again.'),
      ).toBeInTheDocument();
    });
  });

  it('renders not-found state when reportId param is absent and does not call API', async () => {
    (useParams as jest.Mock).mockReturnValue({});

    render(<FeedbackReportDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText('That feedback report does not exist.'),
      ).toBeInTheDocument();
    });

    expect(mockGetFeedbackReport).not.toHaveBeenCalled();
  });

  it('renders reporter name and email when reporter is set', async () => {
    const reportWithReporter = createTestReport({
      reporter: {
        id: 'user-1',
        name: 'Grace Hopper',
        email: 'grace@example.com',
      },
    });
    mockGetFeedbackReport.mockResolvedValue({ data: reportWithReporter });

    render(<FeedbackReportDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: 'Grace Hopper' }),
      ).toHaveAttribute('href', '/admin/users/user-1');
    });

    expect(screen.getByText('grace@example.com')).toBeInTheDocument();
  });

  it('renders reporter email when reporter name is null', async () => {
    const reportWithEmailOnly = createTestReport({
      reporter: {
        id: 'user-1',
        name: null,
        email: 'user@example.com',
      },
    });
    mockGetFeedbackReport.mockResolvedValue({ data: reportWithEmailOnly });

    render(<FeedbackReportDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: 'user@example.com' }),
      ).toBeInTheDocument();
    });
  });

  it('renders deleted sender message when reporter is null', async () => {
    const reportWithoutReporter = createTestReport({
      reporter: null,
    });
    mockGetFeedbackReport.mockResolvedValue({ data: reportWithoutReporter });

    render(<FeedbackReportDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'The sender was deleted. Their report stays without their name or email.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('renders Follow-up section when followUp is set', async () => {
    const reportWithFollowUp = createTestReport({
      followUp: 'Follow up with the user next week',
    });
    mockGetFeedbackReport.mockResolvedValue({ data: reportWithFollowUp });

    render(<FeedbackReportDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Follow-up' }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText('Follow up with the user next week'),
    ).toBeInTheDocument();
  });

  it('does not render Follow-up section when followUp is null', async () => {
    const reportWithoutFollowUp = createTestReport({
      followUp: null,
    });
    mockGetFeedbackReport.mockResolvedValue({ data: reportWithoutFollowUp });

    render(<FeedbackReportDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Test Report' }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('heading', { name: 'Follow-up' }),
    ).not.toBeInTheDocument();
  });

  it('renders Back to Feedback link', async () => {
    render(<FeedbackReportDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Test Report' }),
      ).toBeInTheDocument();
    });

    const backLinks = screen.getAllByRole('link', { name: 'Back to Feedback' });
    expect(backLinks.length).toBeGreaterThan(0);
    backLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/admin/feedback');
    });
  });

  it('renders triage actions component', async () => {
    render(<FeedbackReportDetailPageClient />);

    await waitFor(() => {
      expect(
        screen.getByTestId('feedback-report-triage-actions'),
      ).toBeInTheDocument();
    });
  });

  describe('phone variant', () => {
    beforeEach(() => {
      (useIsMobileState as jest.Mock).mockReturnValue(true);
    });

    it('names the back link Back to Feedback while its visible text is Feedback', async () => {
      render(<FeedbackReportDetailPageClient />);

      const backLink = await screen.findByRole('link', {
        name: 'Back to Feedback',
      });
      expect(backLink).toHaveAttribute('href', '/admin/feedback');
      expect(backLink).toHaveTextContent(/^Feedback$/);
    });

    it('folds Report context into two compact lines without dt labels', async () => {
      render(<FeedbackReportDetailPageClient />);

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'Report context' }),
        ).toBeInTheDocument();
      });

      const contextSection = screen
        .getByRole('heading', { name: 'Report context' })
        .closest('section');
      const environmentLine = screen.getByText('web · 1.0.0 · Chrome · macOS');
      const locationLine = screen.getByText(/^\/dashboard ·/);

      expect(environmentLine.tagName).toBe('P');
      expect(locationLine.tagName).toBe('P');
      expect(contextSection).toContainElement(environmentLine);
      expect(contextSection).toContainElement(locationLine);
      expect(contextSection?.querySelector('dl')).toBeNull();
      expect(screen.queryByText('App version')).not.toBeInTheDocument();
      expect(screen.queryByText('Sent at')).not.toBeInTheDocument();
    });

    it('shows the deleted-sender message and no profile link when reporter is null', async () => {
      mockGetFeedbackReport.mockResolvedValue({
        data: createTestReport({ reporter: null }),
      });

      render(<FeedbackReportDetailPageClient />);

      expect(
        await screen.findByText(
          'The sender was deleted. Their report stays without their name or email.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /Test User|user@example/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Sender' }),
      ).toBeInTheDocument();
    });

    it('shows the sender as name and email with the fix-notice sentence, and no Fix notice card', async () => {
      render(<FeedbackReportDetailPageClient />);

      const senderLink = await screen.findByRole('link', { name: 'Test User' });
      expect(senderLink.closest('p')).toHaveTextContent(
        'Test User · user@example.com',
      );
      expect(
        screen.getByText('The sender asked to be emailed when this is fixed.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Fix notice' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('desktop variant', () => {
    it('keeps Platform and Sent at as dt labels in Report context and a separate Fix notice card', async () => {
      render(<FeedbackReportDetailPageClient />);

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'Report context' }),
        ).toBeInTheDocument();
      });

      expect(screen.getByText('Platform').tagName).toBe('DT');
      expect(screen.getByText('Sent at').tagName).toBe('DT');
      expect(
        screen.getByRole('heading', { name: 'Fix notice' }),
      ).toBeInTheDocument();
    });
  });
});
