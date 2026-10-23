/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('../prisma', () => ({
  createPrismaClient: () => ({}),
}));

import {
  FEEDBACK_REPORT_PLATFORMS,
  TRACKING_ISSUE_LINKED_STATUS,
} from './feedbackReportConstants';
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
    type ListFilters = Parameters<AdminFeedbackService['listReports']>[0];

    beforeEach(() => {
      // listReports reads the count and the page in one $transaction array.
      prisma.$transaction.mockImplementation((ops: any) => Promise.all(ops));
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.findMany.mockResolvedValue([]);
    });

    test('with no filters queries where {}, skip 0, take 25, newest first with id tie-break, and selects no description', async () => {
      await service.listReports({});

      expect(prisma.feedbackReport.count).toHaveBeenCalledWith({ where: {} });
      const findManyCall = prisma.feedbackReport.findMany.mock
        .calls[0][0] as any;
      expect(findManyCall).toEqual(
        expect.objectContaining({
          where: {},
          skip: 0,
          take: 25,
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(findManyCall.select).not.toHaveProperty('description');
      expect(findManyCall.select).not.toHaveProperty('expected_outcome');
      expect(findManyCall.select.reporter).toEqual({
        select: { id: true, name: true, email: true },
      });
    });

    test('returns the page of items, with total taken from count and page 1 with pageSize 25 echoed', async () => {
      prisma.feedbackReport.findMany.mockResolvedValue([
        makeDetailRow({ id: 'report-2', context_platform: 'web' }),
        makeDetailRow({ id: 'report-1' }),
      ]);
      prisma.feedbackReport.count.mockResolvedValue(42);

      const result = await service.listReports({});

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      const body = result.body as any;
      expect(body.items.map((item: any) => item.id)).toEqual([
        'report-2',
        'report-1',
      ]);
      expect(body.items[0].platform).toBe('web');
      expect(body).toMatchObject({ total: 42, page: 1, pageSize: 25 });
    });

    test('maps status, kind, platform and tracking issue onto one where clause shared by count and findMany', async () => {
      await service.listReports({
        status: 'planned',
        kind: 'bug_report',
        platform: 'ios',
        trackingIssueNumber: 42,
      });

      const expectedWhere = {
        status: 'planned',
        kind: 'bug_report',
        context_platform: 'ios',
        tracking_issue_number: 42,
      };
      expect(prisma.feedbackReport.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
      expect(prisma.feedbackReport.findMany.mock.calls[0][0]).toEqual(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    test('page 3 with pageSize 10 skips 20 and takes 10, and the body echoes both', async () => {
      const result = await service.listReports({ page: 3, pageSize: 10 });

      expect(prisma.feedbackReport.findMany.mock.calls[0][0]).toEqual(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.body).toMatchObject({ page: 3, pageSize: 10 });
    });

    test('accepts numeric strings for page and pageSize, as Number() reads them', async () => {
      const result = await service.listReports({ page: '2', pageSize: '10' });

      expect(result.ok).toBe(true);
      expect(prisma.feedbackReport.findMany.mock.calls[0][0]).toEqual(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.body).toMatchObject({ page: 2, pageSize: 10 });
    });

    test('a page past the end returns no items with status 200 and the total still counted', async () => {
      prisma.feedbackReport.findMany.mockResolvedValue([]);
      prisma.feedbackReport.count.mockResolvedValue(7);

      const result = await service.listReports({ page: 5 });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ items: [], total: 7, page: 5 });
    });

    test('accepts pageSize 100, the ceiling', async () => {
      const result = await service.listReports({ pageSize: 100 });

      expect(result.ok).toBe(true);
      expect(prisma.feedbackReport.findMany.mock.calls[0][0]).toEqual(
        expect.objectContaining({ take: 100 }),
      );
    });

    test.each<[ListFilters, string]>([
      [{ status: 'duplicate' }, 'Invalid report status.'],
      [{ kind: 'not_a_kind' }, 'Invalid report kind.'],
      [{ platform: 'mobile' }, 'Invalid report platform.'],
      [{ platform: 'Web' }, 'Invalid report platform.'],
      [{ trackingIssueNumber: 0 }, 'Enter the tracking issue number.'],
      [{ trackingIssueNumber: -1 }, 'Enter the tracking issue number.'],
      [{ trackingIssueNumber: 'abc' }, 'Enter the tracking issue number.'],
    ])(
      'refuses %j with 400 and makes no Prisma call',
      async (filters, message) => {
        const result = await service.listReports(filters);

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        expect(result.body).toEqual({ message });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.feedbackReport.count).not.toHaveBeenCalled();
        expect(prisma.feedbackReport.findMany).not.toHaveBeenCalled();
      },
    );

    test.each<[ListFilters, string]>([
      [{ page: 0 }, 'The page must be 1 or more.'],
      [{ page: 1.5 }, 'The page must be 1 or more.'],
      [{ pageSize: 0 }, 'The page size must be between 1 and 100.'],
      [{ pageSize: 101 }, 'The page size must be between 1 and 100.'],
    ])(
      'refuses paging %j with 400 and makes no Prisma call',
      async (filters, message) => {
        const result = await service.listReports(filters);

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        expect(result.body).toEqual({ message });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.feedbackReport.findMany).not.toHaveBeenCalled();
      },
    );

    test.each(FEEDBACK_REPORT_PLATFORMS)(
      'accepts platform %s and filters on context_platform',
      async (platform) => {
        const result = await service.listReports({ platform });

        expect(result.ok).toBe(true);
        expect(prisma.feedbackReport.count).toHaveBeenCalledWith({
          where: { context_platform: platform },
        });
      },
    );

    test('item carries the reporter identity (id, name, email) and keeps reporterUserId', async () => {
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

    test('item for a removed sender (reporter_user_id null) lists reporter: null', async () => {
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
