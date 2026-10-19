/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

// Mock scrollIntoView which jsdom doesn't support
Element.prototype.scrollIntoView = jest.fn();

import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import {
  FEEDBACK_REPORT_TEXT_MAX_LENGTH,
  formatFeedbackReportCap,
} from '@myorganiser/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useState } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import { formatFeedbackReportStatus } from '../lib/formatFeedbackReport';

import { FeedbackReportTriageActions } from './FeedbackReportTriageActions';

const mockChangeFeedbackReportStatus = jest.fn();
const mockLinkFeedbackReportTrackingIssue = jest.fn();
const mockUnlinkFeedbackReportTrackingIssue = jest.fn();
const mockMarkFeedbackReportDelivered = jest.fn();
const mockReopenFeedbackReport = jest.fn();
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

// Mirrors FeedbackReportDetailPageClient: the parent holds the report in state
// and hands each returned report back down, so report-scoped messages render.
function TriageHarness({
  initialReport,
}: {
  initialReport: AdminFeedbackReportDetailDto;
}) {
  const [report, setReport] = useState(initialReport);
  return (
    <FeedbackReportTriageActions
      report={report}
      onUpdated={(updated) => {
        mockOnUpdated(updated);
        setReport(updated);
      }}
    />
  );
}

describe('FeedbackReportTriageActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      changeFeedbackReportStatus: mockChangeFeedbackReportStatus,
      linkFeedbackReportTrackingIssue: mockLinkFeedbackReportTrackingIssue,
      unlinkFeedbackReportTrackingIssue: mockUnlinkFeedbackReportTrackingIssue,
      markFeedbackReportDelivered: mockMarkFeedbackReportDelivered,
      reopenFeedbackReport: mockReopenFeedbackReport,
    });
  });

  describe('final reports', () => {
    it('shows the release in the note and renders none of the triage controls for a fixed report', () => {
      const fixedReport = {
        ...bugReportFixture,
        status: 'fixed' as const,
        releaseTag: 'v1.4.0',
      };

      render(
        <FeedbackReportTriageActions
          report={fixedReport}
          onUpdated={mockOnUpdated}
        />,
      );

      expect(
        screen.getByRole('heading', { name: 'Triage' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'This report is fixed in v1.4.0 and can no longer change.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Change status' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Tracking issue' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('combobox', { name: 'Status' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Mark fixed' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText('Issue number'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText('Release tag'),
      ).not.toBeInTheDocument();
    });

    it('omits the release clause from the note when a final report has no release tag', () => {
      render(
        <FeedbackReportTriageActions
          report={{
            ...suggestionFixture,
            status: 'shipped' as const,
            releaseTag: null,
          }}
          onUpdated={mockOnUpdated}
        />,
      );

      expect(
        screen.getByText('This report is shipped and can no longer change.'),
      ).toBeInTheDocument();
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

    it('keeps the status success message after the parent re-renders with the updated report', async () => {
      mockChangeFeedbackReportStatus.mockResolvedValue({
        data: { ...bugReportFixture, status: 'planned' as const },
      });

      render(<TriageHarness initialReport={bugReportFixture} />);

      fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
      const plannedOption = await screen.findByRole('option', {
        name: formatFeedbackReportStatus('planned'),
      });
      fireEvent.click(plannedOption);
      fireEvent.click(screen.getByRole('button', { name: 'Update status' }));

      expect(await screen.findByText('Status updated.')).toBeInTheDocument();
    });

    it('clears the status note error and resets the status when a sibling link updates the report', async () => {
      mockLinkFeedbackReportTrackingIssue.mockResolvedValue({
        data: {
          ...bugReportFixture,
          trackingIssueNumber: 42,
          status: 'planned' as const,
        },
      });

      render(<TriageHarness initialReport={bugReportFixture} />);

      fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
      const wontDoOption = await screen.findByRole('option', {
        name: formatFeedbackReportStatus('wont_do'),
      });
      fireEvent.click(wontDoOption);
      fireEvent.click(screen.getByRole('button', { name: 'Update status' }));

      expect(
        await screen.findByText('Write a status note explaining why.'),
      ).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText('Issue number'), {
        target: { value: '42' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Link issue' }));

      expect(
        await screen.findByText('Issue #42 linked. The report is now Planned.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Write a status note explaining why.'),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('combobox', { name: 'Status' }),
      ).toHaveTextContent(formatFeedbackReportStatus('under_review'));
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

      const issueLink = screen.getByRole('link', { name: /^#42\b/ });
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

    it('shows the linked message once the parent re-renders with the returned report', async () => {
      mockLinkFeedbackReportTrackingIssue.mockResolvedValue({
        data: {
          ...bugReportFixture,
          trackingIssueNumber: 42,
          status: 'planned' as const,
        },
      });

      render(<TriageHarness initialReport={bugReportFixture} />);

      fireEvent.change(screen.getByPlaceholderText('Issue number'), {
        target: { value: '42' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Link issue' }));

      expect(
        await screen.findByText('Issue #42 linked. The report is now Planned.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Issue unlinked.')).not.toBeInTheDocument();
    });

    it('shows the unlinked message once the parent re-renders with the returned report', async () => {
      const reportWithIssue = { ...bugReportFixture, trackingIssueNumber: 42 };
      mockUnlinkFeedbackReportTrackingIssue.mockResolvedValue({
        data: { ...reportWithIssue, trackingIssueNumber: null },
      });

      render(<TriageHarness initialReport={reportWithIssue} />);

      fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));

      expect(await screen.findByText('Issue unlinked.')).toBeInTheDocument();
      expect(
        screen.queryByText(/The report is now Planned/),
      ).not.toBeInTheDocument();
    });

    it('shows the server error and does not call onUpdated when linking fails', async () => {
      const serverMessage =
        'Tracking issue #42 is already linked to another report';
      mockLinkFeedbackReportTrackingIssue.mockRejectedValue(
        createAxiosError(serverMessage),
      );

      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText('Issue number'), {
        target: { value: '42' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Link issue' }));

      expect(await screen.findByText(serverMessage)).toBeInTheDocument();
      expect(mockOnUpdated).not.toHaveBeenCalled();
    });

    it('shows the server error and does not call onUpdated when unlinking fails', async () => {
      const serverMessage = 'Tracking issue #42 cannot be unlinked right now';
      mockUnlinkFeedbackReportTrackingIssue.mockRejectedValue(
        createAxiosError(serverMessage),
      );
      const reportWithIssue = { ...bugReportFixture, trackingIssueNumber: 42 };

      render(
        <FeedbackReportTriageActions
          report={reportWithIssue}
          onUpdated={mockOnUpdated}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));

      expect(await screen.findByText(serverMessage)).toBeInTheDocument();
      expect(mockOnUpdated).not.toHaveBeenCalled();
    });

    it('rejects an issue number of zero without calling the API', async () => {
      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText('Issue number'), {
        target: { value: '0' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Link issue' }));

      expect(
        await screen.findByText('Enter the tracking issue number.'),
      ).toBeInTheDocument();
      expect(mockLinkFeedbackReportTrackingIssue).not.toHaveBeenCalled();
    });
  });

  describe('MarkDeliveredForm', () => {
    it('shows "Mark fixed" button for bug_report and submits with release tag', async () => {
      const updatedReport = {
        ...bugReportFixture,
        status: 'fixed' as const,
        releaseTag: 'v1.4.0',
      };
      mockMarkFeedbackReportDelivered.mockResolvedValue({
        data: updatedReport,
      });

      render(<TriageHarness initialReport={bugReportFixture} />);

      const markButton = screen.getByRole('button', { name: 'Mark fixed' });
      expect(markButton).toBeInTheDocument();

      const releaseInput = screen.getByPlaceholderText(
        'Release tag',
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
      expect(
        await screen.findByText(
          'This report is fixed in v1.4.0 and can no longer change.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Mark fixed' }),
      ).not.toBeInTheDocument();
    });

    it('shows "Mark shipped" button for suggestion and submits with release tag', async () => {
      const updatedReport = {
        ...suggestionFixture,
        status: 'shipped' as const,
        releaseTag: 'mobile-v2.0.0',
      };
      mockMarkFeedbackReportDelivered.mockResolvedValue({
        data: updatedReport,
      });

      render(<TriageHarness initialReport={suggestionFixture} />);

      const markButton = screen.getByRole('button', { name: 'Mark shipped' });
      expect(markButton).toBeInTheDocument();

      const releaseInput = screen.getByPlaceholderText(
        'Release tag',
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
      expect(
        await screen.findByText(
          'This report is shipped in mobile-v2.0.0 and can no longer change.',
        ),
      ).toBeInTheDocument();
    });

    it('clears the release validation error when a sibling link updates the report', async () => {
      mockLinkFeedbackReportTrackingIssue.mockResolvedValue({
        data: {
          ...bugReportFixture,
          trackingIssueNumber: 42,
          status: 'planned' as const,
        },
      });

      render(<TriageHarness initialReport={bugReportFixture} />);

      fireEvent.click(screen.getByRole('button', { name: 'Mark fixed' }));

      expect(
        await screen.findByText(
          'Name the release this shipped in, such as v1.4.0 or mobile-v1.4.0.',
        ),
      ).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText('Issue number'), {
        target: { value: '42' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Link issue' }));

      expect(
        await screen.findByText('Issue #42 linked. The report is now Planned.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          'Name the release this shipped in, such as v1.4.0 or mobile-v1.4.0.',
        ),
      ).not.toBeInTheDocument();
    });

    it('shows the server error and does not call onUpdated when marking delivered fails', async () => {
      const serverMessage =
        'This release tag was already recorded for another report';
      mockMarkFeedbackReportDelivered.mockRejectedValue(
        createAxiosError(serverMessage),
      );

      render(
        <FeedbackReportTriageActions
          report={bugReportFixture}
          onUpdated={mockOnUpdated}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText('Release tag'), {
        target: { value: 'v1.4.0' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Mark fixed' }));

      expect(await screen.findByText(serverMessage)).toBeInTheDocument();
      expect(mockOnUpdated).not.toHaveBeenCalled();
    });
  });

  describe('report-scoped messages', () => {
    const linkedReport = {
      ...bugReportFixture,
      trackingIssueNumber: 42,
      status: 'planned' as const,
    };
    const linkedMessage = 'Issue #42 linked. The report is now Planned.';

    it('hides the linked message after a sibling status change updates the report', async () => {
      mockLinkFeedbackReportTrackingIssue.mockResolvedValue({
        data: linkedReport,
      });
      mockChangeFeedbackReportStatus.mockResolvedValue({
        data: { ...linkedReport },
      });

      render(<TriageHarness initialReport={bugReportFixture} />);

      fireEvent.change(screen.getByPlaceholderText('Issue number'), {
        target: { value: '42' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Link issue' }));
      expect(await screen.findByText(linkedMessage)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
      const plannedOption = await screen.findByRole('option', {
        name: formatFeedbackReportStatus('planned'),
      });
      fireEvent.click(plannedOption);
      fireEvent.click(screen.getByRole('button', { name: 'Update status' }));

      expect(await screen.findByText('Status updated.')).toBeInTheDocument();
      expect(screen.queryByText(linkedMessage)).not.toBeInTheDocument();
    });

    it('hides the status message after a sibling link updates the report', async () => {
      mockChangeFeedbackReportStatus.mockResolvedValue({
        data: { ...bugReportFixture, status: 'planned' as const },
      });
      mockLinkFeedbackReportTrackingIssue.mockResolvedValue({
        data: linkedReport,
      });

      render(<TriageHarness initialReport={bugReportFixture} />);

      fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
      const plannedOption = await screen.findByRole('option', {
        name: formatFeedbackReportStatus('planned'),
      });
      fireEvent.click(plannedOption);
      fireEvent.click(screen.getByRole('button', { name: 'Update status' }));
      expect(await screen.findByText('Status updated.')).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText('Issue number'), {
        target: { value: '42' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Link issue' }));

      expect(await screen.findByText(linkedMessage)).toBeInTheDocument();
      expect(screen.queryByText('Status updated.')).not.toBeInTheDocument();
    });

    it('hides the unlinked message after a sibling status change updates the report', async () => {
      const reportWithIssue = { ...bugReportFixture, trackingIssueNumber: 42 };
      const unlinkedReport = { ...reportWithIssue, trackingIssueNumber: null };
      mockUnlinkFeedbackReportTrackingIssue.mockResolvedValue({
        data: unlinkedReport,
      });
      mockChangeFeedbackReportStatus.mockResolvedValue({
        data: { ...unlinkedReport, status: 'planned' as const },
      });

      render(<TriageHarness initialReport={reportWithIssue} />);

      fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
      expect(await screen.findByText('Issue unlinked.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
      const plannedOption = await screen.findByRole('option', {
        name: formatFeedbackReportStatus('planned'),
      });
      fireEvent.click(plannedOption);
      fireEvent.click(screen.getByRole('button', { name: 'Update status' }));

      expect(await screen.findByText('Status updated.')).toBeInTheDocument();
      expect(screen.queryByText('Issue unlinked.')).not.toBeInTheDocument();
    });
  });

  describe('reopen', () => {
    const reopenPlaceholder = 'Explain why this report is being reopened...';
    const reopenedMessage = 'Report reopened. It is back in Under review.';
    const fixedReport = {
      ...bugReportFixture,
      status: 'fixed' as const,
      releaseTag: 'v1.2.0',
    };
    const reopenedReport = {
      ...fixedReport,
      status: 'under_review' as const,
      releaseTag: null,
    };

    it('hides the reopen form for a report that is not final', () => {
      render(
        <FeedbackReportTriageActions
          report={{ ...bugReportFixture, status: 'under_review' as const }}
          onUpdated={mockOnUpdated}
        />,
      );

      expect(
        screen.getByRole('heading', { name: 'Change status' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Reopen' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Reopen report' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText(reopenPlaceholder),
      ).not.toBeInTheDocument();
    });

    it('shows the unchanged final note and the reopen form for a fixed report', () => {
      render(
        <FeedbackReportTriageActions
          report={fixedReport}
          onUpdated={mockOnUpdated}
        />,
      );

      expect(
        screen.getByText(
          'This report is fixed in v1.2.0 and can no longer change.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Reopen' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Status note')).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(reopenPlaceholder),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Reopen report' }),
      ).toBeInTheDocument();
    });

    it.each(['', '   '])(
      'blocks a status note of %j without calling the API',
      async (note) => {
        render(
          <FeedbackReportTriageActions
            report={fixedReport}
            onUpdated={mockOnUpdated}
          />,
        );

        fireEvent.change(screen.getByPlaceholderText(reopenPlaceholder), {
          target: { value: note },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Reopen report' }));

        expect(
          await screen.findByText('Write a status note explaining why.'),
        ).toBeInTheDocument();
        expect(mockReopenFeedbackReport).not.toHaveBeenCalled();
        expect(mockOnUpdated).not.toHaveBeenCalled();
      },
    );

    it('blocks a status note one character over the cap without calling the API', async () => {
      render(
        <FeedbackReportTriageActions
          report={fixedReport}
          onUpdated={mockOnUpdated}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText(reopenPlaceholder), {
        target: { value: 'x'.repeat(FEEDBACK_REPORT_TEXT_MAX_LENGTH + 1) },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reopen report' }));

      expect(
        await screen.findByText(
          `The status note must be ${formatFeedbackReportCap(FEEDBACK_REPORT_TEXT_MAX_LENGTH)} characters or fewer.`,
        ),
      ).toBeInTheDocument();
      expect(mockReopenFeedbackReport).not.toHaveBeenCalled();
      expect(mockOnUpdated).not.toHaveBeenCalled();
    });

    it('reopens the report and swaps the final view for the triage forms once the parent re-renders', async () => {
      mockReopenFeedbackReport.mockResolvedValue({ data: reopenedReport });

      render(<TriageHarness initialReport={fixedReport} />);

      fireEvent.change(screen.getByPlaceholderText(reopenPlaceholder), {
        target: { value: 'Reproduced on the latest build' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reopen report' }));

      expect(
        await screen.findByRole('heading', { name: 'Change status' }),
      ).toBeInTheDocument();
      expect(mockReopenFeedbackReport).toHaveBeenCalledWith({
        reportId: fixedReport.id,
        reopenFeedbackReportRequest: {
          statusNote: 'Reproduced on the latest build',
        },
      });
      expect(mockOnUpdated).toHaveBeenCalledWith(reopenedReport);
      expect(
        screen.queryByText(
          'This report is fixed in v1.2.0 and can no longer change.',
        ),
      ).not.toBeInTheDocument();
      expect(screen.getByText(reopenedMessage)).toBeInTheDocument();
    });

    it('hides the reopened confirmation once a later update replaces the report', async () => {
      mockReopenFeedbackReport.mockResolvedValue({ data: reopenedReport });

      const { rerender } = render(
        <FeedbackReportTriageActions
          report={fixedReport}
          onUpdated={mockOnUpdated}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText(reopenPlaceholder), {
        target: { value: 'Reproduced on the latest build' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reopen report' }));

      await waitFor(() => {
        expect(mockOnUpdated).toHaveBeenCalledWith(reopenedReport);
      });

      // The parent hands back the same object the API returned.
      rerender(
        <FeedbackReportTriageActions
          report={reopenedReport}
          onUpdated={mockOnUpdated}
        />,
      );
      expect(screen.getByText(reopenedMessage)).toBeInTheDocument();

      // A sibling update delivers a new report object, so the confirmation drops.
      rerender(
        <FeedbackReportTriageActions
          report={{ ...reopenedReport }}
          onUpdated={mockOnUpdated}
        />,
      );
      expect(screen.queryByText(reopenedMessage)).not.toBeInTheDocument();
    });

    it('shows the server error inline and keeps the final view when reopening fails', async () => {
      const serverMessage = 'This report can no longer be reopened';
      mockReopenFeedbackReport.mockRejectedValue(
        createAxiosError(serverMessage),
      );

      render(
        <FeedbackReportTriageActions
          report={fixedReport}
          onUpdated={mockOnUpdated}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText(reopenPlaceholder), {
        target: { value: 'Still reproducible' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reopen report' }));

      expect(await screen.findByText(serverMessage)).toBeInTheDocument();
      expect(
        screen.getByText(
          'This report is fixed in v1.2.0 and can no longer change.',
        ),
      ).toBeInTheDocument();
      expect(mockOnUpdated).not.toHaveBeenCalled();
    });

    it('shows the reopen form for a shipped suggestion', () => {
      render(
        <FeedbackReportTriageActions
          report={{
            ...suggestionFixture,
            status: 'shipped' as const,
            releaseTag: 'mobile-v2.0.0',
          }}
          onUpdated={mockOnUpdated}
        />,
      );

      expect(
        screen.getByText(
          'This report is shipped in mobile-v2.0.0 and can no longer change.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Reopen report' }),
      ).toBeInTheDocument();
    });
  });
});
