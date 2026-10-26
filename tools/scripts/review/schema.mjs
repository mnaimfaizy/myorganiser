/**
 * The finding contract for `/code-review` (ADR 0071).
 *
 * A reviewer emits a report that matches `ReportInputSchema`. The validator
 * (`validate-review-report.mjs`) turns it into a `NormalizedReport`: every
 * finding gains a derived `id`, the envelope gains a computed `verdict` and an
 * `effectiveTier`. Neither may appear in the input — a report that arrives
 * carrying its own verdict is rejected, because a verdict is computed, never
 * written.
 *
 * The exported constants are the names the House Explainer Page manifest
 * (`docs/review/finding-lifecycle.html`) asserts against through
 * `tools/scripts/check-review-pages.ts`. Rename here and that gate fails,
 * which is the point.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

import { RULES_DISPLAY_PATH, ruleById, ruleIds } from './rules.mjs';
import {
  RUN_FAILURES,
  TIGHTENING_FACTS,
  fileCoverage,
  judgeRun,
} from './run-ladder.mjs';

/**
 * Bumped to 2 when `rule` left the identity tuple (issue #718), to 3 when the
 * bounded `ruleId` replaced `source` in it (issue #724), and to 4 when an id
 * began to be carried forward from the previous report instead of re-derived
 * from a tuple coarser than a finding (issue #940). The version is what tells
 * a run whether the stored artifact from the previous run is comparable:
 * identities minted at 3 mean nothing at 4, so the renderer says there is no
 * comparable previous run instead of announcing every finding new and every
 * prior finding resolved — and the validator carries no id out of one.
 */
export const REPORT_SCHEMA_VERSION = 4;

export const REVIEW_TIER_LABELS = /** @type {const} */ ([
  'review:auto',
  'review:agent',
  'review:human',
]);
export const GATE_TIER_LABELS = /** @type {const} */ ([
  'gate:mechanical',
  'gate:standard',
  'gate:full',
]);
export const FINDING_SEVERITIES = /** @type {const} */ ([
  'blocking',
  'should-fix',
  'nit',
]);
export const FINDING_EVIDENCE_KINDS = /** @type {const} */ ([
  'executed',
  'cited',
  'inferred',
]);
export const FINDING_AXES = /** @type {const} */ (['standards', 'spec']);
export const VERDICT_VALUES = /** @type {const} */ ([
  'request-changes',
  'comment',
  'approve',
]);
/**
 * What a finding must share with a finding of the previous run to be the same
 * one. Every field is a closed vocabulary or a path the reviewer copies;
 * nothing here is prose it composes.
 *
 * `rule` is deliberately absent: it is free-form text the model rewrites every
 * run, and a single Unicode arrow degrading to ASCII minted a new identity.
 * The published record showed a persisting count of zero in 38 of 38
 * consecutive reports across four Pull Requests — no identity ever survived a
 * push, so a declined finding was announced as resolved and its thread closed
 * (issue #718).
 *
 * `source` is absent too, and `ruleId` stands where it stood (issue #724). A
 * source discriminates far too coarsely to be an identity on its own: one of
 * them, `smell-baseline`, covered all twelve Fowler smells, so two unrelated
 * smells in one file were one finding as far as the strip was concerned.
 *
 * Sharing these is necessary and, since issue #940, no longer enough: the two
 * findings' lines must overlap as well (`assignFindingIds`).
 */
export const FINDING_MATCH_FIELDS = /** @type {const} */ ([
  'axis',
  'ruleId',
  'file',
]);
/**
 * What a new finding's id is hashed from: the match fields, and the line the
 * finding starts at.
 *
 * The line is what tells two findings of one rule in one file apart, which
 * the match fields alone could not (issue #940): 15 of the 36 ids that
 * survived a push in the 2026-10-05 window were a different defect under a
 * reused id. It is hashed only when an id is minted. A finding that the
 * previous report already held keeps that report's id, so the line it was
 * first seen at stays in its id however the reviewer anchors it afterwards.
 */
export const FINDING_IDENTITY_FIELDS = /** @type {const} */ ([
  ...FINDING_MATCH_FIELDS,
  'startLine',
]);
export const CONFIDENCE_VALUES = /** @type {const} */ ([
  'high',
  'medium',
  'low',
]);
export const SPEC_KINDS = /** @type {const} */ (['issue', 'path', 'none']);
export const SPEC_FOUND_BY = /** @type {const} */ ([
  'branch',
  'commits',
  'argument',
  'user',
  'none',
]);

/**
 * The `source` a Fowler smell-baseline finding carries. The baseline is
 * always a judgement call, so the validator caps it at should-fix even when
 * the reviewer cites something (ADR 0071 item 1).
 *
 * Since issue #724 the cap is primarily the catalogue's: every `smell-*` rule
 * declares `maxSeverity`, and that is what a finding is checked against. This
 * stays because `source` is still what the reviewer writes and what the golden
 * set matches on, so a finding marked smell-baseline under some other rule id
 * is capped by the same principle rather than slipping between the two.
 */
export const SMELL_BASELINE_SOURCE = 'smell-baseline';

/** An ADR under docs/adr/, as a finding's `source` names it. */
const ACCEPTED_ADR_SOURCE = /^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/;

/**
 * Pinned display tables. Each covers every member of its enum and is asserted
 * at module load, so a new axis or verdict cannot render as `undefined`
 * (AGENTS.md, fan-out over a domain enum).
 */
export const AXIS_TITLES =
  /** @type {Record<typeof FINDING_AXES[number], string>} */ ({
    standards: 'Standards',
    spec: 'Spec',
  });
// Not exported: `verdictHeading` below is the only way this table reaches a
// caller. An exported title table invites a second spelling of the heading
// somewhere else, which is the drift the helper exists to prevent.
const VERDICT_TITLES =
  /** @type {Record<typeof VERDICT_VALUES[number], string>} */ ({
    'request-changes': 'Request changes',
    comment: 'Comment',
    approve: 'Approve',
  });
for (const [members, table, name] of [
  [FINDING_AXES, AXIS_TITLES, 'AXIS_TITLES'],
  [VERDICT_VALUES, VERDICT_TITLES, 'VERDICT_TITLES'],
]) {
  for (const m of members) {
    if (!(m in table)) throw new Error(`${name} is missing "${m}"`);
  }
}

/**
 * The heading a rendered report carries. It is a contract rather than a
 * layout choice: the escaped-defect measurement reads a merged Pull
 * Request's verdict back out of its published summary comment, so the
 * renderer that writes this line and the parser that reads it must not each
 * carry their own spelling of it (`escaped-defects.mjs`).
 */
export const verdictHeading = (verdict) =>
  `# Code review — ${VERDICT_TITLES[verdict]}`;

/** Cap on quoted issue text: enough for one requirement, not a body. */
export const SPEC_QUOTE_MAX_CHARS = 400;
/** Cap on an executed command's output excerpt carried in the report. */
export const EXECUTED_OUTPUT_MAX_CHARS = 2000;

const nonEmpty = z.string().trim().min(1);
const sha = z.string().regex(/^[0-9a-f]{7,40}$/, 'expected a git SHA');

export const LocationSchema = z.strictObject({
  file: nonEmpty,
  startLine: z.int().positive(),
  endLine: z.int().positive().optional(),
  headSha: sha,
});

const ExecutedEvidence = z.strictObject({
  kind: z.literal('executed'),
  command: nonEmpty,
  exitCode: z.int(),
  outputExcerpt: z.string().max(EXECUTED_OUTPUT_MAX_CHARS),
  cwd: nonEmpty,
});

/**
 * `sourceKind: 'standard'` quotes repo-authored text and is trusted.
 * `sourceKind: 'spec'` quotes an issue or a spec file, which is authored
 * outside the repo's review path; it is capped and must be marked untrusted.
 */
const CitedEvidence = z.strictObject({
  kind: z.literal('cited'),
  sourceKind: z.enum(['standard', 'spec']),
  quote: z.string().trim().min(1).max(SPEC_QUOTE_MAX_CHARS),
  untrusted: z.boolean(),
});

const InferredEvidence = z.strictObject({
  kind: z.literal('inferred'),
  reasoning: nonEmpty,
});

export const EvidenceSchema = z.discriminatedUnion('kind', [
  ExecutedEvidence,
  CitedEvidence,
  InferredEvidence,
]);

/**
 * `ruleId` is the identity half of a finding: one id from the bounded
 * catalogue (`tools/config/review-rules.json`, read by
 * `tools/scripts/review/rules.mjs`). `source` names where the rule
 * lives — the standard's path, the issue reference, `smell-baseline` — and
 * `rule` states the requirement in the source's own words; `summary` is the
 * human claim.
 *
 * `rule` and `summary` are display: read by people and by the golden scorer's
 * regexes, and by nothing that decides an identity, a severity, or a verdict.
 * `source` is not — it left the identity tuple in issue #724, but a `source` of
 * `smell-baseline` still caps a finding at should-fix on its own below, which is
 * why the House Explainer Page files it as read rather than shown. Calling all
 * three display is the drift that made that page badge `source` DISPLAY ONLY
 * while its own prose said it capped severity. Nothing asserts that badge: the
 * page gate compares the manifest's vocabularies, not the per-field labels, so
 * this comment and the page's own wording are the only things keeping the two
 * in step.
 *
 * Nothing here carries diff text (ADR 0071 item 3).
 */
/** Which citation source each axis may rest on (pinned; asserted below). */
export const AXIS_CITATION_SOURCE = /** @type {const} */ ({
  standards: 'standard',
  spec: 'spec',
});
for (const axis of FINDING_AXES)
  if (!AXIS_CITATION_SOURCE[axis])
    throw new Error(`AXIS_CITATION_SOURCE lacks ${axis}`);

export const FindingInputSchema = z
  .strictObject({
    axis: z.enum(FINDING_AXES),
    severity: z.enum(FINDING_SEVERITIES),
    summary: nonEmpty,
    ruleId: nonEmpty,
    source: nonEmpty,
    rule: nonEmpty,
    evidence: EvidenceSchema,
    location: LocationSchema.optional(),
    remedy: z.string().trim().min(1).optional(),
    confidence: z.enum(CONFIDENCE_VALUES).optional(),
    wouldBlock: z.boolean().optional(),
  })
  .superRefine((f, ctx) => {
    const issue = (message, path = []) =>
      ctx.addIssue({ code: 'custom', message, path });

    // The bounded rule (issue #724). An id outside the catalogue is rejected
    // rather than accepted as prose, because the identity tuple hashes it: an
    // id the reviewer invented is an id it would invent differently next run,
    // which is the instability the catalogue replaced.
    const rule = ruleById(f.ruleId);
    if (!rule) {
      issue(
        `"${f.ruleId}" is not one of the ${ruleIds().length} rule ids in ` +
          `${RULES_DISPLAY_PATH}; pick the closest, or the family's fallback ` +
          `when nothing fits`,
        ['ruleId'],
      );
    } else if (!rule.axes.includes(f.axis)) {
      issue(
        `"${f.ruleId}" is a ${rule.axes.join('/')} rule and this is a ${f.axis} finding`,
        ['ruleId'],
      );
    }
    if (rule?.maxSeverity) {
      const cap = SEVERITY_RANK[rule.maxSeverity];
      if (cap === undefined) {
        // A cap nobody can compare against would pass everything, silently.
        issue(
          `${RULES_DISPLAY_PATH}: ${f.ruleId} caps at "${rule.maxSeverity}", which is not a severity`,
          ['severity'],
        );
      } else if (SEVERITY_RANK[f.severity] < cap) {
        issue(
          `a ${rule.title} finding is a judgement call and caps at ${rule.maxSeverity}`,
          ['severity'],
        );
      }
    }
    // The cap's mirror (ADR 0131 item 2). Like the cap it rejects and never
    // adjusts: severity stays the sub-agent's call, and the catalogue bounds it.
    if (rule?.minSeverity) {
      const floor = SEVERITY_RANK[rule.minSeverity];
      if (floor === undefined) {
        issue(
          `${RULES_DISPLAY_PATH}: ${f.ruleId} floors at "${rule.minSeverity}", which is not a severity`,
          ['severity'],
        );
      } else if (SEVERITY_RANK[f.severity] > floor) {
        issue(`a "${rule.title}" finding is never below ${rule.minSeverity}`, [
          'severity',
        ]);
      }
    }

    // A Spec finding that shows the diff leaving an accepted ADR decision unmet is
    // blocking, not the reviewer's judgement call (ADR 0111). The decision was
    // already made, and the only way to change it is another ADR — not a quieter
    // severity. #912's review quoted ADR 0108 decision 1 ("an unattended unlocked
    // session must not be enough") as should-fix; the implementer replaced the
    // requirement with a two-minute window of its own, and it shipped. Only
    // findings that may block at all, by the rules below: evidenced, and anchored
    // to a diff location or a quoted spec line. A floor on a finding that cannot
    // be blocking would leave it no valid severity and reject the whole report.
    const anchoredToSpec =
      f.evidence.kind === 'cited' && f.evidence.sourceKind === 'spec';
    if (
      f.axis === 'spec' &&
      ACCEPTED_ADR_SOURCE.test(f.source) &&
      f.evidence.kind !== 'inferred' &&
      (f.location || anchoredToSpec) &&
      f.severity !== 'blocking'
    ) {
      issue(
        `a Spec finding against an accepted ADR decision (${f.source}) is blocking — the decision is made, and changing it takes another ADR (ADR 0111)`,
        ['severity'],
      );
    }

    if (f.evidence.kind === 'cited') {
      // A Standards finding cites a repo standard; a Spec finding cites the
      // spec. Crossing them lets untrusted issue text stand behind a
      // standards claim, or a repo file pose as the spec.
      const expected = AXIS_CITATION_SOURCE[f.axis];
      if (f.evidence.sourceKind !== expected) {
        issue(
          `a ${f.axis} finding cites ${expected} text, not ${f.evidence.sourceKind}`,
          ['evidence', 'sourceKind'],
        );
      }
      if (f.evidence.sourceKind === 'spec' && f.evidence.untrusted !== true) {
        issue(
          'a quoted spec line is authored outside the repo and must carry untrusted: true',
          ['evidence', 'untrusted'],
        );
      }
      if (f.evidence.sourceKind === 'standard' && f.evidence.untrusted) {
        issue('repo-authored standards text is not untrusted', [
          'evidence',
          'untrusted',
        ]);
      }
    }

    if (f.severity === 'blocking') {
      if (f.source === SMELL_BASELINE_SOURCE) {
        issue(
          'a smell-baseline finding is always a judgement call and caps at should-fix',
          ['severity'],
        );
      }
      if (f.evidence.kind === 'inferred') {
        issue(
          'blocking requires executed or cited evidence; an inferred finding caps at should-fix',
          ['severity'],
        );
      }
      if (!f.location && !anchoredToSpec) {
        issue('blocking requires a diff location or a quoted spec line', [
          'location',
        ]);
      }
    }

    if (f.wouldBlock && f.severity !== 'should-fix') {
      issue('wouldBlock is only meaningful on a should-fix finding', [
        'wouldBlock',
      ]);
    }
  });

/**
 * `also` names the further issues the change's commits close, each of which
 * the Spec axis was handed beside `ref` (ADR 0125). It is display and
 * provenance: it decides no tier, no verdict, and no finding's identity,
 * which is why adding it did not move {@link REPORT_SCHEMA_VERSION}.
 */
export const SpecSourceSchema = z
  .strictObject({
    kind: z.enum(SPEC_KINDS),
    ref: nonEmpty.optional(),
    foundBy: z.enum(SPEC_FOUND_BY),
    also: z
      .array(z.string().regex(/^#\d+$/, 'an issue reference like #123'))
      .min(1)
      .optional(),
  })
  .superRefine((s, ctx) => {
    if (s.also) {
      if (s.kind !== 'issue') {
        ctx.addIssue({
          code: 'custom',
          message: 'only an issue spec names further issues',
          path: ['also'],
        });
      }
      if (new Set([s.ref, ...s.also]).size !== s.also.length + 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'also names each further issue once, and never the ref',
          path: ['also'],
        });
      }
    }
    if (s.kind === 'none' && (s.ref || s.foundBy !== 'none')) {
      ctx.addIssue({
        code: 'custom',
        message: 'a spec of kind none has no ref and was found by nobody',
        path: ['kind'],
      });
    }
    if (s.kind !== 'none' && (!s.ref || s.foundBy === 'none')) {
      ctx.addIssue({
        code: 'custom',
        message: 'a located spec needs a ref and a foundBy',
        path: ['ref'],
      });
    }
  });

/** A run's token figures: the envelope's `cost`, and the run facts' own. */
const CostSchema = z.strictObject({
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
});

/**
 * The envelope as a reviewer writes it. `strictObject` is what rejects a
 * hand-written `verdict`, `effectiveTier`, or finding `id`.
 */
const envelopeFields = {
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  base: sha,
  head: sha,
  tier: z.enum(REVIEW_TIER_LABELS).nullable(),
  spec: SpecSourceSchema,
  standardsSources: z.array(nonEmpty),
  executed: z.array(nonEmpty),
  suppressed: z.strictObject({ redundant: z.int().nonnegative() }),
  model: nonEmpty,
  durationMs: z.int().nonnegative(),
  /**
   * Token spend, when the harness reports it. Optional because not every
   * harness exposes usage; the trust ratchet reads it where present and
   * falls back to model plus wall-clock.
   */
  cost: CostSchema.optional(),
};

export const ReportInputSchema = z.strictObject({
  ...envelopeFields,
  findings: z.array(FindingInputSchema),
});

/** Where a normalized report's facts about its own run came from. */
export const RUN_FACTS_SOURCES = /** @type {const} */ ([
  'transcript',
  'reviewer',
]);

/** Whether a transcript could be read for facts at all. */
export const RUN_FACTS_SHAPES = /** @type {const} */ (['readable', 'unknown']);

const AxisFactsSchema = z.strictObject({
  /** A dispatch was sent for this axis. */
  dispatched: z.boolean(),
  /** A sub-agent of this axis read the axis's brief file. */
  briefRead: z.boolean(),
  /** Every dispatch of this axis was the fixed template; null if none was sent. */
  onTemplate: z.boolean().nullable(),
  /**
   * Every reply of this axis was one JSON object and nothing else; null if
   * the transcript holds no reply for it. Optional, so a report normalized
   * before replies were read still parses.
   */
  replyIsJson: z.boolean().nullable().optional(),
  toolCalls: z.int().nonnegative(),
  /**
   * The files this axis's sub-agents opened and the files they diffed by
   * path (issue #1140). Optional, so a report normalized before coverage was
   * read still parses.
   */
  opened: z.array(nonEmpty).optional(),
  diffed: z.array(nonEmpty).optional(),
});

/** Both axes' facts; null when the transcript could not be read. */
const AxesFactsSchema = z
  .strictObject({ standards: AxisFactsSchema, spec: AxisFactsSchema })
  .nullable();

/**
 * The facts file `read-transcript-facts.mjs` writes from a reviewer
 * transcript (ADR 0123). When `shape` is `unknown`, everything that could not
 * be read is `null` — never an empty list, which would be a claim.
 */
export const RunFactsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    shape: z.enum(RUN_FACTS_SHAPES),
    shapeReason: nonEmpty.nullable(),
    cliVersion: nonEmpty.nullable(),
    models: z.array(nonEmpty).nullable(),
    durationMs: z.int().nonnegative().nullable(),
    /**
     * Token figures summed over the result event's `modelUsage`, or `null`
     * when it does not carry them. Optional, so a facts file written before
     * the figures were read still parses; absent reads as `null`.
     */
    cost: CostSchema.nullable().optional(),
    dispatches: z.int().nonnegative().nullable(),
    axes: AxesFactsSchema,
    standardsSources: z.array(nonEmpty).nullable(),
    indexOpened: z.boolean().nullable(),
    executed: z.array(nonEmpty).nullable(),
    /**
     * Every Bash call in the transcript, with the exit code its result
     * carries and whose call it was (issue #1039). `exitCode` is `null`
     * where the transcript carries none. Optional, so a facts file written
     * before the calls were kept still parses; absent reads as `null`, and a
     * finding's executed evidence is then not checked.
     */
    executions: z
      .array(
        z.strictObject({
          command: z.string(),
          exitCode: z.int().nullable(),
          by: z.enum(['main', 'sub-agent']),
        }),
      )
      .nullable()
      .optional(),
    /**
     * Dispatches that are neither axis's: the sub-agent read no brief and
     * the message named none. The skill has no template for one.
     */
    unattributedDispatches: z.int().nonnegative().nullable(),
    /**
     * Every sub-agent reply in the transcript could be read for the findings
     * it returned; null when the transcript holds no reply.
     */
    repliesParsed: z.boolean().nullable(),
    /**
     * The findings the sub-agents returned, as they returned them. Not held
     * to the finding contract: a reported finding is compared with these
     * field for field, and a returned finding that broke the contract is
     * still one a sub-agent returned.
     */
    returned: z.array(z.record(z.string(), z.unknown())).nullable(),
  })
  .superRefine((f, ctx) => {
    const readable = f.shape === 'readable';
    for (const key of [
      'axes',
      'standardsSources',
      'indexOpened',
      'executed',
      'unattributedDispatches',
      'returned',
    ]) {
      if (readable === (f[key] === null))
        ctx.addIssue({
          code: 'custom',
          message: readable
            ? 'a readable transcript states every fact'
            : 'an unreadable transcript states no fact it could not read',
          path: [key],
        });
    }
    if (readable === (f.shapeReason !== null))
      ctx.addIssue({
        code: 'custom',
        message: 'shapeReason is given exactly when the shape is unknown',
        path: ['shapeReason'],
      });
  });

/** What one axis did with one changed file (issue #1140). */
const FILE_COVERAGE = ['opened', 'diffed', 'neither'];

/**
 * What a normalized report keeps of the facts file, beside the envelope
 * fields the facts overwrite.
 */
const RunFactsSummarySchema = z.strictObject({
  shape: z.enum(RUN_FACTS_SHAPES),
  shapeReason: nonEmpty.nullable(),
  cliVersion: nonEmpty.nullable(),
  dispatches: z.int().nonnegative().nullable(),
  axes: AxesFactsSchema,
  indexOpened: z.boolean().nullable(),
  /**
   * What the run facts cost (run-ladder.mjs). Optional, so a report
   * normalized before the facts were enforced still parses as a previous
   * report.
   */
  repliesParsed: z.boolean().nullable().optional(),
  unattributedDispatches: z.int().nonnegative().nullable().optional(),
  failures: z
    .array(
      z.strictObject({
        reason: z.enum(RUN_FAILURES),
        axis: z.enum(FINDING_AXES).nullable(),
        detail: nonEmpty,
      }),
    )
    .optional(),
  tightenedBy: z.array(z.enum(TIGHTENING_FACTS)).optional(),
  /**
   * Each changed file the selector listed, and whether each axis opened it,
   * diffed it, or neither (issue #1140). Null with no changed-file list;
   * optional, so an earlier normalized report still parses.
   */
  coverage: z
    .array(
      z.strictObject({
        file: nonEmpty,
        added: z.int().nonnegative(),
        standards: z.enum(FILE_COVERAGE),
        spec: z.enum(FILE_COVERAGE),
      }),
    )
    .nullable()
    .optional(),
});

/**
 * What the validator writes and the only thing the renderer accepts: the
 * input plus derived ids, the computed verdict, and the effective tier.
 *
 * `standardsSources`, `executed`, `durationMs`, `model`, and `cost` are facts
 * about the run, and in CI they are read from the reviewer transcript and
 * overwrite whatever the reviewer wrote (ADR 0123). `runFactsFrom` says which
 * a report carries. Every one but `model` may be `null` here and never in the
 * input: `null` is "the transcript did not say", which is neither an empty
 * list, nor zero, nor the reviewer's own claim.
 *
 * `runFactsFrom` and `runFacts` are optional so that a report normalized
 * before they existed still parses as a previous report and still lends its
 * ids. Finding identity did not change, so the schema version did not.
 */
export const NormalizedReportSchema = z.strictObject({
  ...envelopeFields,
  standardsSources: z.array(nonEmpty).nullable(),
  executed: z.array(nonEmpty).nullable(),
  durationMs: z.int().nonnegative().nullable(),
  /**
   * `null` is a transcript that did not carry the figures. Absent is a
   * report with no transcript whose reviewer reported none.
   */
  cost: CostSchema.nullable().optional(),
  runFactsFrom: z.enum(RUN_FACTS_SOURCES).optional(),
  runFacts: RunFactsSummarySchema.nullable().optional(),
  findings: z.array(
    z
      .object({ id: z.string().regex(/^[0-9a-f]{12}$/) })
      .and(FindingInputSchema),
  ),
  verdict: z.enum(VERDICT_VALUES),
  effectiveTier: z.enum(REVIEW_TIER_LABELS).nullable(),
});

const SEVERITY_RANK = Object.fromEntries(
  FINDING_SEVERITIES.map((s, i) => [s, i]),
);

/** Sort key: blocking first, then should-fix, then nit. Stable within a rank. */
export const bySeverity = (a, b) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];

/**
 * One accessor per identity field (ADR 0071 item 6, amended by issue #718,
 * issue #724, and issue #940). An unlocated finding has neither a file nor a
 * line, and hashes the empty string for both.
 */
const IDENTITY_ACCESSORS =
  /** @type {Record<typeof FINDING_IDENTITY_FIELDS[number], (f: object) => string | number>} */ ({
    axis: (f) => f.axis,
    ruleId: (f) => f.ruleId,
    file: (f) => f.location?.file ?? '',
    startLine: (f) => f.location?.startLine ?? '',
  });

/**
 * The id a finding is given when no earlier report lends it one.
 *
 * `occurrence` is 0 unless the id is already taken in this report, and counts
 * up until it is not. Since issue #940 that is rare: two findings of one rule
 * starting at one line, several unlocated findings of one kind, or a finding
 * minted at the line a finding of the previous report was first seen at —
 * whether that one has drifted away under its carried id or has gone.
 */
export const findingId = (finding, occurrence = 0) => {
  const tuple = FINDING_IDENTITY_FIELDS.map((field) =>
    IDENTITY_ACCESSORS[field](finding),
  );
  if (occurrence > 0) tuple.push(occurrence);
  return createHash('sha256')
    .update(JSON.stringify(tuple))
    .digest('hex')
    .slice(0, 12);
};

const matchKey = (finding) =>
  JSON.stringify(
    FINDING_MATCH_FIELDS.map((field) => IDENTITY_ACCESSORS[field](finding)),
  );

/** The lines a finding covers, or null when it names none. */
const linesOf = ({ location }) => {
  if (!location) return null;
  const end = location.endLine ?? location.startLine;
  return [Math.min(location.startLine, end), Math.max(location.startLine, end)];
};

/**
 * Which earlier finding each of this report's findings is, if any.
 *
 * Two findings are the same one when they share the match fields and their
 * lines overlap. Each earlier id is lent once, to the claimant sharing the
 * most lines with it, then to the one starting nearest. Unlocated findings
 * have no lines to compare, so they pair off by the match fields alone, in
 * report order — the residue issue #940 leaves, as it was before.
 *
 * The two ranges are line numbers in two different commits, and nothing here
 * maps one onto the other. A push that moves a defect clear of the lines it
 * was reported at therefore reads as that finding gone and a new one raised.
 * That is the cheap direction to be wrong in — a repost of feedback still on
 * the report, not feedback lost — and across the 2026-10-05 window raw
 * overlap recognised 17 of the 19 located findings that genuinely persisted.
 *
 * @returns {Map<number, string>} index in `findings` → the id it inherits
 */
const carriedIds = (findings, earlier) => {
  const claims = [];
  const unlocated = new Map();
  earlier.forEach((before, e) => {
    if (!linesOf(before)) {
      const key = matchKey(before);
      unlocated.set(key, [...(unlocated.get(key) ?? []), e]);
    }
  });
  findings.forEach((now, n) => {
    const lines = linesOf(now);
    if (!lines) {
      const e = unlocated.get(matchKey(now))?.shift();
      if (e !== undefined) claims.push({ n, e, shared: Infinity, apart: 0 });
      return;
    }
    earlier.forEach((before, e) => {
      const was = linesOf(before);
      if (!was || matchKey(before) !== matchKey(now)) return;
      const shared =
        Math.min(lines[1], was[1]) - Math.max(lines[0], was[0]) + 1;
      if (shared > 0)
        claims.push({ n, e, shared, apart: Math.abs(lines[0] - was[0]) });
    });
  });
  claims.sort(
    (a, b) =>
      b.shared - a.shared || a.apart - b.apart || a.e - b.e || a.n - b.n,
  );
  const carried = new Map();
  const lent = new Set();
  for (const { n, e } of claims) {
    if (carried.has(n) || lent.has(e)) continue;
    carried.set(n, earlier[e].id);
    lent.add(e);
  }
  return carried;
};

/**
 * A finding the previous report already held keeps that report's id; every
 * other finding is minted one. The reviewer still never sees its last report
 * (ADR 0071 item 6) — this is the validator reading it, after the reviewer
 * has exited.
 *
 * @param {object[]} findings this run's findings, as the reviewer wrote them
 * @param {unknown} previous the previous run's normalized report, or null
 */
const assignFindingIds = (findings, previous) => {
  // One entry per earlier id: an id two earlier findings share could be lent
  // twice, and this report's ids must be unique whatever the last one held.
  const seen = new Set();
  const earlier = (
    isComparableReport(previous) && Array.isArray(previous.findings)
      ? previous.findings
      : []
  ).filter(
    (f) => typeof f?.id === 'string' && !seen.has(f.id) && seen.add(f.id),
  );
  const carried = carriedIds(findings, earlier);
  // Every earlier id is taken, lent or not. An id nobody inherited belongs to
  // a finding that is gone, and minting it again for a new finding at the
  // line that one was first seen at would read as the old one persisting.
  const taken = new Set(earlier.map((f) => f.id));
  const ids = new Array(findings.length);
  findings
    .map((f, index) => ({ f, index }))
    // Line order, so which of two same-tuple findings gets the plain id does
    // not depend on the order the reviewer happened to list them in.
    .sort(
      (a, b) =>
        (a.f.location?.startLine ?? 0) - (b.f.location?.startLine ?? 0) ||
        a.index - b.index,
    )
    .forEach(({ f, index }) => {
      let id = carried.get(index);
      for (let occurrence = 0; id === undefined; occurrence += 1) {
        const minted = findingId(f, occurrence);
        if (!taken.has(minted)) id = minted;
      }
      taken.add(id);
      ids[index] = id;
    });
  return findings.map((f, index) => ({ id: ids[index], ...f }));
};

/**
 * Whether a stored artifact from an earlier run can be diffed against this
 * one, or lend it ids. Ids are only meaningful within a schema version — a
 * report written before ids were carried forward holds identities this run
 * would never give the same findings — so a mismatch is "no comparable
 * previous run", not "everything resolved".
 *
 * @param {unknown} raw a report read back from an artifact, of any vintage
 */
export const isComparableReport = (raw) =>
  reportSchemaVersionOf(raw) === REPORT_SCHEMA_VERSION;

/** The version a stored artifact claims, for the message when it is not ours. */
export function reportSchemaVersionOf(raw) {
  return typeof raw === 'object' && raw !== null
    ? raw.schemaVersion
    : undefined;
}

/** Any blocking → request-changes; only nits (or nothing) → approve; else comment. */
export const computeVerdict = (findings) => {
  if (findings.some((f) => f.severity === 'blocking')) return 'request-changes';
  if (findings.every((f) => f.severity === 'nit')) return 'approve';
  return 'comment';
};

/**
 * The effective tier is the pinned tier moved toward a human by up to two
 * steps: one when the report has no spec source, and one when any tightening
 * fact holds about the run (ADR 0123 item 5). However many tightening facts
 * hold, they cost the one step together. A run that fails
 * `Agent Review Ran` goes all the way: a review that did not run as built
 * vouches for nothing, which is what the strictest label means (ADR 0070
 * item 5). Interactive runs (tier null) stay null: there is no label to
 * tighten.
 *
 * @param {object} report the report input
 * @param {{ tightened?: boolean, failed?: boolean }} [run] whether a
 *   tightening fact holds, and whether a run failure does
 */
export const computeEffectiveTier = (
  report,
  { tightened = false, failed = false } = {},
) => {
  if (report.tier === null) return null;
  if (failed) return REVIEW_TIER_LABELS[REVIEW_TIER_LABELS.length - 1];
  const steps = (report.spec.kind === 'none' ? 1 : 0) + (tightened ? 1 : 0);
  // Reaches the one declared list rather than re-enumerating the members
  // (AGENTS.md, ADR 0053). That makes this depend on REVIEW_TIER_LABELS
  // being ordered loosest to strictest, which is what "tighten by one" means
  // — reorder that constant and this tightens in the wrong direction.
  const current = REVIEW_TIER_LABELS.indexOf(report.tier);
  return REVIEW_TIER_LABELS[
    Math.min(current + steps, REVIEW_TIER_LABELS.length - 1)
  ];
};

/**
 * Validate a raw object and return the normalized report, or throw a ZodError.
 * This is the only path from reviewer output to anything that reads it.
 *
 * `previous` is the previous run's normalized report, when there is one. It
 * lends ids and nothing else: no finding, severity, or verdict is read from
 * it, and a report of another schema version lends none.
 *
 * `facts` is the run facts file read from the reviewer transcript, when
 * there is one. It overwrites the envelope fields that are facts about the
 * run, and it is judged against the report (run-ladder.mjs): what fails
 * `Agent Review Ran` is recorded under `runFacts.failures`, and what tightens
 * the tier under `runFacts.tightenedBy` and in `effectiveTier`. No finding,
 * severity, or verdict is read from it. Without it the report keeps what the
 * reviewer wrote, says so, and nothing is judged.
 *
 * A failure does not reject the report. The report met its contract, and
 * its findings are still worth publishing; whoever runs the validator reads
 * `runFacts.failures` and fails the check.
 *
 * `worklist` is the obligation worklist, when one was selected. It is read
 * for one thing: which findings the main agent was meant to write itself.
 *
 * @param {unknown} raw
 * @param {{ previous?: unknown, facts?: unknown, worklist?: unknown }} [options]
 */
export const normalizeReport = (
  raw,
  { previous = null, facts = null, worklist = null } = {},
) => {
  const input = ReportInputSchema.parse(raw);
  const findings = assignFindingIds(input.findings, previous);
  const run = runFactsFor(input, facts, worklist);
  return {
    ...input,
    ...run,
    findings,
    verdict: computeVerdict(findings),
    effectiveTier: computeEffectiveTier(input, {
      tightened: (run.runFacts?.tightenedBy ?? []).length > 0,
      failed: (run.runFacts?.failures ?? []).length > 0,
    }),
  };
};

/** The model a report names when the transcript did not say which ran. */
export const UNKNOWN_MODEL = 'unknown';

/**
 * The run-fact fields of a normalized report.
 *
 * A transcript that reads cleanly and shows no dispatch at all, under a
 * report that has findings or names a standards source, is treated as
 * unreadable: those have to have come from somewhere, and the likelier
 * explanation is a dispatch this reader no longer recognises than a reviewer
 * that dispatched nothing. Read the other way, a CLI release that renamed
 * the dispatch tool would publish "none opened" on every pull request. An
 * obligation finding is the main agent's own and proves no dispatch, so it
 * does not count.
 */
const runFactsFor = (input, rawFacts, worklist) => {
  if (rawFacts === null || rawFacts === undefined)
    return { runFactsFrom: 'reviewer', runFacts: null };
  const facts = RunFactsSchema.parse(rawFacts);
  const returned = input.findings.filter(
    (f) => !f.ruleId.startsWith('obligation-'),
  );
  // What the reviewer wrote under `standardsSources` is not believed, but a
  // reviewer that names one is saying a Standards sub-agent ran.
  const claimsARun = returned.length > 0 || input.standardsSources.length > 0;
  const unseen =
    facts.shape === 'readable' && facts.dispatches === 0 && claimsARun;
  const readable = facts.shape === 'readable' && !unseen;
  const { failures, tightenedBy } = judgeRun({
    facts,
    readable,
    findings: input.findings,
    specKind: input.spec.kind,
    worklist,
  });
  return {
    standardsSources: readable ? facts.standardsSources : null,
    executed: readable ? facts.executed : null,
    durationMs: facts.durationMs,
    cost: facts.cost ?? null,
    model: facts.models?.length ? facts.models.join(', ') : UNKNOWN_MODEL,
    runFactsFrom: 'transcript',
    runFacts: {
      shape: readable ? 'readable' : 'unknown',
      shapeReason: unseen
        ? `the report has ${returned.length} finding(s) and names ${input.standardsSources.length} standards source(s), and the transcript shows no sub-agent dispatch`
        : facts.shapeReason,
      cliVersion: facts.cliVersion,
      dispatches: readable ? facts.dispatches : null,
      axes: readable ? facts.axes : null,
      indexOpened: readable ? facts.indexOpened : null,
      repliesParsed: readable ? facts.repliesParsed : null,
      unattributedDispatches: readable ? facts.unattributedDispatches : null,
      coverage: readable ? fileCoverage(facts, worklist) : null,
      failures,
      tightenedBy,
    },
  };
};

/** Render Zod issues as one line each, path first, for terminal and CI logs. */
export const formatIssues = (error) =>
  error.issues.map((i) => {
    const path = i.path.length ? i.path.join('.') : '(root)';
    return `${path}: ${i.message}`;
  });
