/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('../prisma', () => ({
  createPrismaClient: () => ({}),
}));

import { AdminFeedbackService } from './AdminFeedbackService';
import {
  makePrisma,
  makeDetailRow,
  type MockPrisma,
} from '../testing/AdminFeedbackService.testHelpers';

describe('AdminFeedbackService', () => {
  let prisma: MockPrisma;
  let service: AdminFeedbackService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrisma();
    service = new AdminFeedbackService(prisma as any);
  });

  describe('changeStatus', () => {
    describe('happy path and transaction', () => {
      test('moving a received report to under_review succeeds and returns ok: true, status: 200', async () => {
        const report = makeDetailRow({ status: 'received' });
        const updated = makeDetailRow({ status: 'under_review' });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        // Mock $transaction to call the callback with a tx object
        prisma.$transaction.mockImplementation(async (cb: any) => {
          const tx = {
            feedbackReport: {
              update: (jest.fn() as jest.Mock<any>).mockResolvedValue(
                updated,
              ) as jest.Mock<any>,
            },
            adminAuditLog: {
              create: (jest.fn() as jest.Mock<any>).mockResolvedValue({
                id: 'audit-1',
              }) as jest.Mock<any>,
            },
          };
          return cb(tx);
        });

        const result = await service.changeStatus('admin-1', 'report-1', {
          status: 'under_review',
        });

        expect(result.ok).toBe(true);
        expect(result.status).toBe(200);
        const body = result.body as any;
        expect(body.status).toBe('under_review');
      });

      test('changeStatus calls both feedbackReport.update and adminAuditLog.create on the transaction client', async () => {
        const report = makeDetailRow({ status: 'received' });
        const updated = makeDetailRow({ status: 'under_review' });
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

        await service.changeStatus('admin-1', 'report-1', {
          status: 'under_review',
        });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      test('audit row carries action feedback_status_change with correct metadata', async () => {
        const report = makeDetailRow({ status: 'received' });
        const updated = makeDetailRow({ status: 'under_review' });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const mockUpdate = (jest.fn() as jest.Mock<any>).mockResolvedValue(
          updated,
        );
        const mockCreate = (jest.fn() as jest.Mock<any>).mockResolvedValue({
          id: 'audit-1',
        });
        const mockTx = {
          feedbackReport: {
            update: mockUpdate,
          },
          adminAuditLog: {
            create: mockCreate,
          },
        };

        prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

        await service.changeStatus('admin-1', 'report-1', {
          status: 'under_review',
        });

        expect(mockCreate).toHaveBeenCalledWith({
          data: {
            actor_user_id: 'admin-1',
            target_user_id: 'user-1',
            action: 'feedback_status_change',
            meta: {
              reportId: 'report-1',
              from: 'received',
              to: 'under_review',
              statusNote: null,
            },
          },
        });
      });

      test('when reporter_user_id is null (deleted sender), audit row target_user_id is null and change succeeds', async () => {
        const report = makeDetailRow({
          status: 'received',
          reporter_user_id: null,
        });
        const updated = makeDetailRow({
          status: 'under_review',
          reporter_user_id: null,
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

        const result = await service.changeStatus('admin-1', 'report-1', {
          status: 'under_review',
        });

        expect(result.ok).toBe(true);
        expect(result.status).toBe(200);
        expect(mockCreate).toHaveBeenCalledWith({
          data: expect.objectContaining({
            target_user_id: null,
          }),
        });
      });
    });

    describe('status note requirement', () => {
      test('wont_do with no status note returns 400 with note-required message and no $transaction call', async () => {
        const report = makeDetailRow({ status: 'received' });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.changeStatus('admin-1', 'report-1', {
          status: 'wont_do',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        const body = result.body as any;
        expect(body.message).toContain('status note');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('cannot_reproduce with no status note returns 400 and no $transaction call', async () => {
        const report = makeDetailRow({
          status: 'received',
          kind: 'bug_report',
        });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.changeStatus('admin-1', 'report-1', {
          status: 'cannot_reproduce',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        const body = result.body as any;
        expect(body.message).toBeDefined();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('wont_do with a status note succeeds and stores the trimmed note', async () => {
        const report = makeDetailRow({ status: 'received' });
        const updated = makeDetailRow({
          status: 'wont_do',
          status_note: 'Not in scope',
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

        const result = await service.changeStatus('admin-1', 'report-1', {
          status: 'wont_do',
          statusNote: '  Not in scope  ',
        });

        expect(result.ok).toBe(true);
        expect(prisma.$transaction).toHaveBeenCalled();
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'report-1' },
            data: expect.objectContaining({
              status_note: 'Not in scope',
            }),
          }),
        );
      });

      test('planned status (no required note) succeeds with no note supplied and omits status_note from update', async () => {
        const report = makeDetailRow({ status: 'received' });
        const updated = makeDetailRow({ status: 'planned' });
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

        await service.changeStatus('admin-1', 'report-1', {
          status: 'planned',
        });

        expect(prisma.$transaction).toHaveBeenCalled();
        const updateCall = mockUpdate.mock.calls[0][0] as any;
        expect(updateCall.data).not.toHaveProperty('status_note');
      });
    });

    describe('transition rules', () => {
      test('cannot_reproduce on a suggestion returns 400 naming the kinds and no $transaction call', async () => {
        const report = makeDetailRow({
          status: 'received',
          kind: 'suggestion',
        });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.changeStatus('admin-1', 'report-1', {
          status: 'cannot_reproduce',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        const body = result.body as any;
        expect(body.message).toContain('bug report');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('fixed (final status) via changeStatus returns 400 and no $transaction call', async () => {
        const report = makeDetailRow({ status: 'under_review' });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.changeStatus('admin-1', 'report-1', {
          status: 'fixed',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        const body = result.body as any;
        expect(body.message).toContain('release');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('received (system-set) via changeStatus returns 400 and no $transaction call', async () => {
        const report = makeDetailRow({ status: 'under_review' });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.changeStatus('admin-1', 'report-1', {
          status: 'received',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        const body = result.body as any;
        expect(body.message).toContain('system sets');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('changing status of already-fixed report returns 400 and no $transaction call', async () => {
        const report = makeDetailRow({
          status: 'fixed',
          release_tag: 'v1.0.0',
        });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.changeStatus('admin-1', 'report-1', {
          status: 'under_review',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        const body = result.body as any;
        expect(body.message).toContain('already');
        expect(body.message).toContain('Fixed');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('unrecognised status (duplicate) returns 400 and no $transaction call', async () => {
        const report = makeDetailRow({ status: 'received' });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.changeStatus('admin-1', 'report-1', {
          status: 'duplicate',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        const body = result.body as any;
        expect(body.message).toContain('not valid');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('missing report returns 404 and no $transaction call', async () => {
        prisma.feedbackReport.findUnique.mockResolvedValue(null);

        const result = await service.changeStatus('admin-1', 'missing-id', {
          status: 'under_review',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(404);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });
  });

  describe('markDelivered', () => {
    describe('happy path', () => {
      test('marking a bug_report delivered sets status to fixed with release tag and writes audit row', async () => {
        const report = makeDetailRow({
          status: 'under_review',
          kind: 'bug_report',
        });
        const updated = makeDetailRow({
          status: 'fixed',
          kind: 'bug_report',
          release_tag: 'v1.0.0',
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

        const result = await service.markDelivered('admin-1', 'report-1', {
          releaseTag: 'v1.0.0',
        });

        expect(result.ok).toBe(true);
        expect(result.status).toBe(200);
        const body = result.body as any;
        expect(body.status).toBe('fixed');
        expect(body.releaseTag).toBe('v1.0.0');

        expect(mockCreate).toHaveBeenCalledWith({
          data: {
            actor_user_id: 'admin-1',
            target_user_id: 'user-1',
            action: 'feedback_manual_delivery',
            meta: {
              reportId: 'report-1',
              status: 'fixed',
              releaseTag: 'v1.0.0',
            },
          },
        });
      });

      test('marking a suggestion delivered sets status to shipped not fixed', async () => {
        const report = makeDetailRow({
          status: 'under_review',
          kind: 'suggestion',
        });
        const updated = makeDetailRow({
          status: 'shipped',
          kind: 'suggestion',
          release_tag: 'v1.0.0',
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

        const result = await service.markDelivered('admin-1', 'report-1', {
          releaseTag: 'v1.0.0',
        });

        expect(result.ok).toBe(true);
        const body = result.body as any;
        expect(body.status).toBe('shipped');

        expect(mockCreate).toHaveBeenCalledWith({
          data: expect.objectContaining({
            meta: expect.objectContaining({
              status: 'shipped',
            }),
          }),
        });
      });
    });

    describe('no-op for same release tag', () => {
      test('re-marking a fixed bug_report with the same release tag is a no-op: no $transaction call', async () => {
        const report = makeDetailRow({
          status: 'fixed',
          kind: 'bug_report',
          release_tag: 'v1.0.0',
        });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.markDelivered('admin-1', 'report-1', {
          releaseTag: 'v1.0.0',
        });

        expect(result.ok).toBe(true);
        expect(result.status).toBe(200);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('re-marking a shipped suggestion with the same release tag is a no-op: no $transaction call', async () => {
        const report = makeDetailRow({
          status: 'shipped',
          kind: 'suggestion',
          release_tag: 'v2.0.0',
        });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.markDelivered('admin-1', 'report-1', {
          releaseTag: 'v2.0.0',
        });

        expect(result.ok).toBe(true);
        expect(result.status).toBe(200);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe('rejection paths', () => {
      test('re-marking with a different release tag returns 400 and no $transaction call', async () => {
        const report = makeDetailRow({
          status: 'fixed',
          release_tag: 'v1.0.0',
        });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.markDelivered('admin-1', 'report-1', {
          releaseTag: 'v2.0.0',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        const body = result.body as any;
        expect(body.message).toContain('already');
        expect(body.message).toContain('v1.0.0');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('invalid release tag (empty string) returns 400 and no $transaction call', async () => {
        const report = makeDetailRow({ status: 'under_review' });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.markDelivered('admin-1', 'report-1', {
          releaseTag: '   ',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        const body = result.body as any;
        expect(body.message).toContain('release');
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('invalid release tag (does not match pattern) returns 400 and no $transaction call', async () => {
        const report = makeDetailRow({ status: 'under_review' });
        prisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.markDelivered('admin-1', 'report-1', {
          releaseTag: 'notaversion',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      test('valid release tags match the pattern (v1.0.0, v1.0.0-rc1, mobile-v1.0.0)', async () => {
        const report = makeDetailRow({ status: 'under_review' });
        const updated = makeDetailRow({
          status: 'fixed',
          release_tag: 'v1.0.0',
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

        // Test v1.0.0
        let result = await service.markDelivered('admin-1', 'report-1', {
          releaseTag: 'v1.0.0',
        });
        expect(result.ok).toBe(true);

        // Reset and test v1.0.0-rc1
        jest.clearAllMocks();
        prisma.feedbackReport.findUnique.mockResolvedValue(report);
        prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

        result = await service.markDelivered('admin-1', 'report-1', {
          releaseTag: 'v1.0.0-rc1',
        });
        expect(result.ok).toBe(true);

        // Reset and test mobile-v1.0.0
        jest.clearAllMocks();
        prisma.feedbackReport.findUnique.mockResolvedValue(report);
        prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

        result = await service.markDelivered('admin-1', 'report-1', {
          releaseTag: 'mobile-v1.0.0',
        });
        expect(result.ok).toBe(true);
      });

      test('missing report returns 404 and no $transaction call', async () => {
        prisma.feedbackReport.findUnique.mockResolvedValue(null);

        const result = await service.markDelivered('admin-1', 'missing-id', {
          releaseTag: 'v1.0.0',
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(404);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });
  });
});
