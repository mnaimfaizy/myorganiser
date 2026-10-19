/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('../prisma', () => ({
  createPrismaClient: () => ({}),
}));

jest.mock('./FeedbackFixNoticeService', () => {
  const __mockSendFixNoticeForReport = (
    jest.fn() as jest.Mock<any>
  ).mockResolvedValue('sent');
  return {
    __esModule: true,
    default: {
      sendFixNoticeForReport: __mockSendFixNoticeForReport,
    },
    __mockSendFixNoticeForReport,
  };
});

import {
  AdminFeedbackService,
  AdminFeedbackReportDetailDto,
} from './AdminFeedbackService';
import {
  FEEDBACK_REPORT_STATUSES,
  FEEDBACK_REPORT_STATUS_RULES,
  FEEDBACK_REPORT_TEXT_MAX_LENGTH,
} from './feedbackReportConstants';
import {
  makePrisma,
  makeDetailRow,
  type MockPrisma,
} from '../testing/AdminFeedbackService.testHelpers';

const mockSendFixNoticeForReport =
  require('./FeedbackFixNoticeService').__mockSendFixNoticeForReport;

/**
 * Transaction client for reopenReport and markDelivered. Both write the report
 * row and the audit row on this client; reopenReport also clears the Fix
 * Notice delivery ledger on it.
 */
function makeTx(updatedRow: ReturnType<typeof makeDetailRow>) {
  const update = (jest.fn() as jest.Mock<any>).mockResolvedValue(updatedRow);
  const deleteMany = (jest.fn() as jest.Mock<any>).mockResolvedValue({
    count: 1,
  });
  const create = (jest.fn() as jest.Mock<any>).mockResolvedValue({
    id: 'audit-1',
  });
  return {
    tx: {
      feedbackReport: { update },
      feedbackFixNoticeDelivery: { deleteMany },
      adminAuditLog: { create },
    },
    update,
    deleteMany,
    create,
  };
}

describe('AdminFeedbackService — reopenReport', () => {
  let prisma: MockPrisma;
  let service: AdminFeedbackService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrisma();
    service = new AdminFeedbackService(prisma as any);
  });

  describe('successful reopen', () => {
    test('reopening a Fixed bug report sets under_review, saves the trimmed note, clears the release, keeps the tracking issue link, and returns the updated row', async () => {
      const report = makeDetailRow({
        kind: 'bug_report',
        status: 'fixed',
        release_tag: 'v1.2.0',
        tracking_issue_number: 42,
      });
      const updatedRow = makeDetailRow({
        kind: 'bug_report',
        status: 'under_review',
        status_note: 'Fix regressed on Safari',
        release_tag: null,
        tracking_issue_number: 42,
        status_changed_at: new Date('2026-10-19T10:00:00.000Z'),
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(report);
      const { tx, update } = makeTx(updatedRow);
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const result = await service.reopenReport('admin-1', 'report-1', {
        statusNote: '  Fix regressed on Safari  ',
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(update).toHaveBeenCalledTimes(1);
      const call = update.mock.calls[0][0] as {
        where: unknown;
        data: Record<string, unknown>;
      };
      expect(call.where).toEqual({ id: 'report-1' });
      expect(call.data).toEqual({
        status: 'under_review',
        status_note: 'Fix regressed on Safari',
        release_tag: null,
        status_changed_at: expect.any(Date),
      });
      expect(call.data).not.toHaveProperty('tracking_issue_number');

      const body = result.body as AdminFeedbackReportDetailDto;
      expect(body.status).toBe('under_review');
      expect(body.statusNote).toBe('Fix regressed on Safari');
      expect(body.releaseTag).toBeNull();
      expect(body.trackingIssueNumber).toBe(42);
      expect(body.statusChangedAt).toBe('2026-10-19T10:00:00.000Z');
    });

    test('reopening a Shipped suggestion sets under_review', async () => {
      const report = makeDetailRow({
        kind: 'suggestion',
        status: 'shipped',
        release_tag: 'v1.3.0',
      });
      const updatedRow = makeDetailRow({
        kind: 'suggestion',
        status: 'under_review',
        status_note: 'Shipped by mistake',
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(report);
      const { tx, update } = makeTx(updatedRow);
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const result = await service.reopenReport('admin-1', 'report-1', {
        statusNote: 'Shipped by mistake',
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'under_review' }),
        }),
      );
    });
  });

  describe('side effects inside the transaction', () => {
    test('clears the Fix Notice delivery ledger for the report on the transaction client', async () => {
      prisma.feedbackReport.findUnique.mockResolvedValue(
        makeDetailRow({ status: 'fixed', release_tag: 'v1.2.0' }),
      );
      const { tx, deleteMany } = makeTx(
        makeDetailRow({ status: 'under_review' }),
      );
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.reopenReport('admin-1', 'report-1', {
        statusNote: 'Reopening',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(deleteMany).toHaveBeenCalledWith({
        where: { report_id: 'report-1' },
      });
    });

    test('writes a feedback_reopen audit row recording the prior status, prior release, and trimmed note', async () => {
      prisma.feedbackReport.findUnique.mockResolvedValue(
        makeDetailRow({
          status: 'fixed',
          release_tag: 'v1.2.0',
          reporter_user_id: 'user-1',
        }),
      );
      const { tx, create } = makeTx(makeDetailRow({ status: 'under_review' }));
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.reopenReport('admin-1', 'report-1', {
        statusNote: '  Reopening  ',
      });

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        data: {
          actor_user_id: 'admin-1',
          target_user_id: 'user-1',
          action: 'feedback_reopen',
          meta: {
            reportId: 'report-1',
            from: 'fixed',
            to: 'under_review',
            releaseTag: 'v1.2.0',
            statusNote: 'Reopening',
          },
        },
      });
    });

    test('sends no Fix Notice when reopening', async () => {
      prisma.feedbackReport.findUnique.mockResolvedValue(
        makeDetailRow({ status: 'fixed', release_tag: 'v1.2.0' }),
      );
      const { tx } = makeTx(makeDetailRow({ status: 'under_review' }));
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.reopenReport('admin-1', 'report-1', {
        statusNote: 'Reopening',
      });

      expect(mockSendFixNoticeForReport).not.toHaveBeenCalled();
    });
  });

  describe('refusals', () => {
    const nonFinalStatuses = FEEDBACK_REPORT_STATUSES.filter(
      (status) => !FEEDBACK_REPORT_STATUS_RULES[status].isFinal,
    );

    test.each(nonFinalStatuses)(
      'refuses a report in %s status with 400 and no transaction',
      async (status) => {
        prisma.feedbackReport.findUnique.mockResolvedValue(
          makeDetailRow({ status }),
        );

        const result = await service.reopenReport('admin-1', 'report-1', {
          statusNote: 'Reopening',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        expect(result.body).toEqual({
          message: 'Only a report marked Fixed or Shipped can be reopened.',
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    test.each([undefined, '', '   '])(
      'refuses a fixed report whose status note is %p with 400 and no transaction',
      async (statusNote) => {
        prisma.feedbackReport.findUnique.mockResolvedValue(
          makeDetailRow({ status: 'fixed', release_tag: 'v1.2.0' }),
        );

        const result = await service.reopenReport('admin-1', 'report-1', {
          statusNote,
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        expect(result.body).toEqual({
          message: 'Write a status note explaining why.',
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    test('refuses a status note one character over the text cap with 400 and no transaction', async () => {
      prisma.feedbackReport.findUnique.mockResolvedValue(
        makeDetailRow({ status: 'fixed', release_tag: 'v1.2.0' }),
      );

      const result = await service.reopenReport('admin-1', 'report-1', {
        statusNote: 'a'.repeat(FEEDBACK_REPORT_TEXT_MAX_LENGTH + 1),
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(result.body).toEqual({
        message: `The status note must be ${FEEDBACK_REPORT_TEXT_MAX_LENGTH.toLocaleString('en-US')} characters or fewer.`,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('accepts a status note exactly at the text cap', async () => {
      prisma.feedbackReport.findUnique.mockResolvedValue(
        makeDetailRow({ status: 'fixed', release_tag: 'v1.2.0' }),
      );
      const { tx, update } = makeTx(makeDetailRow({ status: 'under_review' }));
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const result = await service.reopenReport('admin-1', 'report-1', {
        statusNote: 'a'.repeat(FEEDBACK_REPORT_TEXT_MAX_LENGTH),
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status_note: 'a'.repeat(FEEDBACK_REPORT_TEXT_MAX_LENGTH),
          }),
        }),
      );
    });

    test('returns 404 for an unknown report with no transaction', async () => {
      prisma.feedbackReport.findUnique.mockResolvedValue(null);

      const result = await service.reopenReport('admin-1', 'missing-report', {
        statusNote: 'Reopening',
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      expect(result.body).toEqual({
        message: 'That feedback report does not exist.',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('re-notify after reopen', () => {
    test('a later markDelivered on the reopened report sends a Fix Notice for that report', async () => {
      // This proves the service path only. The deleteMany ledger test above is
      // what actually frees the Fix Notice delivery row for this re-notify.
      // The first load sees the Fixed report; every later load sees the
      // reopened (under_review) report. Writes follow the status they set.
      let loads = 0;
      prisma.feedbackReport.findUnique.mockImplementation(async () =>
        loads++ === 0
          ? makeDetailRow({ status: 'fixed', release_tag: 'v1.2.0' })
          : makeDetailRow({ status: 'under_review' }),
      );
      const update = (jest.fn() as jest.Mock<any>).mockImplementation(
        async (args: any) =>
          args.data.status === 'fixed'
            ? makeDetailRow({ status: 'fixed', release_tag: 'v1.3.0' })
            : makeDetailRow({ status: 'under_review' }),
      );
      const tx = {
        feedbackReport: { update },
        feedbackFixNoticeDelivery: {
          deleteMany: jest.fn() as jest.Mock<any>,
        },
        adminAuditLog: { create: jest.fn() as jest.Mock<any> },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      const reopened = await service.reopenReport('admin-1', 'report-1', {
        statusNote: 'Reopening',
      });
      expect(reopened.ok).toBe(true);
      expect(mockSendFixNoticeForReport).not.toHaveBeenCalled();

      const delivered = await service.markDelivered('admin-1', 'report-1', {
        releaseTag: 'v1.3.0',
      });

      expect(delivered.ok).toBe(true);
      expect(delivered.status).toBe(200);
      expect(mockSendFixNoticeForReport).toHaveBeenCalledTimes(1);
      expect(mockSendFixNoticeForReport).toHaveBeenCalledWith('report-1');
    });
  });
});
