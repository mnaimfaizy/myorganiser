import { PrismaClient, createPrismaClient } from '../prisma';
import {
  FEEDBACK_REPORT_CONTEXT_FIELD_MAX_LENGTH,
  FEEDBACK_REPORT_CONTEXT_PATH_MAX_LENGTH,
  FEEDBACK_REPORT_KIND_RULES,
  FEEDBACK_REPORT_RATE_WINDOW_MS,
  FEEDBACK_REPORT_TEXT_MAX_LENGTH,
  FEEDBACK_REPORT_TITLE_MAX_LENGTH,
  FEEDBACK_REPORTS_PER_DAY_LIMIT,
  FeedbackReportKind,
  FeedbackReportStatus,
  INITIAL_FEEDBACK_REPORT_STATUS,
  isFeedbackReportKind,
} from './feedbackReportConstants';

/**
 * The Report Context as it arrives: every field is `unknown` because the
 * service, not TSOA, owns the answer for this endpoint. TSOA replies 422 for a
 * wrong type; a field over its cap is this slice's 400.
 */
export interface ReportContextInput {
  platform: unknown;
  appVersion: unknown;
  browser: unknown;
  operatingSystem: unknown;
  path: unknown;
  sentAt: unknown;
}

export interface CreateFeedbackReportInput {
  kind: unknown;
  title: unknown;
  description: unknown;
  expectedOutcome?: unknown;
  context: unknown;
  fixNoticeOptIn: unknown;
}

export interface FeedbackReportDto {
  id: string;
  kind: FeedbackReportKind;
  status: FeedbackReportStatus;
  title: string;
  createdAt: string;
}

type ServiceResult<T> =
  | { ok: true; status: 201; body: T }
  | { ok: false; status: 400 | 429; body: { message: string } };

type Refusal = { ok: false; message: string };

type Validated<T> = { ok: true; value: T } | Refusal;

interface ReportContextValues {
  platform: string;
  appVersion: string;
  browser: string;
  operatingSystem: string;
  path: string;
  sentAt: Date;
}

interface CreateFeedbackReportValues extends ReportContextValues {
  kind: FeedbackReportKind;
  title: string;
  description: string;
  expectedOutcome: string | null;
  fixNoticeOptIn: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * One required Report Context string, within its cap — the trimmed value, or
 * the refusal to answer with. `label` is the reporter's word for the field, so
 * a refusal reads as a sentence rather than as a field name.
 *
 * The result is `string | Refusal` rather than a `Validated<string>` because
 * this project does not compile with `strictNullChecks`, where a discriminant
 * test like `!result.ok` does not narrow; `typeof` always does.
 */
function readContextField(
  value: unknown,
  label: string,
  maxLength: number,
): string | Refusal {
  const text = trimString(value);
  if (!text) {
    return {
      ok: false,
      message: `The report context is missing its ${label}.`,
    };
  }
  if (text.length > maxLength) {
    return {
      ok: false,
      message: `The report context ${label} must be ${formatCount(maxLength)} characters or fewer.`,
    };
  }
  return text;
}

/**
 * Drop everything from the first `?` or `#`. The dialog already sends the path
 * alone, and a Report Context must never carry what a query string or fragment
 * holds (CONTEXT.md: Report Context) — so the server strips it again rather
 * than trusting the client to have done it.
 */
function pathWithoutQueryOrFragment(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

function validateReportContext(
  context: unknown,
): Validated<ReportContextValues> {
  if (!isPlainObject(context)) {
    return { ok: false, message: 'The report context is missing.' };
  }

  const platform = readContextField(
    context.platform,
    'platform',
    FEEDBACK_REPORT_CONTEXT_FIELD_MAX_LENGTH,
  );
  if (typeof platform !== 'string') return platform;

  const appVersion = readContextField(
    context.appVersion,
    'app version',
    FEEDBACK_REPORT_CONTEXT_FIELD_MAX_LENGTH,
  );
  if (typeof appVersion !== 'string') return appVersion;

  const browser = readContextField(
    context.browser,
    'browser',
    FEEDBACK_REPORT_CONTEXT_FIELD_MAX_LENGTH,
  );
  if (typeof browser !== 'string') return browser;

  const operatingSystem = readContextField(
    context.operatingSystem,
    'operating system',
    FEEDBACK_REPORT_CONTEXT_FIELD_MAX_LENGTH,
  );
  if (typeof operatingSystem !== 'string') return operatingSystem;

  const path = readContextField(
    context.path,
    'page path',
    FEEDBACK_REPORT_CONTEXT_PATH_MAX_LENGTH,
  );
  if (typeof path !== 'string') return path;

  const sentAtText = trimString(context.sentAt);
  const sentAt = new Date(sentAtText);
  if (!sentAtText || Number.isNaN(sentAt.getTime())) {
    return { ok: false, message: 'The report context time is not a date.' };
  }

  return {
    ok: true,
    value: {
      platform,
      appVersion,
      browser,
      operatingSystem,
      path: pathWithoutQueryOrFragment(path),
      sentAt,
    },
  };
}

function validateCreateReportInput(
  input: CreateFeedbackReportInput,
): Validated<CreateFeedbackReportValues> {
  if (!isPlainObject(input)) {
    return { ok: false, message: 'The report is missing.' };
  }

  if (!isFeedbackReportKind(input.kind)) {
    return {
      ok: false,
      message: 'Choose whether this is a bug report or a suggestion.',
    };
  }
  const kind = input.kind;

  const title = trimString(input.title);
  if (!title) {
    return { ok: false, message: 'Enter a title.' };
  }
  if (title.length > FEEDBACK_REPORT_TITLE_MAX_LENGTH) {
    return {
      ok: false,
      message: `The title must be ${formatCount(FEEDBACK_REPORT_TITLE_MAX_LENGTH)} characters or fewer.`,
    };
  }

  const description = trimString(input.description);
  if (!description) {
    return { ok: false, message: 'Enter a description.' };
  }
  if (description.length > FEEDBACK_REPORT_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      message: `The description must be ${formatCount(FEEDBACK_REPORT_TEXT_MAX_LENGTH)} characters or fewer.`,
    };
  }

  // An expected outcome belongs to a Bug Report only, and which kinds carry one
  // is the kind table's answer rather than a second `if` over the members.
  const expectedOutcomeText = trimString(input.expectedOutcome);
  let expectedOutcome: string | null = null;
  if (expectedOutcomeText) {
    if (!FEEDBACK_REPORT_KIND_RULES[kind].allowsExpectedOutcome) {
      return {
        ok: false,
        message: 'A suggestion cannot say what you expected to happen.',
      };
    }
    if (expectedOutcomeText.length > FEEDBACK_REPORT_TEXT_MAX_LENGTH) {
      return {
        ok: false,
        message: `What you expected must be ${formatCount(FEEDBACK_REPORT_TEXT_MAX_LENGTH)} characters or fewer.`,
      };
    }
    expectedOutcome = expectedOutcomeText;
  }

  if (typeof input.fixNoticeOptIn !== 'boolean') {
    return {
      ok: false,
      message: 'Choose whether to be emailed when this is fixed.',
    };
  }

  const context = validateReportContext(input.context);
  if (context.ok === false) return context;

  return {
    ok: true,
    value: {
      ...context.value,
      kind,
      title,
      description,
      expectedOutcome,
      fixNoticeOptIn: input.fixNoticeOptIn,
    },
  };
}

function toDto(row: {
  id: string;
  kind: FeedbackReportKind;
  status: FeedbackReportStatus;
  title: string;
  created_at: Date;
}): FeedbackReportDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    createdAt: row.created_at.toISOString(),
  };
}

export class FeedbackService {
  constructor(private readonly prisma: PrismaClient = createPrismaClient()) {}

  /**
   * Store a Feedback Report for `userId` with Report Status Received.
   *
   * Refuses a field over its cap with 400, and the eleventh report inside a
   * rolling 24 hours with 429.
   */
  async createReport(
    userId: string,
    input: CreateFeedbackReportInput,
  ): Promise<ServiceResult<FeedbackReportDto>> {
    const validated = validateCreateReportInput(input);
    if (validated.ok === false) {
      return { ok: false, status: 400, body: { message: validated.message } };
    }

    // The limit is counted from stored rows, not held in memory, so it survives
    // a process restart and a second backend instance. `created_at` is the
    // server's own column — `context.sentAt` comes from the client and could
    // place a report outside the window on request.
    const windowStart = new Date(Date.now() - FEEDBACK_REPORT_RATE_WINDOW_MS);
    const sentInWindow = await this.prisma.feedbackReport.count({
      where: { reporter_user_id: userId, created_at: { gte: windowStart } },
    });
    if (sentInWindow >= FEEDBACK_REPORTS_PER_DAY_LIMIT) {
      return {
        ok: false,
        status: 429,
        body: {
          message:
            'You have sent too many reports today. Please try again later.',
        },
      };
    }

    const row = await this.prisma.feedbackReport.create({
      data: {
        reporter_user_id: userId,
        kind: validated.value.kind,
        status: INITIAL_FEEDBACK_REPORT_STATUS,
        title: validated.value.title,
        description: validated.value.description,
        expected_outcome: validated.value.expectedOutcome,
        context_platform: validated.value.platform,
        context_app_version: validated.value.appVersion,
        context_browser: validated.value.browser,
        context_operating_system: validated.value.operatingSystem,
        context_path: validated.value.path,
        context_sent_at: validated.value.sentAt,
        fix_notice_opt_in: validated.value.fixNoticeOptIn,
      },
    });

    return { ok: true, status: 201, body: toDto(row) };
  }
}

const feedbackService = new FeedbackService();
export default feedbackService;
