/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('../prisma', () => ({
  createPrismaClient: () => ({}),
}));

import { TRACKING_ISSUE_LINKED_STATUS } from './feedbackReportConstants';
import {
  AdminFeedbackService,
  AdminFeedbackReportDetailDto,
} from './AdminFeedbackService';
import {
  makePrisma,
  makeDetailRow,
  type MockPrisma,
} from '../testing/AdminFeedbackService.testHelpers';

describe('AdminFeedbackService — triage paths', () => {
  let prisma: MockPrisma;
  let service: AdminFeedbackService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrisma();
    service = new AdminFeedbackService(prisma as any);
  });

  describe('linkTrackingIssue', () => {
    test('linking issue 42 to a received report sets tracking_issue_number, moves to TRACKING_ISSUE_LINKED_STATUS, and sets status_changed_at', async () => {
      const report = makeDetailRow({ status: 'received' });
      const updated = makeDetailRow({
        status: TRACKING_ISSUE_LINKED_STATUS,
        tracking_issue_number: 42,
        status_changed_at: new Date('2026-10-17T12:00:00.000Z'),
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(report);

      const mockUpdate = (jest.fn() as jest.Mock<any>).mockResolvedValue(
        updated,
      );
      const mockCreate = (jest.fn() as jest.Mock<any>).mockResolvedValue({
        id: 'audit-1',
      });
      const mockTx = {
        feedbackReport: { update: mockUpdate },
        adminAuditLog: { create: mockCreate },
      };

      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const result = await service.linkTrackingIssue('admin-1', 'report-1', {
        trackingIssueNumber: 42,
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      const body = result.body as AdminFeedbackReportDetailDto;
      expect(body.trackingIssueNumber).toBe(42);
      expect(body.status).toBe(TRACKING_ISSUE_LINKED_STATUS);
      expect(body.statusChangedAt).toBe('2026-10-17T12:00:00.000Z');

      // Verify both report and audit were written on the same transaction client
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'report-1' },
          data: expect.objectContaining({
            tracking_issue_number: 42,
            status: TRACKING_ISSUE_LINKED_STATUS,
            status_changed_at: expect.any(Date),
          }),
        }),
      );
    });

    test('linkTrackingIssue writes feedback_tracking_issue_link audit row with correct metadata on same transaction client', async () => {
      const report = makeDetailRow({ status: 'received' });
      const updated = makeDetailRow({
        status: TRACKING_ISSUE_LINKED_STATUS,
        tracking_issue_number: 42,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(report);

      const mockUpdate = (jest.fn() as jest.Mock<any>).mockResolvedValue(
        updated,
      );
      const mockCreate = (jest.fn() as jest.Mock<any>).mockResolvedValue({
        id: 'audit-1',
      });
      const mockTx = {
        feedbackReport: { update: mockUpdate },
        adminAuditLog: { create: mockCreate },
      };

      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await service.linkTrackingIssue('admin-1', 'report-1', {
        trackingIssueNumber: 42,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          actor_user_id: 'admin-1',
          target_user_id: 'user-1',
          action: 'feedback_tracking_issue_link',
          meta: {
            reportId: 'report-1',
            trackingIssueNumber: 42,
          },
        },
      });
    });

    test('linkTrackingIssue with non-positive or non-integer issue number returns 400 and no $transaction call', async () => {
      const report = makeDetailRow({ status: 'received' });
      prisma.feedbackReport.findUnique.mockResolvedValue(report);

      // Test with 0
      let result = await service.linkTrackingIssue('admin-1', 'report-1', {
        trackingIssueNumber: 0,
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();

      jest.clearAllMocks();
      prisma.feedbackReport.findUnique.mockResolvedValue(report);

      // Test with negative
      result = await service.linkTrackingIssue('admin-1', 'report-1', {
        trackingIssueNumber: -5,
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();

      jest.clearAllMocks();
      prisma.feedbackReport.findUnique.mockResolvedValue(report);

      // Test with non-numeric string
      result = await service.linkTrackingIssue('admin-1', 'report-1', {
        trackingIssueNumber: 'not_a_number',
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('linkTrackingIssue against report in final status (fixed) returns 400 and no $transaction call', async () => {
      const report = makeDetailRow({
        status: 'fixed',
        release_tag: 'v1.0.0',
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(report);

      const result = await service.linkTrackingIssue('admin-1', 'report-1', {
        trackingIssueNumber: 42,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain('already');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('linkTrackingIssue with missing report id returns 404 and no $transaction call', async () => {
      prisma.feedbackReport.findUnique.mockResolvedValue(null);

      const result = await service.linkTrackingIssue('admin-1', 'missing-id', {
        trackingIssueNumber: 42,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('unlinkTrackingIssue', () => {
    test('unlinkTrackingIssue clears tracking_issue_number to null, leaves status untouched, and writes audit row with removed issue number', async () => {
      const report = makeDetailRow({
        status: 'planned',
        tracking_issue_number: 42,
      });
      const updated = makeDetailRow({
        status: 'planned',
        tracking_issue_number: null,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(report);

      const mockUpdate = (jest.fn() as jest.Mock<any>).mockResolvedValue(
        updated,
      );
      const mockCreate = (jest.fn() as jest.Mock<any>).mockResolvedValue({
        id: 'audit-1',
      });
      const mockTx = {
        feedbackReport: { update: mockUpdate },
        adminAuditLog: { create: mockCreate },
      };

      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      const result = await service.unlinkTrackingIssue('admin-1', 'report-1');

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      const body = result.body as AdminFeedbackReportDetailDto;
      expect(body.trackingIssueNumber).toBe(null);
      expect(body.status).toBe('planned');

      // Verify the update data has tracking_issue_number: null but no status key
      const updateCall = mockUpdate.mock.calls[0][0] as any;
      expect(updateCall.data.tracking_issue_number).toBe(null);
      expect(updateCall.data).not.toHaveProperty('status');

      // Verify audit row carries the removed issue number
      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          actor_user_id: 'admin-1',
          target_user_id: 'user-1',
          action: 'feedback_tracking_issue_unlink',
          meta: {
            reportId: 'report-1',
            trackingIssueNumber: 42,
          },
        },
      });
    });

    test('unlinkTrackingIssue on report with no tracking issue returns 400 and no $transaction call', async () => {
      const report = makeDetailRow({
        status: 'planned',
        tracking_issue_number: null,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(report);

      const result = await service.unlinkTrackingIssue('admin-1', 'report-1');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain('no tracking issue');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('unlinkTrackingIssue on report in final status returns 400 and no $transaction call', async () => {
      const report = makeDetailRow({
        status: 'shipped',
        tracking_issue_number: 42,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(report);

      const result = await service.unlinkTrackingIssue('admin-1', 'report-1');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain('already');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('unlinkTrackingIssue with missing report id returns 404 and no $transaction call', async () => {
      prisma.feedbackReport.findUnique.mockResolvedValue(null);

      const result = await service.unlinkTrackingIssue('admin-1', 'missing-id');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('listReports', () => {
    test('listReports maps filters onto where clause, orders newest-first, and does not over-fetch; invalid status/kind returns 400', async () => {
      const report1 = makeDetailRow({
        id: 'report-1',
        status: 'planned',
        tracking_issue_number: 42,
      });
      const report2 = makeDetailRow({
        id: 'report-2',
        status: 'planned',
        created_at: new Date('2026-01-02T00:00:00.000Z'),
      });

      // Test valid filters
      prisma.feedbackReport.findMany.mockResolvedValue([report2, report1]);

      const result = await service.listReports({
        status: 'planned',
        kind: 'bug_report',
        platform: 'web',
        trackingIssueNumber: 42,
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      const body = result.body as any;
      expect(body.items.length).toBe(2);

      // Verify findMany was called with correct where clause
      const findManyCall = prisma.feedbackReport.findMany.mock
        .calls[0][0] as any;
      expect(findManyCall.where).toEqual({
        status: 'planned',
        kind: 'bug_report',
        context_platform: 'web',
        tracking_issue_number: 42,
      });

      // Verify ordering is newest-first
      expect(findManyCall.orderBy).toEqual({ created_at: 'desc' });

      // Verify select does not request description or expected_outcome, and
      // requests only the reporter identity fields
      expect(findManyCall.select).toBeDefined();
      expect(findManyCall.select).not.toHaveProperty('description');
      expect(findManyCall.select).not.toHaveProperty('expected_outcome');
      expect(findManyCall.select.reporter).toEqual({
        select: { id: true, name: true, email: true },
      });

      jest.clearAllMocks();
      prisma.feedbackReport.findMany.mockResolvedValue([]);

      // Test invalid status
      const statusResult = await service.listReports({
        status: 'duplicate',
      });
      expect(statusResult.ok).toBe(false);
      expect(statusResult.status).toBe(400);
      const statusBody = statusResult.body as any;
      expect(statusBody.message).toContain('Invalid report status');
      expect(prisma.feedbackReport.findMany).not.toHaveBeenCalled();

      jest.clearAllMocks();

      // Test invalid kind
      const kindResult = await service.listReports({
        kind: 'not_a_kind',
      });
      expect(kindResult.ok).toBe(false);
      expect(kindResult.status).toBe(400);
      const kindBody = kindResult.body as any;
      expect(kindBody.message).toContain('Invalid report kind');
      expect(prisma.feedbackReport.findMany).not.toHaveBeenCalled();
    });

    test('listReports item carries the reporter identity (id, name, email) and keeps reporterUserId', async () => {
      prisma.feedbackReport.findMany.mockResolvedValue([makeDetailRow()]);

      const result = await service.listReports({});

      expect(result.ok).toBe(true);
      const body = result.body as { items: any[] };
      expect(body.items).toHaveLength(1);
      expect(body.items[0].reporterUserId).toBe('user-1');
      expect(body.items[0].reporter).toEqual({
        id: 'user-1',
        name: 'Test User',
        email: 'user@example.com',
      });
    });

    test('listReports item for a removed sender (reporter_user_id null) lists reporter: null', async () => {
      prisma.feedbackReport.findMany.mockResolvedValue([
        makeDetailRow({
          id: 'report-deleted-sender',
          reporter_user_id: null,
          reporter: null,
        }),
      ]);

      const result = await service.listReports({});

      expect(result.ok).toBe(true);
      const body = result.body as { items: any[] };
      expect(body.items[0].id).toBe('report-deleted-sender');
      expect(body.items[0].reporterUserId).toBeNull();
      expect(body.items[0].reporter).toBeNull();
    });

    test('listReports with absent filters does not include them in where clause', async () => {
      prisma.feedbackReport.findMany.mockResolvedValue([]);

      await service.listReports({
        status: 'planned',
        // kind, platform, trackingIssueNumber absent
      });

      const findManyCall = prisma.feedbackReport.findMany.mock
        .calls[0][0] as any;
      expect(findManyCall.where).toEqual({
        status: 'planned',
      });
      expect(findManyCall.where).not.toHaveProperty('kind');
      expect(findManyCall.where).not.toHaveProperty('context_platform');
      expect(findManyCall.where).not.toHaveProperty('tracking_issue_number');
    });
  });

  describe('getReport', () => {
    test('getReport with missing report id returns 404', async () => {
      prisma.feedbackReport.findUnique.mockResolvedValue(null);

      const result = await service.getReport('missing-id');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      const body = result.body as any;
      expect(body.message).toContain('does not exist');
    });

    test('getReport with existing report returns detail DTO with reporter populated from the relation', async () => {
      const reportWithReporter = makeDetailRow({
        id: 'report-with-reporter',
        reporter: {
          id: 'user-1',
          name: 'Test User',
          email: 'user@example.com',
        },
      });

      prisma.feedbackReport.findUnique.mockResolvedValue(reportWithReporter);
      const result = await service.getReport('report-with-reporter');

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      const body = result.body as AdminFeedbackReportDetailDto;
      expect(body.reporter).toBeDefined();
      expect(body.reporter?.email).toBe('user@example.com');
    });

    test('getReport with null reporter (sender deleted by User Deletion) returns reporter: null', async () => {
      const reportWithoutReporter = makeDetailRow({
        id: 'report-without-reporter',
        reporter_user_id: null,
        reporter: null,
      });

      prisma.feedbackReport.findUnique.mockResolvedValue(reportWithoutReporter);
      const result = await service.getReport('report-without-reporter');

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      const body = result.body as AdminFeedbackReportDetailDto;
      expect(body.reporter).toBeNull();
      expect(body.reporterUserId).toBeNull();
    });
  });
});
