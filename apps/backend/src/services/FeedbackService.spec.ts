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
} from './feedbackReportConstants';
import {
  FeedbackService,
  CreateFeedbackReportInput,
  FeedbackReportDto,
} from './FeedbackService';

type MockPrisma = {
  feedbackReport: {
    count: jest.Mock<any>;
    create: jest.Mock<any>;
  };
};

function makePrisma(): MockPrisma {
  return {
    feedbackReport: {
      count: jest.fn() as jest.Mock<any>,
      create: jest.fn() as jest.Mock<any>,
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
});
