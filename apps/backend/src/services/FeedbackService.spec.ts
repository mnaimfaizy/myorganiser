/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('../prisma', () => ({
  createPrismaClient: () => ({}),
}));

import {
  FEEDBACK_REPORT_TEXT_MAX_LENGTH,
  FEEDBACK_REPORT_TITLE_MAX_LENGTH,
  FEEDBACK_REPORT_RATE_WINDOW_MS,
  FEEDBACK_REPORTS_PER_DAY_LIMIT,
  INITIAL_FEEDBACK_REPORT_STATUS,
  FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH,
  FEEDBACK_REPORT_STATUS_RULES,
} from './feedbackReportConstants';
import {
  FEEDBACK_REPORT_CAP_MESSAGES,
  FEEDBACK_REPORT_REQUIRED_MESSAGES,
} from '@myorganiser/core';
import {
  FeedbackService,
  CreateFeedbackReportInput,
  FeedbackReportDto,
} from './FeedbackService';

type MockPrisma = {
  feedbackReport: {
    count: jest.Mock<any>;
    create: jest.Mock<any>;
    findMany: jest.Mock<any>;
    findUnique: jest.Mock<any>;
    update: jest.Mock<any>;
  };
  user: {
    findUniqueOrThrow: jest.Mock<any>;
    update: jest.Mock<any>;
  };
};

function makePrisma(): MockPrisma {
  return {
    feedbackReport: {
      count: jest.fn() as jest.Mock<any>,
      create: jest.fn() as jest.Mock<any>,
      findMany: jest.fn() as jest.Mock<any>,
      findUnique: jest.fn() as jest.Mock<any>,
      update: jest.fn() as jest.Mock<any>,
    },
    user: {
      findUniqueOrThrow: jest.fn() as jest.Mock<any>,
      update: jest.fn() as jest.Mock<any>,
    },
  };
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}): {
  id: string;
  kind: 'bug_report' | 'suggestion';
  status: string;
  title: string;
  created_at: Date;
} {
  return {
    id: 'report-1',
    kind: 'bug_report',
    status: INITIAL_FEEDBACK_REPORT_STATUS,
    title: 'Test Title',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeListRow(overrides: Partial<Record<string, unknown>> = {}): {
  id: string;
  kind: 'bug_report' | 'suggestion';
  status: string;
  title: string;
  status_note: string | null;
  release_tag: string | null;
  status_changed_at: Date | null;
  created_at: Date;
  follow_up: string | null;
  reporter_user_id: string;
} {
  return {
    id: 'report-1',
    kind: 'bug_report',
    status: INITIAL_FEEDBACK_REPORT_STATUS,
    title: 'Test Title',
    status_note: null,
    release_tag: null,
    status_changed_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    follow_up: null,
    reporter_user_id: 'user-1',
    ...overrides,
  };
}

function makeValidInput(
  overrides: Partial<CreateFeedbackReportInput> = {},
): CreateFeedbackReportInput {
  return {
    kind: 'bug_report',
    title: 'Test Title',
    description: 'Test Description',
    context: {
      platform: 'web',
      appVersion: '1.0.0',
      browser: 'Chrome',
      operatingSystem: 'macOS',
      path: '/dashboard',
      sentAt: new Date().toISOString(),
    },
    fixNoticeOptIn: true,
    ...overrides,
  };
}

describe('FeedbackService', () => {
  let prisma: MockPrisma;
  let service: FeedbackService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrisma();
    service = new FeedbackService(prisma as any);
  });

  describe('happy path', () => {
    test('creates a bug report with fix notice opt-in', async () => {
      const now = new Date();
      const row = makeRow({ created_at: now });
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(row);

      const input = makeValidInput({
        kind: 'bug_report',
        fixNoticeOptIn: true,
      });

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
      if (result.ok) {
        const dto = result.body as FeedbackReportDto;
        expect(dto.id).toBe('report-1');
        expect(dto.kind).toBe('bug_report');
        expect(dto.status).toBe('received');
        expect(dto.title).toBe('Test Title');
        expect(dto.createdAt).toBe(now.toISOString());
      }

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reporter_user_id: 'user-1',
          kind: 'bug_report',
          status: 'received',
          title: 'Test Title',
          description: 'Test Description',
          fix_notice_opt_in: true,
        }),
      });
    });

    test('stores opt-in as false when provided', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput({ fixNoticeOptIn: false });

      await service.createReport('user-1', input);

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fix_notice_opt_in: false,
        }),
      });
    });
  });

  describe('field length validation', () => {
    test('accepts title at the cap (120 characters)', async () => {
      const title = 'a'.repeat(FEEDBACK_REPORT_TITLE_MAX_LENGTH);
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput({ title });

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
      expect(prisma.feedbackReport.create).toHaveBeenCalled();
    });

    test('rejects title over the cap (121+ characters)', async () => {
      const title = 'a'.repeat(FEEDBACK_REPORT_TITLE_MAX_LENGTH + 1);
      const input = makeValidInput({ title });

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain('title');
      expect(body.message).toContain('120');
      expect(prisma.feedbackReport.count).not.toHaveBeenCalled();
      expect(prisma.feedbackReport.create).not.toHaveBeenCalled();
    });

    test('rejects description over the cap (4001+ characters)', async () => {
      const description = 'a'.repeat(FEEDBACK_REPORT_TEXT_MAX_LENGTH + 1);
      const input = makeValidInput({ description });

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain('description');
      expect(prisma.feedbackReport.create).not.toHaveBeenCalled();
    });

    test('rejects expected outcome over the cap for bug report', async () => {
      const expectedOutcome = 'a'.repeat(FEEDBACK_REPORT_TEXT_MAX_LENGTH + 1);
      const input = makeValidInput({
        kind: 'bug_report',
        expectedOutcome,
      });

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain('expected');
      expect(prisma.feedbackReport.create).not.toHaveBeenCalled();
    });

    test('rejects empty title (whitespace only)', async () => {
      const input = makeValidInput({ title: '   ' });

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain('title');
      expect(prisma.feedbackReport.create).not.toHaveBeenCalled();
    });
  });

  describe('expected outcome rules', () => {
    test('stores null when expected outcome is absent for bug report', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput({
        kind: 'bug_report',
      });
      // Remove expectedOutcome
      delete input.expectedOutcome;

      await service.createReport('user-1', input);

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expected_outcome: null,
        }),
      });
    });

    test('stores null when expected outcome is whitespace-only for bug report', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput({
        kind: 'bug_report',
        expectedOutcome: '   ',
      });

      await service.createReport('user-1', input);

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expected_outcome: null,
        }),
      });
    });

    test('rejects suggestion with non-empty expected outcome', async () => {
      const input = makeValidInput({
        kind: 'suggestion',
        expectedOutcome: 'Expected behavior',
      });

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain('suggestion');
      expect(prisma.feedbackReport.create).not.toHaveBeenCalled();
    });

    test('accepts suggestion without expected outcome', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(
        makeRow({ kind: 'suggestion' }),
      );

      const input = makeValidInput({
        kind: 'suggestion',
      });
      delete input.expectedOutcome;

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
    });
  });

  describe('context validation', () => {
    test('rejects invalid context time', async () => {
      const input = makeValidInput({
        context: {
          platform: 'web',
          appVersion: '1.0.0',
          browser: 'Chrome',
          operatingSystem: 'macOS',
          path: '/dashboard',
          sentAt: 'not-a-date',
        },
      });

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain('time');
      expect(prisma.feedbackReport.create).not.toHaveBeenCalled();
    });

    test('strips query string from context path', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput({
        context: {
          platform: 'web',
          appVersion: '1.0.0',
          browser: 'Chrome',
          operatingSystem: 'macOS',
          path: '/dashboard/tasks?id=secret&view=list',
          sentAt: new Date().toISOString(),
        },
      });

      await service.createReport('user-1', input);

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          context_path: '/dashboard/tasks',
        }),
      });
    });

    test('strips fragment from context path', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput({
        context: {
          platform: 'web',
          appVersion: '1.0.0',
          browser: 'Chrome',
          operatingSystem: 'macOS',
          path: '/dashboard/tasks#top',
          sentAt: new Date().toISOString(),
        },
      });

      await service.createReport('user-1', input);

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          context_path: '/dashboard/tasks',
        }),
      });
    });

    test('strips query string and fragment from context path', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput({
        context: {
          platform: 'web',
          appVersion: '1.0.0',
          browser: 'Chrome',
          operatingSystem: 'macOS',
          path: '/dashboard/tasks?id=1#section',
          sentAt: new Date().toISOString(),
        },
      });

      await service.createReport('user-1', input);

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          context_path: '/dashboard/tasks',
        }),
      });
    });
  });

  describe('string trimming', () => {
    test('trims title', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput({ title: '  Trimmed Title  ' });

      await service.createReport('user-1', input);

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Trimmed Title',
        }),
      });
    });

    test('trims description', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput({ description: '  Trimmed Description  ' });

      await service.createReport('user-1', input);

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: 'Trimmed Description',
        }),
      });
    });

    test('trims context fields', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput({
        context: {
          platform: '  web  ',
          appVersion: '  1.0.0  ',
          browser: '  Chrome  ',
          operatingSystem: '  macOS  ',
          path: '  /dashboard  ',
          sentAt: new Date().toISOString(),
        },
      });

      await service.createReport('user-1', input);

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          context_platform: 'web',
          context_app_version: '1.0.0',
          context_browser: 'Chrome',
          context_operating_system: 'macOS',
          context_path: '/dashboard',
        }),
      });
    });
  });

  describe('rate limiting', () => {
    test('accepts the tenth report in a 24-hour window', async () => {
      prisma.feedbackReport.count.mockResolvedValue(9);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput();

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
      expect(prisma.feedbackReport.create).toHaveBeenCalled();
    });

    test('refuses the eleventh report in a 24-hour window', async () => {
      prisma.feedbackReport.count.mockResolvedValue(
        FEEDBACK_REPORTS_PER_DAY_LIMIT,
      );

      const input = makeValidInput();

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(429);
      const body = result.body as any;
      expect(body.message).toContain('too many');
      expect(prisma.feedbackReport.create).not.toHaveBeenCalled();
    });

    test('rate limit window uses reporter_user_id and created_at from stored rows', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput();
      const beforeCall = Date.now();

      await service.createReport('user-1', input);

      const afterCall = Date.now();

      expect(prisma.feedbackReport.count).toHaveBeenCalledWith({
        where: {
          reporter_user_id: 'user-1',
          created_at: {
            gte: expect.any(Date),
          },
        },
      });

      const callArgs = prisma.feedbackReport.count.mock.calls[0][0] as any;
      const windowStart = callArgs.where.created_at.gte;
      const expectedStart = new Date(
        beforeCall - FEEDBACK_REPORT_RATE_WINDOW_MS,
      );
      const expectedEnd = new Date(afterCall - FEEDBACK_REPORT_RATE_WINDOW_MS);

      // Ensure the window start is within a reasonable tolerance (within 1 second)
      expect(windowStart.getTime()).toBeGreaterThanOrEqual(
        expectedStart.getTime() - 1000,
      );
      expect(windowStart.getTime()).toBeLessThanOrEqual(
        expectedEnd.getTime() + 1000,
      );
    });

    test('validation happens before rate limit check', async () => {
      // Submit with invalid title to ensure count is not called
      const input = makeValidInput({ title: 'a'.repeat(121) });

      const result = await service.createReport('user-1', input);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(prisma.feedbackReport.count).not.toHaveBeenCalled();
      expect(prisma.feedbackReport.create).not.toHaveBeenCalled();
    });
  });

  describe('status initialization', () => {
    test('stores status as received for new reports', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      const input = makeValidInput();

      await service.createReport('user-1', input);

      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: INITIAL_FEEDBACK_REPORT_STATUS,
        }),
      });
    });
  });

  describe('context sent_at vs created_at', () => {
    test('uses server created_at for rate window, not client sentAt', async () => {
      prisma.feedbackReport.count.mockResolvedValue(0);
      prisma.feedbackReport.create.mockResolvedValue(makeRow());

      // Client sends a sentAt from 48 hours ago
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);

      const input = makeValidInput({
        context: {
          platform: 'web',
          appVersion: '1.0.0',
          browser: 'Chrome',
          operatingSystem: 'macOS',
          path: '/dashboard',
          sentAt: oldDate.toISOString(),
        },
      });

      const result = await service.createReport('user-1', input);

      // Should still succeed because server uses its own now() for the window,
      // not the client's sentAt
      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);

      // But the context_sent_at should store what the client sent
      expect(prisma.feedbackReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          context_sent_at: oldDate,
        }),
      });
    });
  });

  describe('listReports', () => {
    test('scopes query to the caller via reporter_user_id', async () => {
      const report = makeListRow();
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: null,
      });

      await service.listReports('user-123');

      expect(prisma.feedbackReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reporter_user_id: 'user-123' },
        }),
      );
    });

    test('orders reports newest first by created_at', async () => {
      const report = makeListRow();
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: null,
      });

      await service.listReports('user-1');

      expect(prisma.feedbackReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { created_at: 'desc' },
        }),
      );
    });

    test('returns ok: true with status 200 and mapped items', async () => {
      const now = new Date();
      const report = makeListRow({
        id: 'report-1',
        title: 'Test Bug',
        kind: 'bug_report',
        status: 'received',
        created_at: now,
      });
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: null,
      });

      const result = await service.listReports('user-1');

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      if (result.ok) {
        expect(result.body.items).toHaveLength(1);
        expect(result.body.items[0]).toMatchObject({
          id: 'report-1',
          title: 'Test Bug',
          kind: 'bug_report',
          status: 'received',
          createdAt: now.toISOString(),
        });
      }
    });

    test('hasChangedSinceLastSeen is true when status_changed_at > feedback_reports_seen_at', async () => {
      const seenAt = new Date('2026-01-01T12:00:00.000Z');
      const changedAt = new Date('2026-01-01T13:00:00.000Z');
      const report = makeListRow({
        status_changed_at: changedAt,
      });
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: seenAt,
      });

      const result = await service.listReports('user-1');

      if (result.ok) {
        expect(result.body.hasChangedSinceLastSeen).toBe(true);
      }
    });

    test('hasChangedSinceLastSeen is false when status_changed_at <= feedback_reports_seen_at', async () => {
      const seenAt = new Date('2026-01-01T13:00:00.000Z');
      const changedAt = new Date('2026-01-01T12:00:00.000Z');
      const report = makeListRow({
        status_changed_at: changedAt,
      });
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: seenAt,
      });

      const result = await service.listReports('user-1');

      if (result.ok) {
        expect(result.body.hasChangedSinceLastSeen).toBe(false);
      }
    });

    test('hasChangedSinceLastSeen is true when feedback_reports_seen_at is null and at least one report has status_changed_at', async () => {
      const changedAt = new Date('2026-01-01T12:00:00.000Z');
      const report = makeListRow({
        status_changed_at: changedAt,
      });
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: null,
      });

      const result = await service.listReports('user-1');

      if (result.ok) {
        expect(result.body.hasChangedSinceLastSeen).toBe(true);
      }
    });

    test('hasChangedSinceLastSeen is false when no reports have status_changed_at', async () => {
      const report = makeListRow({
        status_changed_at: null,
      });
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: null,
      });

      const result = await service.listReports('user-1');

      if (result.ok) {
        expect(result.body.hasChangedSinceLastSeen).toBe(false);
      }
    });

    test('hasChangedSinceLastSeen is false when there are zero reports', async () => {
      prisma.feedbackReport.findMany.mockResolvedValue([]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: new Date(),
      });

      const result = await service.listReports('user-1');

      if (result.ok) {
        expect(result.body.items).toHaveLength(0);
        expect(result.body.hasChangedSinceLastSeen).toBe(false);
      }
    });
  });

  describe('toListItemDto changelogUrl mapping', () => {
    test('bug_report with status fixed and release_tag gets changelogUrl', async () => {
      const releaseTag = 'v1.2.3';
      const report = makeListRow({
        kind: 'bug_report',
        status: 'fixed',
        release_tag: releaseTag,
      });
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: null,
      });

      const result = await service.listReports('user-1');

      if (result.ok) {
        expect(result.body.items[0].changelogUrl).toBe(
          `https://github.com/mnaimfaizy/myorganiser/blob/${releaseTag}/CHANGELOG.md`,
        );
      }
    });

    test('suggestion with status shipped and release_tag gets changelogUrl', async () => {
      const releaseTag = 'v1.2.3';
      const report = makeListRow({
        kind: 'suggestion',
        status: 'shipped',
        release_tag: releaseTag,
      });
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: null,
      });

      const result = await service.listReports('user-1');

      if (result.ok) {
        expect(result.body.items[0].changelogUrl).toBe(
          `https://github.com/mnaimfaizy/myorganiser/blob/${releaseTag}/CHANGELOG.md`,
        );
      }
    });

    test('bug_report with wrong status shipped does not get changelogUrl', async () => {
      const report = makeListRow({
        kind: 'bug_report',
        status: 'shipped',
        release_tag: 'v1.2.3',
      });
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: null,
      });

      const result = await service.listReports('user-1');

      if (result.ok) {
        expect(result.body.items[0].changelogUrl).toBeNull();
      }
    });

    test('report with release_tag null does not get changelogUrl', async () => {
      const report = makeListRow({
        kind: 'bug_report',
        status: 'fixed',
        release_tag: null,
      });
      prisma.feedbackReport.findMany.mockResolvedValue([report]);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        feedback_reports_seen_at: null,
      });

      const result = await service.listReports('user-1');

      if (result.ok) {
        expect(result.body.items[0].changelogUrl).toBeNull();
      }
    });
  });

  describe('markReportsSeen', () => {
    test('updates user feedback_reports_seen_at and returns seenAt as ISO string', async () => {
      const beforeCall = Date.now();
      prisma.user.update.mockImplementation(({ data }) => {
        return Promise.resolve({
          id: 'user-1',
          feedback_reports_seen_at: data.feedback_reports_seen_at,
        });
      });

      const result = await service.markReportsSeen('user-1');

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          feedback_reports_seen_at: expect.any(Date),
        },
      });

      // Verify seenAt is the ISO string of the date that was set
      if (result.ok) {
        const callData = prisma.user.update.mock.calls[0][0] as any;
        const expectedSeenAt =
          callData.data.feedback_reports_seen_at.toISOString();
        expect(result.body.seenAt).toBe(expectedSeenAt);

        // Verify the timestamp is recent
        const seenAtTime = new Date(result.body.seenAt).getTime();
        expect(seenAtTime).toBeGreaterThanOrEqual(beforeCall);
        expect(seenAtTime).toBeLessThanOrEqual(Date.now());
      }
    });

    test('calls user.update with correct userId', async () => {
      prisma.user.update.mockResolvedValue({
        id: 'user-456',
        feedback_reports_seen_at: new Date(),
      });

      await service.markReportsSeen('user-456');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-456' },
        }),
      );
    });
  });

  describe('addFollowUp', () => {
    test('happy path: creates follow-up on cannot_reproduce report owned by caller', async () => {
      const now = new Date();
      const row = makeListRow({
        status: 'cannot_reproduce',
        reporter_user_id: 'user-1',
        follow_up: null,
        status_changed_at: now,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(row);
      prisma.feedbackReport.update.mockResolvedValue({
        ...row,
        follow_up: 'More detail here',
        status: 'under_review',
      });

      const result = await service.addFollowUp('user-1', 'report-1', {
        followUp: 'More detail here',
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      if (result.ok) {
        expect(result.body.followUp).toBe('More detail here');
        expect(result.body.status).toBe('under_review');
      }

      expect(prisma.feedbackReport.update).toHaveBeenCalledWith({
        where: { id: 'report-1' },
        data: {
          follow_up: 'More detail here',
          status: 'under_review',
          status_changed_at: expect.any(Date),
        },
        select: expect.objectContaining({
          id: true,
          kind: true,
          status: true,
          title: true,
          follow_up: true,
        }),
      });
    });

    test('returns 404 when report does not exist', async () => {
      prisma.feedbackReport.findUnique.mockResolvedValue(null);

      const result = await service.addFollowUp('user-1', 'report-1', {
        followUp: 'Follow-up text',
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      const body = result.body as any;
      expect(body.message).toContain('does not exist');
      expect(prisma.feedbackReport.update).not.toHaveBeenCalled();
    });

    test('returns 404 when report is owned by someone else', async () => {
      const row = makeListRow({
        status: 'cannot_reproduce',
        reporter_user_id: 'someone-else',
        follow_up: null,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(row);

      const result = await service.addFollowUp('user-1', 'report-1', {
        followUp: 'Follow-up text',
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      expect(prisma.feedbackReport.update).not.toHaveBeenCalled();
    });

    test('returns 400 when report status is not cannot_reproduce', async () => {
      const row = makeListRow({
        status: 'received',
        reporter_user_id: 'user-1',
        follow_up: null,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(row);

      const result = await service.addFollowUp('user-1', 'report-1', {
        followUp: 'Follow-up text',
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain(
        FEEDBACK_REPORT_STATUS_RULES.cannot_reproduce.label,
      );
      expect(prisma.feedbackReport.update).not.toHaveBeenCalled();
    });

    test('returns 400 when report already has a follow-up', async () => {
      const row = makeListRow({
        status: 'cannot_reproduce',
        reporter_user_id: 'user-1',
        follow_up: 'An earlier follow-up',
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(row);

      const result = await service.addFollowUp('user-1', 'report-1', {
        followUp: 'New follow-up text',
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toContain('already');
      expect(prisma.feedbackReport.update).not.toHaveBeenCalled();
    });

    test('returns 400 when message is empty (whitespace only)', async () => {
      const row = makeListRow({
        status: 'cannot_reproduce',
        reporter_user_id: 'user-1',
        follow_up: null,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(row);

      const result = await service.addFollowUp('user-1', 'report-1', {
        followUp: '   ',
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toBe(FEEDBACK_REPORT_REQUIRED_MESSAGES.followUp);
      expect(prisma.feedbackReport.update).not.toHaveBeenCalled();
    });

    test('returns 400 when message exceeds the cap (2000 characters)', async () => {
      const row = makeListRow({
        status: 'cannot_reproduce',
        reporter_user_id: 'user-1',
        follow_up: null,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(row);

      const overCapMessage = 'a'.repeat(
        FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH + 1,
      );

      const result = await service.addFollowUp('user-1', 'report-1', {
        followUp: overCapMessage,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const body = result.body as any;
      expect(body.message).toBe(FEEDBACK_REPORT_CAP_MESSAGES.followUp);
      expect(prisma.feedbackReport.update).not.toHaveBeenCalled();
    });

    test('accepts message at the cap (2000 characters)', async () => {
      const row = makeListRow({
        status: 'cannot_reproduce',
        reporter_user_id: 'user-1',
        follow_up: null,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(row);
      prisma.feedbackReport.update.mockResolvedValue({
        ...row,
        follow_up: 'a'.repeat(FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH),
        status: 'under_review',
      });

      const capMessage = 'a'.repeat(FEEDBACK_REPORT_FOLLOW_UP_MAX_LENGTH);

      const result = await service.addFollowUp('user-1', 'report-1', {
        followUp: capMessage,
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(prisma.feedbackReport.update).toHaveBeenCalled();
    });

    test('trims message before storing', async () => {
      const row = makeListRow({
        status: 'cannot_reproduce',
        reporter_user_id: 'user-1',
        follow_up: null,
      });
      prisma.feedbackReport.findUnique.mockResolvedValue(row);
      prisma.feedbackReport.update.mockResolvedValue({
        ...row,
        follow_up: 'padded message',
        status: 'under_review',
      });

      const result = await service.addFollowUp('user-1', 'report-1', {
        followUp: '  padded message  ',
      });

      expect(result.ok).toBe(true);
      expect(prisma.feedbackReport.update).toHaveBeenCalledWith({
        where: { id: 'report-1' },
        data: {
          follow_up: 'padded message',
          status: 'under_review',
          status_changed_at: expect.any(Date),
        },
        select: expect.any(Object),
      });
    });
  });
});
