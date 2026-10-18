/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

// Mock scrollIntoView which jsdom doesn't support
Element.prototype.scrollIntoView = jest.fn();

import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../lib/apiClient';
import { formatFeedbackReportStatus } from '../lib/formatFeedbackReport';

import { FeedbackReportTriageActions } from './FeedbackReportTriageActions';

const mockChangeFeedbackReportStatus = jest.fn();
const mockLinkFeedbackReportTrackingIssue = jest.fn();
const mockUnlinkFeedbackReportTrackingIssue = jest.fn();
const mockMarkFeedbackReportDelivered = jest.fn();
const mockOnUpdated = jest.fn();

const bugReportFixture: AdminFeedbackReportDetailDto = {
  id: 'report-1',
  title: 'App crashes on login',
  kind: 'bug_report',
  status: 'received',
  platform: 'web',
  trackingIssueNumber: null,
  reporterUserId: 'user-123',
  statusChangedAt: null,
  createdAt: '2026-10-17T10:00:00.000Z',
  description: 'The app crashes when I try to log in',
  expectedOutcome: null,
  context: {
    platform: 'web',
    appVersion: '1.0.0',
    browser: 'Chrome',
    operatingSystem: 'macOS',
    path: '/dashboard',
    sentAt: '2026-10-17T10:00:00.000Z',
  },
  followUp: null,
  statusNote: null,
  releaseTag: null,
  fixNoticeOptIn: false,
  reporter: {
    id: 'user-123',
    name: 'Test User',
    email: 'test@example.com',
  },
};

const suggestionFixture: AdminFeedbackReportDetailDto = {
  id: 'report-2',
  title: 'Add dark mode',
  kind: 'suggestion',
  status: 'received',
  platform: 'mobile',
  trackingIssueNumber: null,
  reporterUserId: 'user-456',
  statusChangedAt: null,
  createdAt: '2026-10-16T15:30:00.000Z',
  description: 'Please add a dark mode option',
  expectedOutcome: null,
  context: {
    platform: 'mobile',
    appVersion: '1.0.0',
    browser: 'Safari',
    operatingSystem: 'iOS',
    path: '/dashboard',
    sentAt: '2026-10-16T15:30:00.000Z',
  },
  followUp: null,
  statusNote: null,
  releaseTag: null,
  fixNoticeOptIn: false,
  reporter: {
    id: 'user-456',
    name: 'Another User',
    email: 'another@example.com',
  },
};

function createAxiosError(message: string) {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response: { status: 400, data: { message } },
  });
}

describe('FeedbackReportTriageActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      changeFeedbackReportStatus: mockChangeFeedbackReportStatus,
      linkFeedbackReportTrackingIssue: mockLinkFeedbackReportTrackingIssue,
      unlinkFeedbackReportTrackingIssue: mockUnlinkFeedbackReportTrackingIssue,
      markFeedbackReportDelivered: mockMarkFeedbackReportDelivered,
    });
  });

  describe('ChangeStatusForm', () => {
    it('shows validation error when wont_do status is submitted without a note', async () => {
      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      const statusTrigger = screen.getByRole('combobox', { name: 'Status' });
      fireEvent.click(statusTrigger);

      const wontDoOption = await screen.findByRole('option', {
        name: formatFeedbackReportStatus('wont_do'),
      });
      fireEvent.click(wontDoOption);

      const submitButton = screen.getByRole('button', {
        name: 'Update status',
      });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText('Write a status note explaining why.'),
        ).toBeInTheDocument();
      });

      expect(mockChangeFeedbackReportStatus).not.toHaveBeenCalled();
    });

    it('submits wont_do status with note and calls onUpdated with response', async () => {
      const updatedReport = { ...bugReportFixture, status: 'wont_do' as const };
      mockChangeFeedbackReportStatus.mockResolvedValue({ data: updatedReport });

      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      const statusTrigger = screen.getByRole('combobox', { name: 'Status' });
      fireEvent.click(statusTrigger);

      const wontDoOption = await screen.findByRole('option', {
        name: formatFeedbackReportStatus('wont_do'),
      });
      fireEvent.click(wontDoOption);

      const noteTextarea = screen.getByPlaceholderText(
        'Explain the decision...',
      );
      fireEvent.change(noteTextarea, {
        target: { value: 'This is by design' },
      });

      const submitButton = screen.getByRole('button', {
        name: 'Update status',
      });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockChangeFeedbackReportStatus).toHaveBeenCalledWith({
          reportId: bugReportFixture.id,
          changeFeedbackReportStatusRequest: {
            status: 'wont_do',
            statusNote: 'This is by design',
          },
        });
      });

      expect(mockOnUpdated).toHaveBeenCalledWith(updatedReport);
    });

    it('submits under_review status without a note and succeeds', async () => {
      const updatedReport = {
        ...bugReportFixture,
        status: 'under_review' as const,
      };
      mockChangeFeedbackReportStatus.mockResolvedValue({ data: updatedReport });

      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      // Status defaults to under_review, so just submit
      const submitButton = screen.getByRole('button', {
        name: 'Update status',
      });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockChangeFeedbackReportStatus).toHaveBeenCalledWith({
          reportId: bugReportFixture.id,
          changeFeedbackReportStatusRequest: {
            status: 'under_review',
            statusNote: undefined,
          },
        });
      });

      expect(mockOnUpdated).toHaveBeenCalledWith(updatedReport);
    });

    it('status dropdown for bug_report shows admin-settable statuses including cannot_reproduce', async () => {
      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      const statusTrigger = screen.getByRole('combobox', { name: 'Status' });
      fireEvent.click(statusTrigger);

      // Should show these statuses for bug_report
      expect(
        screen.getByRole('option', {
          name: formatFeedbackReportStatus('under_review'),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('option', {
          name: formatFeedbackReportStatus('planned'),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('option', {
          name: formatFeedbackReportStatus('wont_do'),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('option', {
          name: formatFeedbackReportStatus('cannot_reproduce'),
        }),
      ).toBeInTheDocument();

      // Should NOT show these statuses
      expect(
        screen.queryByRole('option', {
          name: formatFeedbackReportStatus('received'),
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('option', {
          name: formatFeedbackReportStatus('fixed'),
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('option', {
          name: formatFeedbackReportStatus('shipped'),
        }),
      ).not.toBeInTheDocument();
    });

    it('status dropdown for suggestion does not show cannot_reproduce', async () => {
      render(
        <FeedbackReportTriageActions
          report={suggestionFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      const statusTrigger = screen.getByRole('combobox', { name: 'Status' });
      fireEvent.click(statusTrigger);

      // Should show these statuses for suggestion
      expect(
        screen.getByRole('option', {
          name: formatFeedbackReportStatus('under_review'),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('option', {
          name: formatFeedbackReportStatus('planned'),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('option', {
          name: formatFeedbackReportStatus('wont_do'),
        }),
      ).toBeInTheDocument();

      // Should NOT show cannot_reproduce for suggestion
      expect(
        screen.queryByRole('option', {
          name: formatFeedbackReportStatus('cannot_reproduce'),
        }),
      ).not.toBeInTheDocument();

      // Should NOT show non-admin-settable statuses
      expect(
        screen.queryByRole('option', {
          name: formatFeedbackReportStatus('received'),
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('option', {
          name: formatFeedbackReportStatus('shipped'),
        }),
      ).not.toBeInTheDocument();
    });

    it('cannot_reproduce status requires note for bug_report and blocks submit without note', async () => {
      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      const statusTrigger = screen.getByRole('combobox', { name: 'Status' });
      fireEvent.click(statusTrigger);

      const cannotReproduceOption = await screen.findByRole('option', {
        name: formatFeedbackReportStatus('cannot_reproduce'),
      });
      fireEvent.click(cannotReproduceOption);

      const submitButton = screen.getByRole('button', {
        name: 'Update status',
      });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText('Write a status note explaining why.'),
        ).toBeInTheDocument();
      });

      expect(mockChangeFeedbackReportStatus).not.toHaveBeenCalled();
    });

    it('displays server error message when changeFeedbackReportStatus rejects', async () => {
      const serverMessage =
        'This status cannot be set for a bug with tracking issue #42';
      mockChangeFeedbackReportStatus.mockRejectedValue(
        createAxiosError(serverMessage),
      );

      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      const statusTrigger = screen.getByRole('combobox', { name: 'Status' });
      fireEvent.click(statusTrigger);

      const plannedOption = await screen.findByRole('option', {
        name: formatFeedbackReportStatus('planned'),
      });
      fireEvent.click(plannedOption);

      const submitButton = screen.getByRole('button', {
        name: 'Update status',
      });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(serverMessage)).toBeInTheDocument();
      });

      expect(mockOnUpdated).not.toHaveBeenCalled();
    });
  });

  describe('TrackingIssueForm', () => {
    it('links a tracking issue number and calls onUpdated', async () => {
      const updatedReport = { ...bugReportFixture, trackingIssueNumber: 42 };
      mockLinkFeedbackReportTrackingIssue.mockResolvedValue({
        data: updatedReport,
      });

      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      const issueInput = screen.getByPlaceholderText(
        'Issue number',
      ) as HTMLInputElement;
      fireEvent.change(issueInput, { target: { value: '42' } });

      const linkButton = screen.getByRole('button', { name: 'Link issue' });
      fireEvent.click(linkButton);

      await waitFor(() => {
        expect(mockLinkFeedbackReportTrackingIssue).toHaveBeenCalledWith({
          reportId: bugReportFixture.id,
          linkFeedbackReportTrackingIssueRequest: {
            trackingIssueNumber: 42,
          },
        });
      });

      expect(mockOnUpdated).toHaveBeenCalledWith(updatedReport);
    });

    it('renders unlink button and issue link when trackingIssueNumber is set', async () => {
      const reportWithIssue = { ...bugReportFixture, trackingIssueNumber: 42 };

      render(
        <FeedbackReportTriageActions
          report={reportWithIssue}
          onUpdated={mockOnUpdated}
        />,
      );

      const issueLink = screen.getByRole('link', { name: '#42' });
      expect(issueLink).toHaveAttribute(
        'href',
        'https://github.com/mnaimfaizy/myorganiser/issues/42',
      );

      expect(
        screen.getByRole('button', { name: 'Unlink' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText('Issue number'),
      ).not.toBeInTheDocument();
    });

    it('unlinks a tracking issue and calls onUpdated', async () => {
      const reportWithIssue = { ...bugReportFixture, trackingIssueNumber: 42 };
      const updatedReport = { ...reportWithIssue, trackingIssueNumber: null };
      mockUnlinkFeedbackReportTrackingIssue.mockResolvedValue({
        data: updatedReport,
      });

      render(
        <FeedbackReportTriageActions
          report={reportWithIssue}
          onUpdated={mockOnUpdated}
        />,
      );

      const unlinkButton = screen.getByRole('button', { name: 'Unlink' });
      fireEvent.click(unlinkButton);

      await waitFor(() => {
        expect(mockUnlinkFeedbackReportTrackingIssue).toHaveBeenCalledWith({
          reportId: reportWithIssue.id,
        });
      });

      expect(mockOnUpdated).toHaveBeenCalledWith(updatedReport);
    });
  });

  describe('MarkDeliveredForm', () => {
    it('shows "Mark fixed" button for bug_report and submits with release tag', async () => {
      const updatedReport = { ...bugReportFixture, status: 'fixed' as const };
      mockMarkFeedbackReportDelivered.mockResolvedValue({
        data: updatedReport,
      });

      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      const markButton = screen.getByRole('button', { name: 'Mark fixed' });
      expect(markButton).toBeInTheDocument();

      const releaseInput = screen.getByPlaceholderText(
        'v1.4.0',
      ) as HTMLInputElement;
      fireEvent.change(releaseInput, { target: { value: 'v1.4.0' } });

      fireEvent.click(markButton);

      await waitFor(() => {
        expect(mockMarkFeedbackReportDelivered).toHaveBeenCalledWith({
          reportId: bugReportFixture.id,
          markFeedbackReportDeliveredRequest: {
            releaseTag: 'v1.4.0',
          },
        });
      });

      expect(mockOnUpdated).toHaveBeenCalledWith(updatedReport);
    });

    it('shows "Mark shipped" button for suggestion and submits with release tag', async () => {
      const updatedReport = {
        ...suggestionFixture,
        status: 'shipped' as const,
      };
      mockMarkFeedbackReportDelivered.mockResolvedValue({
        data: updatedReport,
      });

      render(
        <FeedbackReportTriageActions
          report={suggestionFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      const markButton = screen.getByRole('button', { name: 'Mark shipped' });
      expect(markButton).toBeInTheDocument();

      const releaseInput = screen.getByPlaceholderText(
        'v1.4.0',
      ) as HTMLInputElement;
      fireEvent.change(releaseInput, { target: { value: 'mobile-v2.0.0' } });

      fireEvent.click(markButton);

      await waitFor(() => {
        expect(mockMarkFeedbackReportDelivered).toHaveBeenCalledWith({
          reportId: suggestionFixture.id,
          markFeedbackReportDeliveredRequest: {
            releaseTag: 'mobile-v2.0.0',
          },
        });
      });

      expect(mockOnUpdated).toHaveBeenCalledWith(updatedReport);
    });
  });
});
