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

import { FeedbackReleaseService } from './FeedbackReleaseService';

const mockSendFixNoticeForReport =
  require('./FeedbackFixNoticeService').__mockSendFixNoticeForReport;

const ZERO_COUNTS = {
  reportsMarked: 0,
  fixNoticesSent: 0,
  fixNoticesSkipped: 0,
  fixNoticesFailed: 0,
};

describe('FeedbackReleaseService', () => {
  let findMany: jest.Mock<any>;
  let updateMany: jest.Mock<any>;
  let service: FeedbackReleaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendFixNoticeForReport.mockReset();
    mockSendFixNoticeForReport.mockResolvedValue('sent');

    findMany = jest.fn() as jest.Mock<any>;
    updateMany = jest.fn() as jest.Mock<any>;
    findMany.mockResolvedValue([]);
    updateMany.mockResolvedValue({ count: 1 });

    const prisma = {
      feedbackReport: { findMany, updateMany },
    };
    service = new FeedbackReleaseService(prisma as any);
  });

  describe('markRelease', () => {
    describe('release tag validation', () => {
      test('refuses a missing, unprefixed, non-matching or non-string tag with 400 and makes no DB call', async () => {
        for (const releaseTag of [undefined, '1.4.0', 'latest', 140]) {
          const result = await service.markRelease({
            releaseTag,
            issueNumbers: [12],
          });

          expect(result.ok).toBe(false);
          expect(result.status).toBe(400);
        }

        expect(findMany).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
      });

      test('trims surrounding whitespace from the tag before writing it as release_tag', async () => {
        findMany.mockResolvedValue([{ id: 'r-1', kind: 'bug_report' }]);

        const result = await service.markRelease({
          releaseTag: '  v1.4.0  ',
          issueNumbers: [12],
        });

        expect(result).toEqual({
          ok: true,
          status: 200,
          body: {
            reportsMarked: 1,
            fixNoticesSent: 1,
            fixNoticesSkipped: 0,
            fixNoticesFailed: 0,
          },
        });
        expect(updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ release_tag: 'v1.4.0' }),
          }),
        );
      });

      test('accepts a plain, pre-release and mobile release tag', async () => {
        for (const releaseTag of ['v1.4.0', 'v1.4.0-rc1', 'mobile-v1.4.0']) {
          const result = await service.markRelease({
            releaseTag,
            issueNumbers: [12],
          });

          expect(result).toEqual({
            ok: true,
            status: 200,
            body: ZERO_COUNTS,
          });
        }

        expect(findMany).toHaveBeenCalledTimes(3);
      });
    });

    describe('issue number validation', () => {
      test('refuses a non-array or an array holding a non-positive-integer with 400 and no DB call', async () => {
        const invalidIssueNumbers: unknown[] = [
          42,
          '12',
          [0],
          [-3],
          [1.5],
          ['12'],
        ];

        for (const issueNumbers of invalidIssueNumbers) {
          const result = await service.markRelease({
            releaseTag: 'v1.4.0',
            issueNumbers,
          });

          expect(result.ok).toBe(false);
          expect(result.status).toBe(400);
        }

        expect(findMany).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
      });

      test('refuses more than 500 issue numbers with 400 and no DB call', async () => {
        const issueNumbers = Array.from({ length: 501 }, (_, i) => i + 1);

        const result = await service.markRelease({
          releaseTag: 'v1.4.0',
          issueNumbers,
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        expect(findMany).not.toHaveBeenCalled();
      });

      test('accepts exactly 500 distinct positive integers with a single DB query', async () => {
        const issueNumbers = Array.from({ length: 500 }, (_, i) => i + 1);

        const result = await service.markRelease({
          releaseTag: 'v1.4.0',
          issueNumbers,
        });

        expect(result).toEqual({ ok: true, status: 200, body: ZERO_COUNTS });
        expect(findMany).toHaveBeenCalledTimes(1);
      });

      test('an empty issue list returns 200 with zero counts and makes no DB call', async () => {
        const result = await service.markRelease({
          releaseTag: 'v1.4.0',
          issueNumbers: [],
        });

        expect(result).toEqual({
          ok: true,
          status: 200,
          body: ZERO_COUNTS,
        });
        expect(findMany).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
      });
    });

    describe('marking Planned reports', () => {
      test('queries Planned reports on the deduplicated tracking issues', async () => {
        await service.markRelease({
          releaseTag: 'v1.4.0',
          issueNumbers: [12, 15, 12],
        });

        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              tracking_issue_number: { in: [12, 15] },
              status: 'planned',
            }),
          }),
        );
      });

      test('moves a bug report to fixed and a suggestion to shipped, guarded on planned status', async () => {
        findMany.mockResolvedValue([
          { id: 'r-bug', kind: 'bug_report' },
          { id: 'r-sugg', kind: 'suggestion' },
        ]);

        await service.markRelease({
          releaseTag: 'v1.4.0',
          issueNumbers: [12],
        });

        expect(updateMany).toHaveBeenCalledWith({
          where: { id: 'r-bug', status: 'planned' },
          data: expect.objectContaining({
            status: 'fixed',
            release_tag: 'v1.4.0',
            status_changed_at: expect.any(Date),
          }),
        });
        expect(updateMany).toHaveBeenCalledWith({
          where: { id: 'r-sugg', status: 'planned' },
          data: expect.objectContaining({
            status: 'shipped',
            release_tag: 'v1.4.0',
            status_changed_at: expect.any(Date),
          }),
        });
      });

      test('a report whose guarded update lands is counted and gets one Fix Notice', async () => {
        findMany.mockResolvedValue([{ id: 'r-1', kind: 'bug_report' }]);
        updateMany.mockResolvedValue({ count: 1 });
        mockSendFixNoticeForReport.mockResolvedValue('sent');

        const result = await service.markRelease({
          releaseTag: 'v1.4.0',
          issueNumbers: [12],
        });

        // Whole-body equality also proves the response carries only the four counts.
        expect(result).toEqual({
          ok: true,
          status: 200,
          body: {
            reportsMarked: 1,
            fixNoticesSent: 1,
            fixNoticesSkipped: 0,
            fixNoticesFailed: 0,
          },
        });
        expect(mockSendFixNoticeForReport).toHaveBeenCalledTimes(1);
        expect(mockSendFixNoticeForReport).toHaveBeenCalledWith('r-1');
      });

      test('a report another run already moved is neither counted nor notified', async () => {
        findMany.mockResolvedValue([
          { id: 'r-1', kind: 'bug_report' },
          { id: 'r-2', kind: 'bug_report' },
        ]);
        updateMany.mockImplementation(async ({ where }: any) => ({
          count: where.id === 'r-2' ? 0 : 1,
        }));

        const result = await service.markRelease({
          releaseTag: 'v1.4.0',
          issueNumbers: [12],
        });

        expect(result).toEqual({
          ok: true,
          status: 200,
          body: {
            reportsMarked: 1,
            fixNoticesSent: 1,
            fixNoticesSkipped: 0,
            fixNoticesFailed: 0,
          },
        });
        expect(mockSendFixNoticeForReport).toHaveBeenCalledTimes(1);
        expect(mockSendFixNoticeForReport).toHaveBeenCalledWith('r-1');
        expect(mockSendFixNoticeForReport).not.toHaveBeenCalledWith('r-2');
      });

      test('tallies each Fix Notice outcome, and a failed notice still leaves the release marked', async () => {
        findMany.mockResolvedValue([
          { id: 'r-1', kind: 'bug_report' },
          { id: 'r-2', kind: 'bug_report' },
          { id: 'r-3', kind: 'suggestion' },
          { id: 'r-4', kind: 'suggestion' },
          { id: 'r-5', kind: 'bug_report' },
        ]);
        updateMany.mockResolvedValue({ count: 1 });
        const outcomes: Record<string, string> = {
          'r-1': 'sent',
          'r-2': 'skipped_not_opted_in',
          'r-3': 'skipped_reporter_deleted',
          'r-4': 'skipped_already_sent',
          'r-5': 'failed',
        };
        mockSendFixNoticeForReport.mockImplementation(
          async (reportId: any) => outcomes[reportId],
        );

        const result = await service.markRelease({
          releaseTag: 'v1.4.0',
          issueNumbers: [12, 13],
        });

        expect(result).toEqual({
          ok: true,
          status: 200,
          body: {
            reportsMarked: 5,
            fixNoticesSent: 1,
            fixNoticesSkipped: 3,
            fixNoticesFailed: 1,
          },
        });
      });

      test('a re-run with the same tag marks nothing the second time and sends no further notices', async () => {
        // Stateful fake: the first run's guarded update moves the report out of
        // Planned, so the second run's Planned query finds nothing.
        const store = [{ id: 'r-1', kind: 'bug_report', status: 'planned' }];
        findMany.mockImplementation(async ({ where }: any) =>
          store
            .filter((row) => row.status === where.status)
            .map(({ id, kind }) => ({ id, kind })),
        );
        updateMany.mockImplementation(async ({ where, data }: any) => {
          const row = store.find(
            (candidate) =>
              candidate.id === where.id && candidate.status === where.status,
          );
          if (!row) return { count: 0 };
          row.status = data.status;
          return { count: 1 };
        });

        const first = await service.markRelease({
          releaseTag: 'v1.4.0',
          issueNumbers: [12],
        });
        const second = await service.markRelease({
          releaseTag: 'v1.4.0',
          issueNumbers: [12],
        });

        expect(first).toEqual({
          ok: true,
          status: 200,
          body: {
            reportsMarked: 1,
            fixNoticesSent: 1,
            fixNoticesSkipped: 0,
            fixNoticesFailed: 0,
          },
        });
        expect(second).toEqual({ ok: true, status: 200, body: ZERO_COUNTS });
        expect(updateMany).toHaveBeenCalledTimes(1);
        expect(mockSendFixNoticeForReport).toHaveBeenCalledTimes(1);
        expect(mockSendFixNoticeForReport).toHaveBeenCalledWith('r-1');
      });
    });
  });
});
