import { jest } from '@jest/globals';

import type {
  FeedbackReportKind,
  FeedbackReportStatus,
} from '../services/feedbackReportConstants';

/**
 * MockPrisma type for AdminFeedbackService specs.
 * Includes all methods used by both changeStatus/markDelivered tests (findUnique, update)
 * and triage tests (findUnique, findMany, linkTrackingIssue, etc.).
 */
export type MockPrisma = {
  feedbackReport: {
    findUnique: jest.Mock<any>;
    findMany?: jest.Mock<any>;
    count?: jest.Mock<any>;
    update?: jest.Mock<any>;
  };
  $transaction: jest.Mock<any>;
};

/**
 * Factory to create a mock Prisma client for AdminFeedbackService testing.
 * The returned object includes all methods needed by both spec files.
 */
export function makePrisma(): MockPrisma {
  return {
    feedbackReport: {
      findUnique: jest.fn() as jest.Mock<any>,
      findMany: jest.fn() as jest.Mock<any>,
      count: jest.fn() as jest.Mock<any>,
      update: jest.fn() as jest.Mock<any>,
    },
    $transaction: jest.fn() as jest.Mock<any>,
  };
}

/**
 * Factory to create a mock feedback report detail row.
 * Returns a full row shape with all fields from AdminFeedbackService responses,
 * including the reporter relation and all context fields.
 */
export function makeDetailRow(
  overrides: Partial<Record<string, unknown>> = {},
): {
  id: string;
  kind: FeedbackReportKind;
  status: FeedbackReportStatus;
  title: string;
  description: string;
  expected_outcome: string | null;
  context_platform: string;
  context_app_version: string;
  context_browser: string;
  context_operating_system: string;
  context_path: string;
  context_sent_at: Date;
  follow_up: string | null;
  status_note: string | null;
  release_tag: string | null;
  fix_notice_opt_in: boolean;
  tracking_issue_number: number | null;
  reporter_user_id: string | null;
  status_changed_at: Date | null;
  created_at: Date;
  reporter: { id: string; name: string | null; email: string } | null;
} {
  return {
    id: 'report-1',
    kind: 'bug_report',
    status: 'received',
    title: 'Test Bug',
    description: 'Test Description',
    expected_outcome: null,
    context_platform: 'web',
    context_app_version: '1.0.0',
    context_browser: 'Chrome',
    context_operating_system: 'macOS',
    context_path: '/dashboard',
    context_sent_at: new Date('2026-01-01T00:00:00.000Z'),
    follow_up: null,
    status_note: null,
    release_tag: null,
    fix_notice_opt_in: true,
    tracking_issue_number: null,
    reporter_user_id: 'user-1',
    status_changed_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    reporter: {
      id: 'user-1',
      name: 'Test User',
      email: 'user@example.com',
    },
    ...overrides,
  };
}
