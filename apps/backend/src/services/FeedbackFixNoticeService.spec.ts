/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('../prisma', () => {
  const __mockPrisma = {
    feedbackReport: {
      findUnique: jest.fn(),
    },
    feedbackFixNoticeDelivery: {
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  return {
    createPrismaClient: () => __mockPrisma,
    PrismaClient: jest.fn(),
    __mockPrisma,
  };
});

jest.mock('./EmailService', () => {
  const __mockSendEmail = (jest.fn() as jest.Mock<any>).mockResolvedValue(
    undefined,
  );
  return {
    __esModule: true,
    default: __mockSendEmail,
    __mockSendEmail,
  };
});

import { FeedbackFixNoticeService } from './FeedbackFixNoticeService';

const mockPrisma = require('../prisma').__mockPrisma;
const mockSendEmail = require('./EmailService').__mockSendEmail;

describe('FeedbackFixNoticeService', () => {
  let service: FeedbackFixNoticeService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendEmail.mockResolvedValue(undefined);
    service = new FeedbackFixNoticeService(mockPrisma as any);
  });

  describe('sendFixNoticeForReport', () => {
    describe('happy path', () => {
      test('report found, reporter present, opted in, user enabled → claims ledger, sends mail, finishes with status sent', async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Critical bug',
          release_tag: 'v1.4.0',
          reporter_user_id: 'user-1',
          fix_notice_opt_in: true,
        };

        const user = {
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'John',
          fix_notices_enabled: true,
          fix_notice_unsubscribe_token: 'existing-token-123',
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);
        mockPrisma.feedbackFixNoticeDelivery.create.mockResolvedValue({
          report_id: 'report-1',
          status: 'claimed',
        });
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.feedbackFixNoticeDelivery.update.mockResolvedValue({
          report_id: 'report-1',
          status: 'sent',
          sent_at: new Date(),
        });

        const result = await service.sendFixNoticeForReport('report-1');

        expect(result).toBe('sent');
        expect(mockPrisma.feedbackReport.findUnique).toHaveBeenCalledWith({
          where: { id: 'report-1' },
          select: {
            id: true,
            kind: true,
            title: true,
            release_tag: true,
            reporter_user_id: true,
            fix_notice_opt_in: true,
          },
        });
        expect(
          mockPrisma.feedbackFixNoticeDelivery.create,
        ).toHaveBeenCalledWith({
          data: { report_id: 'report-1', status: 'claimed' },
        });
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
          where: { id: 'user-1' },
          select: {
            id: true,
            email: true,
            first_name: true,
            fix_notices_enabled: true,
            fix_notice_unsubscribe_token: true,
          },
        });
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(
          mockPrisma.feedbackFixNoticeDelivery.update,
        ).toHaveBeenCalledWith({
          where: { report_id: 'report-1' },
          data: {
            status: 'sent',
            sent_at: expect.any(Date),
            error: null,
          },
        });
      });

      test('email includes release tag and CHANGELOG link in rendered output', async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Critical bug',
          release_tag: 'v1.4.0',
          reporter_user_id: 'user-1',
          fix_notice_opt_in: true,
        };

        const user = {
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'John',
          fix_notices_enabled: true,
          fix_notice_unsubscribe_token: 'token-abc',
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);
        mockPrisma.feedbackFixNoticeDelivery.create.mockResolvedValue({});
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.feedbackFixNoticeDelivery.update.mockResolvedValue({});

        await service.sendFixNoticeForReport('report-1');

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        const emailCall = (mockSendEmail as jest.Mock).mock.calls[0];
        const message = emailCall[2] as any;

        expect(message.html).toContain('v1.4.0');
        expect(message.html).toContain(
          'https://github.com/mnaimfaizy/myorganiser/blob/v1.4.0/CHANGELOG.md',
        );
        expect(message.text).toContain('v1.4.0');
      });

      test('email includes unsubscribe link in rendered output', async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Bug',
          release_tag: 'v1.0.0',
          reporter_user_id: 'user-1',
          fix_notice_opt_in: true,
        };

        const user = {
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'Jane',
          fix_notices_enabled: true,
          fix_notice_unsubscribe_token: 'unsubscribe-token-xyz',
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);
        mockPrisma.feedbackFixNoticeDelivery.create.mockResolvedValue({});
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.feedbackFixNoticeDelivery.update.mockResolvedValue({});

        process.env.APP_FRONTEND_URL = 'https://app.example.com';

        await service.sendFixNoticeForReport('report-1');

        expect(mockSendEmail).toHaveBeenCalled();
        const message = (mockSendEmail as jest.Mock).mock.calls[0][2] as any;

        expect(message.html).toContain('/feedback/unsubscribe?token=');
        expect(message.html).toContain('unsubscribe-token-xyz');

        delete process.env.APP_FRONTEND_URL;
      });

      test('mobile release does not include CHANGELOG button, says "install the update" instead', async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Bug',
          release_tag: 'mobile-v1.4.0',
          reporter_user_id: 'user-1',
          fix_notice_opt_in: true,
        };

        const user = {
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'John',
          fix_notices_enabled: true,
          fix_notice_unsubscribe_token: 'token-123',
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);
        mockPrisma.feedbackFixNoticeDelivery.create.mockResolvedValue({});
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.feedbackFixNoticeDelivery.update.mockResolvedValue({});

        await service.sendFixNoticeForReport('report-1');

        const message = (mockSendEmail as jest.Mock).mock.calls[0][2] as any;

        expect(message.html).toContain('Install the update');
        expect(message.html).not.toContain('CHANGELOG');
      });

      test('token is minted on first use and reused on second call', async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Bug',
          release_tag: 'v1.0.0',
          reporter_user_id: 'user-1',
          fix_notice_opt_in: true,
        };

        const userWithoutToken = {
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'John',
          fix_notices_enabled: true,
          fix_notice_unsubscribe_token: null,
        };

        const userWithToken = {
          ...userWithoutToken,
          fix_notice_unsubscribe_token: 'minted-token-abc123def',
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);
        mockPrisma.feedbackFixNoticeDelivery.create.mockResolvedValue({});
        mockPrisma.user.findUnique.mockResolvedValue(userWithoutToken);
        mockPrisma.user.update.mockResolvedValue(userWithToken);
        mockPrisma.feedbackFixNoticeDelivery.update.mockResolvedValue({});

        await service.sendFixNoticeForReport('report-1');

        expect(mockPrisma.user.update).toHaveBeenCalledWith({
          where: { id: 'user-1' },
          data: { fix_notice_unsubscribe_token: expect.any(String) },
        });

        const mintedToken = (
          (mockPrisma.user.update as jest.Mock).mock.calls[0][0] as any
        ).data.fix_notice_unsubscribe_token;

        // Reset mocks and test that second call reuses the token
        jest.clearAllMocks();
        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);
        mockPrisma.feedbackFixNoticeDelivery.create.mockResolvedValue({});
        mockPrisma.user.findUnique.mockResolvedValue({
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'John',
          fix_notices_enabled: true,
          fix_notice_unsubscribe_token: mintedToken,
        });
        mockPrisma.feedbackFixNoticeDelivery.update.mockResolvedValue({});

        await service.sendFixNoticeForReport('report-1');

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      });
    });

    describe('skip cases', () => {
      test('reporter deleted → returns skipped_reporter_deleted, no ledger claim', async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Bug',
          release_tag: 'v1.0.0',
          reporter_user_id: null,
          fix_notice_opt_in: true,
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.sendFixNoticeForReport('report-1');

        expect(result).toBe('skipped_reporter_deleted');
        expect(
          mockPrisma.feedbackFixNoticeDelivery.create,
        ).not.toHaveBeenCalled();
      });

      test('not opted in → returns skipped_not_opted_in, no ledger claim', async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Bug',
          release_tag: 'v1.0.0',
          reporter_user_id: 'user-1',
          fix_notice_opt_in: false,
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);

        const result = await service.sendFixNoticeForReport('report-1');

        expect(result).toBe('skipped_not_opted_in');
        expect(
          mockPrisma.feedbackFixNoticeDelivery.create,
        ).not.toHaveBeenCalled();
      });

      test('already sent (unique violation) → returns skipped_already_sent, no mail sent', async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Bug',
          release_tag: 'v1.0.0',
          reporter_user_id: 'user-1',
          fix_notice_opt_in: true,
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);
        mockPrisma.feedbackFixNoticeDelivery.create.mockRejectedValue({
          code: 'P2002',
        });

        const result = await service.sendFixNoticeForReport('report-1');

        expect(result).toBe('skipped_already_sent');
        expect(mockSendEmail).not.toHaveBeenCalled();
      });

      test('user globally unsubscribed after opting in on report → mail not sent, ledger failed, returns skipped_not_opted_in', async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Bug',
          release_tag: 'v1.0.0',
          reporter_user_id: 'user-1',
          fix_notice_opt_in: true,
        };

        const user = {
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'John',
          fix_notices_enabled: false,
          fix_notice_unsubscribe_token: 'token-123',
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);
        mockPrisma.feedbackFixNoticeDelivery.create.mockResolvedValue({});
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockPrisma.feedbackFixNoticeDelivery.update.mockResolvedValue({});

        const result = await service.sendFixNoticeForReport('report-1');

        expect(result).toBe('skipped_not_opted_in');
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(
          mockPrisma.feedbackFixNoticeDelivery.update,
        ).toHaveBeenCalledWith({
          where: { report_id: 'report-1' },
          data: {
            status: 'failed',
            sent_at: null,
            error: 'unsubscribed',
          },
        });
      });

      test("reporter's user row missing (after claim succeeds) → mail not sent, ledger failed, returns skipped_reporter_deleted", async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Bug',
          release_tag: 'v1.0.0',
          reporter_user_id: 'user-1',
          fix_notice_opt_in: true,
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);
        mockPrisma.feedbackFixNoticeDelivery.create.mockResolvedValue({});
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.feedbackFixNoticeDelivery.update.mockResolvedValue({});

        const result = await service.sendFixNoticeForReport('report-1');

        expect(result).toBe('skipped_reporter_deleted');
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(
          mockPrisma.feedbackFixNoticeDelivery.update,
        ).toHaveBeenCalledWith({
          where: { report_id: 'report-1' },
          data: {
            status: 'failed',
            sent_at: null,
            error: 'user_missing',
          },
        });
      });
    });

    describe('error handling', () => {
      test('mail transport throws → ledger updated failed, function resolves not rejects, returns failed', async () => {
        const report = {
          id: 'report-1',
          kind: 'bug_report' as const,
          title: 'Bug',
          release_tag: 'v1.0.0',
          reporter_user_id: 'user-1',
          fix_notice_opt_in: true,
        };

        const user = {
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'John',
          fix_notices_enabled: true,
          fix_notice_unsubscribe_token: 'token-123',
        };

        mockPrisma.feedbackReport.findUnique.mockResolvedValue(report);
        mockPrisma.feedbackFixNoticeDelivery.create.mockResolvedValue({});
        mockPrisma.user.findUnique.mockResolvedValue(user);
        mockSendEmail.mockRejectedValue(new Error('SMTP connection failed'));
        mockPrisma.feedbackFixNoticeDelivery.update.mockResolvedValue({});

        const result = await service.sendFixNoticeForReport('report-1');

        expect(result).toBe('failed');
        expect(
          mockPrisma.feedbackFixNoticeDelivery.update,
        ).toHaveBeenCalledWith({
          where: { report_id: 'report-1' },
          data: {
            status: 'failed',
            sent_at: null,
            error: 'SMTP connection failed',
          },
        });
      });
    });
  });

  describe('unsubscribe', () => {
    test('unsubscribe with matching token → user.updateMany called, returns true', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.unsubscribe('valid-token-xyz');

      expect(result).toBe(true);
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { fix_notice_unsubscribe_token: 'valid-token-xyz' },
        data: { fix_notices_enabled: false },
      });
    });

    test('unsubscribe with unknown token → returns false, user.updateMany not called', async () => {
      const result = await service.unsubscribe('');

      expect(result).toBe(false);
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    test('unsubscribe with non-matching token → user.updateMany returns count 0, returns false', async () => {
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.unsubscribe('unknown-token');

      expect(result).toBe(false);
    });
  });
});
