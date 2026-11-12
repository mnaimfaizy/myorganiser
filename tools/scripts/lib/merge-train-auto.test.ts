// Contract Suite for the Auto-merge (ADR 0148): the setting, each fact's
// reader, the held reasons, the shadow comment, and one `--auto` pass over a
// fake GitHub. The hand-started train is in merge-train.test.ts.
//
// Run with: node --test tools/scripts/lib/merge-train-auto.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ReviewComment } from '../review/escaped-defects.ts';
import {
  SUMMARY_AUTHOR_LOGIN,
  SUMMARY_MARKER,
  summaryBody,
} from '../review/publish.ts';
import type { Verdict } from '../review/schema.ts';
import { VERDICT_VALUES, verdictHeading } from '../review/schema.ts';

import {
  AGENT_VERDICT_HOLDS,
  AGENT_VERDICT_UNREADABLE,
  AUTO_MERGE_MODE_PATH,
  AUTO_MERGE_MODE_PASS,
  AUTO_MERGE_MODES,
  AUTO_MERGE_OFF_REASON,
  AUTO_MERGE_RULES,
  DOOR_UNREADABLE_REASON,
  SHADOW_COMMENT_LEAD,
  SHADOW_COMMENT_MARKER,
  SHADOW_HELD,
  SHADOW_WOULD_MERGE,
  UNREAD_AGENT_VERDICT,
  UNREAD_QA_REPORT,
  UNREAD_REVIEW_TIER,
  agentVerdictFrom,
  agentVerdictFromView,
  autoMergeHolds,
  changedFilesFromGh,
  checksOnCurrentHead,
  decideAutoMerge,
  mainCiFromRuns,
  onMainFromCompare,
  parseAutoMergeMode,
  pathGuardFrom,
  prCommitsFromGh,
  qaReportFromView,
  readPathMapFromGit,
  readDoor,
  renderAutoTrainResult,
  renderShadowComment,
  reviewTierFromView,
  runAutoTrain,
  type AgentVerdictFact,
  type AutoMergeDecision,
  type AutoMergeFacts,
  type AutoMergeMode,
  type AutoTrainIo,
  type AutoTrainResult,
  type CheckRun,
  type ChangedFile,
  type MainCiFact,
  type MergeMethod,
  type GitResult,
  type MissingFact,
  type PathGuardFact,
  type PullRequestSnapshot,
  type QaReportFact,
  type ReviewTier,
  type ReviewTierFact,
} from './merge-train.ts';
import { type PrCommit, QA_REPORT_MARKER } from './qa-report.ts';
import {
  loadPathMap,
  REVIEW_TIER_PATHS_CONFIG,
  type ReviewTierPathMap,
} from './review-tier.ts';
import {
  renderReviewTierRecord,
  REVIEW_TIER_RECORD_MARKER,
} from './review-tier-record.ts';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
/** The committed path map, read as `main` would have it (the fake's default). */
const REAL_PATH_MAP = loadPathMap(join(REPO_ROOT, REVIEW_TIER_PATHS_CONFIG));
const PR_AUTHOR_TEMPLATE = '.github/agents/pr-author.agent.md';
const DOOR_PLACEHOLDER =
  '<one-way or two-way> — <for one-way: the part a revert does not undo>';

const REQUIRED = ['Lint', 'Test'];
const HEAD = 'a'.repeat(40);
const MAIN_HEAD = 'm'.repeat(40);

const green: CheckRun[] = [
  { name: 'Lint', bucket: 'pass' },
  { name: 'Test', bucket: 'pass' },
];

const snapshot = (
  overrides: Partial<PullRequestSnapshot> = {},
): PullRequestSnapshot => ({
  number: 7,
  state: 'OPEN',
  isDraft: false,
  baseRefName: 'main',
  headRefOid: HEAD,
  mergeStateStatus: 'CLEAN',
  reviewDecision: '',
  checks: green,
  ...overrides,
});

// ------------------------------------------------------------- fixtures

/** The reason a fact that has no reader yet holds the merge with. */
function missingReason(fact: MissingFact | { status: 'read' }): string {
  return fact.status === 'missing'
    ? fact.reason
    : assert.fail('expected a fact with no reader yet');
}

const NOT_READ = {
  reviewTier: missingReason(UNREAD_REVIEW_TIER),
  agentVerdict: missingReason(UNREAD_AGENT_VERDICT),
  qaReport: missingReason(UNREAD_QA_REPORT),
};
const ALL_NOT_READ = [
  NOT_READ.reviewTier,
  NOT_READ.agentVerdict,
  NOT_READ.qaReport,
].join('; ');

const MAIN_GREEN: MainCiFact = {
  status: 'read',
  conclusion: 'success',
  headSha: MAIN_HEAD,
};
const MAIN_RED: MainCiFact = {
  status: 'read',
  conclusion: 'failure',
  headSha: 'f'.repeat(40),
};

/**
 * Every fact for one head, all clear except the three that have no reader
 * yet. No fact set in this slice can be fully clear: `agentVerdict` and
 * `qaReport` always hold.
 */
const facts = (overrides: Partial<AutoMergeFacts> = {}): AutoMergeFacts => ({
  headRefOid: HEAD,
  mainCi: MAIN_GREEN,
  requiredChecks: { status: 'green' },
  reviewTier: UNREAD_REVIEW_TIER,
  pathGuard: { status: 'clear' },
  agentVerdict: UNREAD_AGENT_VERDICT,
  qaReport: UNREAD_QA_REPORT,
  door: { status: 'absent' },
  ...overrides,
});

/** The section of PrAuthor's template from `## Merge danger` to the next heading. */
function templateMergeDanger(): string {
  const lines = readFileSync(join(REPO_ROOT, PR_AUTHOR_TEMPLATE), 'utf8').split(
    '\n',
  );
  const start = lines.findIndex((line) => line.trim() === '## Merge danger');
  assert.notEqual(start, -1, 'the template has a ## Merge danger section');
  const section: string[] = [];
  for (const line of lines.slice(start)) {
    if (section.length > 0 && /^##\s/.test(line)) break;
    section.push(line);
  }
  return section.join('\n');
}

/** The decision line of a shadow comment, without its lead: its short form. */
const decisionLine = (body: string): string =>
  body.split('\n')[1].slice(SHADOW_COMMENT_LEAD.length + 1);

/**
 * A fake GitHub for one `--auto` pass. Each Pull Request plays back a script
 * of snapshots, one per read; the last one repeats, and a `null` entry reads
 * as unreadable. Every write is recorded as a string; a comment write records
 * its decision line. The full body is kept once per Pull Request, and
 * `created` lists the Pull Requests whose comment was first posted, so a later
 * write that replaces the body is not in it.
 */
interface AutoFakeOptions {
  required?: string[];
  clockStep?: number;
  mainCi?: MainCiFact;
  /** When set, the Review Tier reads as this tier; otherwise it is unread. */
  tier?: ReviewTier;
  commentRefusals?: Set<number>;
  /** When set, the Agent Verdict reads as this; otherwise it is unread. */
  agentVerdict?: (pr: number, headRefOid: string) => AgentVerdictFact;
  /** When set, the Review Tier reads as this, and `tier` is ignored. */
  reviewTierFact?: (pr: number, headRefOid: string) => ReviewTierFact;
  /** The changed files of a Pull Request; none (clear) by default. */
  changedFiles?: (pr: number) => ChangedFile[] | null;
  /** `main`'s path map; the committed one by default. */
  pathMap?: ReviewTierPathMap | null;
  /** The QA Report for a head; unread (missing) by default. */
  qaReportFact?: (pr: number, headRefOid: string) => QaReportFact;
}

const fakeAutoIo = (
  scripts: Record<number, (PullRequestSnapshot | null)[]>,
  {
    required = REQUIRED,
    clockStep = 30_000,
    mainCi = MAIN_GREEN,
    tier,
    commentRefusals = new Set<number>(),
    agentVerdict = () => UNREAD_AGENT_VERDICT,
    reviewTierFact,
    changedFiles = () => [],
    pathMap = REAL_PATH_MAP,
    qaReportFact = () => UNREAD_QA_REPORT,
  }: AutoFakeOptions = {},
) => {
  const reads = new Map<number, number>();
  const writes: string[] = [];
  const log: string[] = [];
  const comments = new Map<number, string>();
  const created: number[] = [];
  const counts = { read: 0, mainCi: 0, mainPathMap: 0 };
  const changedFilesAsked: number[] = [];
  let clock = 0;

  const io: AutoTrainIo = {
    requiredChecks: () => required,
    read: (pr) => {
      counts.read += 1;
      const script = scripts[pr];
      if (!script) return null;
      const index = reads.get(pr) ?? 0;
      reads.set(pr, index + 1);
      return script[Math.min(index, script.length - 1)];
    },
    update: (pr, sha) => {
      writes.push(`update #${pr} @${sha.slice(0, 1)}`);
      return true;
    },
    merge: (pr, sha, method: MergeMethod) => {
      writes.push(`merge #${pr} @${sha.slice(0, 1)} ${method}`);
      return true;
    },
    sleep: async () => {
      clock += clockStep;
    },
    now: () => clock,
    log: (line) => log.push(line),
    mainCi: () => {
      counts.mainCi += 1;
      return mainCi;
    },
    reviewTier: (pr, headRefOid) => {
      if (reviewTierFact) return reviewTierFact(pr, headRefOid);
      return tier ? { status: 'read', tier } : UNREAD_REVIEW_TIER;
    },
    changedFiles: (pr) => {
      changedFilesAsked.push(pr);
      return changedFiles(pr);
    },
    mainPathMap: () => {
      counts.mainPathMap += 1;
      return pathMap;
    },
    agentVerdict,
    qaReport: (pr, headRefOid) => qaReportFact(pr, headRefOid),
    upsertShadowComment: (pr, body) => {
      writes.push(`comment #${pr} ${decisionLine(body)}`);
      if (commentRefusals.has(pr)) return false;
      if (!comments.has(pr)) created.push(pr);
      comments.set(pr, body);
      return true;
    },
  };

  return {
    io,
    writes,
    log,
    comments,
    created,
    counts,
    changedFilesAsked,
    readsOf: (pr: number) => reads.get(pr) ?? 0,
  };
};

const autoArgs = (
  mode: AutoMergeMode,
  pullRequests: number[],
  overrides: { dryRun?: boolean; timeoutMinutes?: number } = {},
) => ({
  mode,
  pullRequests,
  method: 'merge' as const,
  pollSeconds: 30,
  timeoutMinutes: 45,
  dryRun: false,
  ...overrides,
});

// ------------------------------------------------------------ A: the mode

describe('parseAutoMergeMode', () => {
  test('a missing setting file is off', () => {
    assert.equal(parseAutoMergeMode(null), 'off');
  });

  for (const [name, text] of [
    ['invalid JSON', '{"mode": shadow'],
    ['an unknown mode', '{"mode":"bogus"}'],
    ['no mode key', '{}'],
    ['an array', '[]'],
    ['a bare string', '"shadow"'],
    ['null', 'null'],
  ] as const) {
    test(`${name} reads as off`, () => {
      assert.equal(parseAutoMergeMode(text), 'off');
    });
  }

  for (const mode of ['off', 'shadow', 'on'] as const) {
    test(`{"mode":"${mode}"} reads as ${mode}`, () => {
      assert.equal(parseAutoMergeMode(`{"mode":"${mode}"}`), mode);
    });
  }

  test('the shipped setting file holds a valid mode, so a typo cannot read off silently', () => {
    const text = readFileSync(join(REPO_ROOT, AUTO_MERGE_MODE_PATH), 'utf8');
    const { mode } = JSON.parse(text) as { mode?: unknown };
    assert.ok(
      (AUTO_MERGE_MODES as readonly unknown[]).includes(mode),
      `the shipped mode is ${String(mode)}`,
    );
    assert.equal(parseAutoMergeMode(text), mode);
  });
});

describe('AUTO_MERGE_MODE_PASS', () => {
  test('has exactly one row for every mode', () => {
    assert.deepEqual(
      Object.keys(AUTO_MERGE_MODE_PASS).sort(),
      [...AUTO_MERGE_MODES].sort(),
    );
  });
});

// ------------------------------------------------------- B: the Door line

describe('readDoor', () => {
  test('a filled-in one-way line reads one-way', () => {
    const body = templateMergeDanger().replace(
      DOOR_PLACEHOLDER,
      'one-way — the migration drops a column',
    );
    assert.deepEqual(readDoor(body), { status: 'one-way' });
  });

  test('a bare two-way line reads two-way', () => {
    const body = templateMergeDanger().replace(DOOR_PLACEHOLDER, 'two-way');
    assert.deepEqual(readDoor(body), { status: 'two-way' });
  });

  test('a two-way line with a reason reads two-way', () => {
    const body = templateMergeDanger().replace(DOOR_PLACEHOLDER, 'two-way — x');
    assert.deepEqual(readDoor(body), { status: 'two-way' });
  });

  test('the unfilled template line is unreadable, not a guess', () => {
    const doorLine = templateMergeDanger()
      .split('\n')
      .find((line) => line.trim().startsWith('**Door:**'));
    assert.ok(doorLine?.includes(DOOR_PLACEHOLDER), 'template Door line found');
    assert.deepEqual(readDoor(templateMergeDanger()), {
      status: 'unreadable',
      line: doorLine?.trim() ?? '',
    });
  });

  for (const line of [
    '**Door:** one way',
    '**Door:** `one-way`',
    '**Door:** maybe',
    '- **Door:** one-way — x',
    '**Door**: one-way — x',
    '**door:** one-way — x',
    'Door: one-way',
    '- Door: one-way',
    '__Door__: two-way',
  ]) {
    test(`malformed "${line}" is unreadable`, () => {
      assert.deepEqual(readDoor(`## Merge danger\n${line}\n`), {
        status: 'unreadable',
        line,
      });
    });
  }

  test('no Merge danger section is absent', () => {
    assert.deepEqual(readDoor('## Changes\n**Door:** one-way — x'), {
      status: 'absent',
    });
  });

  test('a Merge danger section with no Door line is absent', () => {
    assert.deepEqual(readDoor('## Merge danger\n**Blast radius:** low'), {
      status: 'absent',
    });
  });

  test('a Door line under a later heading is not the Merge danger Door', () => {
    const body = [
      '## Merge danger',
      '**Blast radius:** low',
      '## Test plan',
      '**Door:** one-way — x',
    ].join('\n');
    assert.deepEqual(readDoor(body), { status: 'absent' });
  });

  test('prose under Merge danger that starts with "Door" is not a Door field', () => {
    assert.deepEqual(readDoor('## Merge danger\nDoors open both ways here.'), {
      status: 'absent',
    });
  });

  test('a Blast radius line that mentions the word door is not a Door line', () => {
    assert.deepEqual(
      readDoor('## Merge danger\n**Blast radius:** low — door'),
      { status: 'absent' },
    );
  });

  test('a CRLF description reads its Door like an LF one', () => {
    assert.deepEqual(readDoor('## Merge danger\r\n**Door:** one-way — x\r\n'), {
      status: 'one-way',
    });
  });

  test('a null or undefined description is absent', () => {
    assert.deepEqual(readDoor(null), { status: 'absent' });
    assert.deepEqual(readDoor(undefined), { status: 'absent' });
  });
});

// --------------------------------------------------------- C: main's CI

describe('mainCiFromRuns', () => {
  test('the latest run reads its conclusion and head', () => {
    assert.deepEqual(
      mainCiFromRuns([{ conclusion: 'success', headSha: HEAD }]),
      { status: 'read', conclusion: 'success', headSha: HEAD },
    );
  });

  test('a failed latest run reads as failure, not as missing', () => {
    assert.deepEqual(
      mainCiFromRuns([{ conclusion: 'failure', headSha: HEAD }]),
      { status: 'read', conclusion: 'failure', headSha: HEAD },
    );
  });

  for (const [name, runs] of [
    ['no runs', []],
    ['no payload', null],
    ['an empty conclusion', [{ conclusion: '' }]],
    [
      'an empty conclusion on a known head',
      [{ conclusion: '', headSha: HEAD }],
    ],
    ['no conclusion', [{ headSha: HEAD }]],
    ['a success with no head', [{ conclusion: 'success' }]],
  ] as const) {
    test(`${name} is missing, with a reason that names main`, () => {
      const fact = mainCiFromRuns(runs);
      assert.equal(fact.status, 'missing');
      assert.match(
        fact.status === 'missing' ? fact.reason : '',
        /on `main` could not be read/,
      );
    });
  }
});

// ------------------------------------------------------ D: the decision

describe('decideAutoMerge', () => {
  test('off skips the candidate, whatever the facts', () => {
    const decision = decideAutoMerge(
      facts({
        reviewTier: { status: 'read', tier: 'human' },
        requiredChecks: { status: 'held', reason: 'x' },
      }),
      'off',
    );
    assert.equal(decision.action, 'skip');
    assert.equal(decision.held, true);
    assert.equal(decision.reason, AUTO_MERGE_OFF_REASON);
  });

  test('shadow comments on the candidate and holds it', () => {
    const decision = decideAutoMerge(facts(), 'shadow');
    assert.equal(decision.action, 'shadow-comment');
    assert.equal(decision.held, true);
  });

  test('on skips a held candidate and never merges it', () => {
    const decision = decideAutoMerge(facts(), 'on');
    assert.equal(decision.action, 'skip');
    assert.equal(decision.held, true);
  });

  test('each fact still missing holds with its named reason', () => {
    const decision = decideAutoMerge(facts(), 'on');
    for (const reason of Object.values(NOT_READ)) {
      assert.ok(decision.reason.includes(reason), reason);
    }
  });

  test('a red main holds with the failure and the first 8 characters of its head', () => {
    const decision = decideAutoMerge(facts({ mainCi: MAIN_RED }), 'shadow');
    assert.ok(
      decision.reason.includes(
        'the latest CI run on `main` is failure (ffffffff)',
      ),
      decision.reason,
    );
  });

  test('an unreadable main holds with its own reason', () => {
    const decision = decideAutoMerge(
      facts({
        mainCi: {
          status: 'missing',
          reason: 'the latest CI run on `main` could not be read',
        },
      }),
      'shadow',
    );
    assert.ok(
      decision.reason.includes('the latest CI run on `main` could not be read'),
      decision.reason,
    );
  });

  test('a green main adds no main reason', () => {
    const decision = decideAutoMerge(facts(), 'shadow');
    assert.doesNotMatch(decision.reason, /CI run on `main`/);
  });

  test('a one-way Door holds with its reason', () => {
    const decision = decideAutoMerge(
      facts({ door: { status: 'one-way' } }),
      'shadow',
    );
    assert.ok(
      decision.reason.includes('the Merge Danger Door is one-way'),
      decision.reason,
    );
  });

  test('an unreadable Door holds with the unreadable reason', () => {
    const decision = decideAutoMerge(
      facts({ door: { status: 'unreadable', line: '**Door:** maybe' } }),
      'shadow',
    );
    assert.ok(decision.reason.includes(DOOR_UNREADABLE_REASON));
  });

  for (const door of [{ status: 'two-way' }, { status: 'absent' }] as const) {
    test(`${door.status} Door adds no Door reason`, () => {
      const decision = decideAutoMerge(facts({ door }), 'shadow');
      assert.doesNotMatch(decision.reason, /Merge Danger Door|Door line/);
    });
  }

  test('a human Review Tier holds with its reason', () => {
    const decision = decideAutoMerge(
      facts({ reviewTier: { status: 'read', tier: 'human' } }),
      'shadow',
    );
    assert.ok(decision.reason.includes('the Review Tier is human'));
  });

  for (const tier of ['auto', 'agent'] as const) {
    test(`${tier} Review Tier adds no tier reason`, () => {
      const decision = decideAutoMerge(
        facts({ reviewTier: { status: 'read', tier } }),
        'shadow',
      );
      assert.doesNotMatch(decision.reason, /Review Tier/);
    });
  }

  test('a held required check holds with its reason', () => {
    const decision = decideAutoMerge(
      facts({
        requiredChecks: {
          status: 'held',
          reason: '#7 has a red required check: Test',
        },
      }),
      'shadow',
    );
    assert.ok(decision.reason.includes('#7 has a red required check: Test'));
  });

  test('green and gated-at-merge required checks hold nothing', () => {
    assert.equal(AUTO_MERGE_RULES.requiredChecks({ status: 'green' }), null);
    assert.equal(
      AUTO_MERGE_RULES.requiredChecks({ status: 'gated-at-merge' }),
      null,
    );
  });

  test('held reasons are listed in rule order, joined by "; "', () => {
    const decision = decideAutoMerge(
      facts({
        mainCi: MAIN_RED,
        requiredChecks: {
          status: 'held',
          reason: '#7 has a red required check: Test',
        },
        door: { status: 'one-way' },
      }),
      'shadow',
    );
    assert.equal(
      decision.reason,
      [
        'the latest CI run on `main` is failure (ffffffff)',
        '#7 has a red required check: Test',
        NOT_READ.reviewTier,
        NOT_READ.agentVerdict,
        NOT_READ.qaReport,
        'the Merge Danger Door is one-way',
      ].join('; '),
    );
  });

  test('a passing fact passes its row of AUTO_MERGE_RULES', () => {
    assert.equal(AUTO_MERGE_RULES.mainCi(MAIN_GREEN), null);
    assert.equal(AUTO_MERGE_RULES.requiredChecks({ status: 'green' }), null);
    assert.equal(
      AUTO_MERGE_RULES.reviewTier({ status: 'read', tier: 'auto' }),
      null,
    );
    assert.equal(AUTO_MERGE_RULES.door({ status: 'two-way' }), null);
    assert.equal(AUTO_MERGE_RULES.door({ status: 'absent' }), null);
  });

  test('the all-clear fact set still holds on the three unread facts', () => {
    assert.deepEqual(autoMergeHolds(facts()), [
      NOT_READ.reviewTier,
      NOT_READ.agentVerdict,
      NOT_READ.qaReport,
    ]);
  });

  for (const [tier, door, expected] of [
    [
      'auto',
      'one-way',
      'the Merge Danger Door is one-way but the Review Tier is auto',
    ],
    [
      'agent',
      'one-way',
      'the Merge Danger Door is one-way but the Review Tier is agent',
    ],
  ] as const) {
    test(`one-way Door with ${tier} Review Tier is a mismatch`, () => {
      const decision = decideAutoMerge(
        facts({
          reviewTier: { status: 'read', tier },
          door: { status: door },
        }),
        'shadow',
      );
      assert.equal(decision.mismatch, expected);
    });
  }

  test('a one-way Door on a human Review Tier is no mismatch', () => {
    const decision = decideAutoMerge(
      facts({
        reviewTier: { status: 'read', tier: 'human' },
        door: { status: 'one-way' },
      }),
      'shadow',
    );
    assert.equal(decision.mismatch, null);
  });

  test('a one-way Door with the Review Tier unread is no mismatch', () => {
    const decision = decideAutoMerge(
      facts({ door: { status: 'one-way' } }),
      'shadow',
    );
    assert.equal(decision.mismatch, null);
  });

  test('a two-way Door on an agent Review Tier is no mismatch', () => {
    const decision = decideAutoMerge(
      facts({
        reviewTier: { status: 'read', tier: 'agent' },
        door: { status: 'two-way' },
      }),
      'shadow',
    );
    assert.equal(decision.mismatch, null);
  });

  test('a mismatch is reported in every mode: off, shadow and on', () => {
    for (const mode of AUTO_MERGE_MODES) {
      const decision = decideAutoMerge(
        facts({
          reviewTier: { status: 'read', tier: 'auto' },
          door: { status: 'one-way' },
        }),
        mode,
      );
      assert.equal(
        decision.mismatch,
        'the Merge Danger Door is one-way but the Review Tier is auto',
        mode,
      );
    }
  });
});

// ------------------------------------------- D2: the Agent Verdict (ADR 0148)

const OLDER_HEAD = 'c'.repeat(40);

/**
 * The hold each verdict gets on a head it reviewed. Typed over every Verdict,
 * so a verdict added to the contract without a row here fails to compile, and
 * the loop below fails at run time if one is missing.
 */
const HOLD_BY_VERDICT: Record<Verdict, string | null> = {
  approve: null,
  comment: 'the Agent Verdict is comment, not approve',
  'request-changes': 'the Agent Verdict is request-changes',
};

describe('the Agent Verdict rule', () => {
  for (const tier of ['auto', 'agent'] as const) {
    // The rule ignores the tier: the same fact holds the same way on either.
    for (const verdict of VERDICT_VALUES) {
      const expected = HOLD_BY_VERDICT[verdict];
      test(`${tier}: ${verdict} on the head ${expected ? 'holds with its reason' : 'adds no Agent Verdict hold'}`, () => {
        const holds = autoMergeHolds(
          facts({
            reviewTier: { status: 'read', tier },
            agentVerdict: { status: 'read', verdict, reviewedOid: HEAD },
          }),
        );
        assert.deepEqual(
          holds,
          expected ? [expected, NOT_READ.qaReport] : [NOT_READ.qaReport],
        );
      });
    }

    test(`${tier}: approve for an older commit holds, naming both short shas`, () => {
      const holds = autoMergeHolds(
        facts({
          reviewTier: { status: 'read', tier },
          agentVerdict: {
            status: 'read',
            verdict: 'approve',
            reviewedOid: OLDER_HEAD,
          },
        }),
      );
      assert.deepEqual(holds, [
        `the Agent Verdict approved \`${OLDER_HEAD.slice(0, 8)}\`, not the head \`${HEAD.slice(0, 8)}\``,
        NOT_READ.qaReport,
      ]);
      assert.match(holds[0], /not the head/);
    });

    test(`${tier}: approve that names no commit holds, saying it names none`, () => {
      const holds = autoMergeHolds(
        facts({
          reviewTier: { status: 'read', tier },
          agentVerdict: {
            status: 'read',
            verdict: 'approve',
            reviewedOid: null,
          },
        }),
      );
      assert.deepEqual(holds, [
        'the Agent Verdict does not name the commit it reviewed',
        NOT_READ.qaReport,
      ]);
    });
  }

  test('approve on the head adds no Agent Verdict reason to the decision', () => {
    const decision = decideAutoMerge(
      facts({
        reviewTier: { status: 'read', tier: 'auto' },
        agentVerdict: { status: 'read', verdict: 'approve', reviewedOid: HEAD },
      }),
      'shadow',
    );
    assert.equal(decision.reason, NOT_READ.qaReport);
  });

  test('a missing Agent Verdict holds with the reason the read gave', () => {
    const cases: [AgentVerdictFact, string][] = [
      [
        agentVerdictFrom({
          outcome: 'unreviewed',
          verdict: null,
          reviewedOid: null,
        }),
        'there is no code-review summary comment',
      ],
      [
        agentVerdictFrom({
          outcome: 'no-verdict',
          verdict: null,
          reviewedOid: null,
        }),
        'the code-review summary has no verdict',
      ],
      [
        agentVerdictFrom({
          outcome: 'unrecognised',
          verdict: null,
          reviewedOid: null,
        }),
        'the code-review summary heading is not recognised',
      ],
      [
        AGENT_VERDICT_UNREADABLE,
        'the Agent Verdict could not be read (no code-review summary comment)',
      ],
    ];
    for (const [fact, reason] of cases) {
      assert.deepEqual(
        autoMergeHolds(facts({ agentVerdict: fact })).slice(0, 2),
        [NOT_READ.reviewTier, reason],
        reason,
      );
    }
  });

  test('a read verdict carries its reviewed commit through agentVerdictFrom', () => {
    assert.deepEqual(
      agentVerdictFrom({
        outcome: 'passed',
        verdict: 'approve',
        reviewedOid: HEAD,
      }),
      { status: 'read', verdict: 'approve', reviewedOid: HEAD },
    );
  });

  // The reader the train calls: the publisher's own summary, read through the
  // author check, and the minimise check, as `gh pr view --json comments` shows it.
  describe('agentVerdictFromView', () => {
    const publisherSummary = summaryBody({
      rendered: `${verdictHeading('approve')}\n`,
      headSha: HEAD,
      runUrl: 'https://example.invalid/run/9',
    });

    test('no view (gh could not read the comments) is the unreadable fact', () => {
      assert.deepEqual(agentVerdictFromView(null), AGENT_VERDICT_UNREADABLE);
    });

    test('a summary written by someone else is not the Agent Verdict', () => {
      assert.deepEqual(
        agentVerdictFromView({
          comments: [
            {
              body: publisherSummary,
              author: { login: 'someone-else' },
            },
          ],
        }),
        {
          status: 'missing',
          reason: 'there is no code-review summary comment',
        },
      );
    });

    test('the publisher summary reads as the verdict and the commit it reviewed', () => {
      assert.deepEqual(
        agentVerdictFromView({
          comments: [
            {
              body: publisherSummary,
              author: { login: SUMMARY_AUTHOR_LOGIN },
            },
          ],
        }),
        { status: 'read', verdict: 'approve', reviewedOid: HEAD },
      );
    });

    test('a minimised publisher summary is not the Agent Verdict', () => {
      assert.deepEqual(
        agentVerdictFromView({
          comments: [
            {
              body: publisherSummary,
              author: { login: SUMMARY_AUTHOR_LOGIN },
              isMinimized: true,
            },
          ],
        }),
        {
          status: 'missing',
          reason: 'there is no code-review summary comment',
        },
      );
    });
  });

  test('every verdict has a row in both the expected table and the rule table', () => {
    const verdicts = [...VERDICT_VALUES].sort();
    assert.deepEqual(Object.keys(HOLD_BY_VERDICT).sort(), verdicts);
    assert.deepEqual(Object.keys(AGENT_VERDICT_HOLDS).sort(), verdicts);
  });
});

// ------------------------------------------------- E: the shadow comment

describe('renderShadowComment', () => {
  const decisionOf = (
    overrides: Partial<AutoMergeDecision>,
  ): AutoMergeDecision => ({
    action: 'shadow-comment',
    held: false,
    reason: `every fact holds for ${HEAD}`,
    mismatch: null,
    ...overrides,
  });

  test('starts with the hidden marker', () => {
    const body = renderShadowComment(decisionOf({}), HEAD);
    assert.equal(body.split('\n')[0], SHADOW_COMMENT_MARKER);
  });

  test('a would-merge decision names the head it was decided for', () => {
    const body = renderShadowComment(decisionOf({ held: false }), HEAD);
    assert.ok(body.includes(`${SHADOW_WOULD_MERGE} \`${HEAD}\``), body);
    assert.doesNotMatch(body, new RegExp(SHADOW_HELD));
  });

  test('a held decision names its reason and the head', () => {
    const body = renderShadowComment(
      decisionOf({ held: true, reason: 'the Review Tier is human' }),
      HEAD,
    );
    assert.ok(
      body.includes(
        `${SHADOW_COMMENT_LEAD} ${SHADOW_HELD} the Review Tier is human`,
      ),
      body,
    );
    assert.ok(body.includes(`Head: \`${HEAD}\``), body);
  });

  test('a mismatch adds a Mismatch line', () => {
    const body = renderShadowComment(
      decisionOf({
        held: true,
        reason: 'x',
        mismatch:
          'the Merge Danger Door is one-way but the Review Tier is agent',
      }),
      HEAD,
    );
    assert.ok(
      body.includes(
        'Mismatch: the Merge Danger Door is one-way but the Review Tier is agent',
      ),
      body,
    );
  });

  test('no mismatch adds no Mismatch line', () => {
    const body = renderShadowComment(decisionOf({ held: false }), HEAD);
    assert.doesNotMatch(body, /Mismatch:/);
  });
});

// ------------------------------------------------ F: checks on the head

describe('checksOnCurrentHead', () => {
  test('a clean, green, up-to-date head is green', () => {
    assert.deepEqual(checksOnCurrentHead(snapshot(), REQUIRED), {
      kind: 'green',
    });
  });

  test('a behind head with green checks is green, judged on its current head', () => {
    assert.deepEqual(
      checksOnCurrentHead(snapshot({ mergeStateStatus: 'BEHIND' }), REQUIRED),
      { kind: 'green' },
    );
  });

  test('a behind head with a red required check is held, naming it', () => {
    assert.deepEqual(
      checksOnCurrentHead(
        snapshot({
          mergeStateStatus: 'BEHIND',
          checks: [{ name: 'Test', bucket: 'fail' }],
        }),
        REQUIRED,
      ),
      { kind: 'held', reason: '#7 has a red required check: Test' },
    );
  });

  test('a pending required check waits', () => {
    assert.deepEqual(
      checksOnCurrentHead(
        snapshot({
          checks: [
            { name: 'Lint', bucket: 'pending' },
            { name: 'Test', bucket: 'pass' },
          ],
        }),
        REQUIRED,
      ),
      { kind: 'wait', reason: 'waiting on Lint' },
    );
  });

  test('a merged Pull Request is held as already merged', () => {
    assert.deepEqual(
      checksOnCurrentHead(snapshot({ state: 'MERGED' }), REQUIRED),
      { kind: 'held', reason: '#7 is already merged' },
    );
  });

  test('BLOCKED with every required check green waits, marked as a blocked-green wait', () => {
    assert.deepEqual(
      checksOnCurrentHead(snapshot({ mergeStateStatus: 'BLOCKED' }), REQUIRED, {
        blockedGreenReads: 0,
      }),
      {
        kind: 'wait',
        reason: 'GitHub has not yet unblocked the merge',
        blockedGreen: true,
      },
    );
  });

  test('a draft is held', () => {
    assert.deepEqual(
      checksOnCurrentHead(snapshot({ isDraft: true }), REQUIRED),
      { kind: 'held', reason: '#7 is a draft' },
    );
  });
});

// ------------------------------------------------ G: one pass, fake GitHub

describe('runAutoTrain', () => {
  test('shadow holds a red-check candidate and still decides the next one', async () => {
    const { io, writes, comments } = fakeAutoIo({
      1: [snapshot({ number: 1, checks: [{ name: 'Test', bucket: 'fail' }] })],
      2: [snapshot({ number: 2, headRefOid: 'b'.repeat(40) })],
    });
    const result = await runAutoTrain(autoArgs('shadow', [1, 2]), io);

    assert.deepEqual(result.held, [
      {
        pr: 1,
        reason: `#1 has a red required check: Test; ${ALL_NOT_READ}`,
      },
      { pr: 2, reason: ALL_NOT_READ },
    ]);
    assert.deepEqual(result.wouldMerge, []);
    assert.deepEqual(writes, [
      `comment #1 held: #1 has a red required check: Test; ${ALL_NOT_READ}`,
      `comment #2 held: ${ALL_NOT_READ}`,
    ]);
    assert.ok(comments.get(1)?.includes(`${SHADOW_HELD} #1 has a red`));
  });

  test('shadow run twice writes one comment per candidate per pass, the second replacing the first', async () => {
    const { io, writes, comments, created } = fakeAutoIo({
      1: [snapshot({ number: 1 })],
      2: [snapshot({ number: 2, headRefOid: 'b'.repeat(40) })],
    });
    await runAutoTrain(autoArgs('shadow', [1, 2]), io);
    const firstPass = new Map(comments);
    await runAutoTrain(autoArgs('shadow', [1, 2]), io);

    for (const pr of [1, 2]) {
      assert.ok(firstPass.get(pr)?.startsWith(SHADOW_COMMENT_MARKER));
      assert.equal(
        comments.get(pr),
        firstPass.get(pr),
        `#${pr} body after the second pass`,
      );
    }
    assert.deepEqual(created, [1, 2], 'only the first pass creates a comment');
    assert.equal(comments.size, 2, 'one comment body per candidate');
    assert.deepEqual(writes, [
      `comment #1 held: ${ALL_NOT_READ}`,
      `comment #2 held: ${ALL_NOT_READ}`,
      `comment #1 held: ${ALL_NOT_READ}`,
      `comment #2 held: ${ALL_NOT_READ}`,
    ]);
    assert.equal(
      writes.filter((write) => /^(merge|update)/.test(write)).length,
      0,
    );
  });

  test('off writes nothing and reads nothing; every candidate is held', async () => {
    const { io, writes, counts } = fakeAutoIo({
      1: [snapshot({ number: 1 })],
      2: [snapshot({ number: 2 })],
    });
    const result = await runAutoTrain(autoArgs('off', [1, 2]), io);

    assert.equal(counts.read, 0);
    assert.deepEqual(writes, []);
    assert.deepEqual(result.held, [
      { pr: 1, reason: AUTO_MERGE_OFF_REASON },
      { pr: 2, reason: AUTO_MERGE_OFF_REASON },
    ]);
  });

  test('a shadow dry run writes nothing and logs what each candidate would get', async () => {
    const { io, writes, log } = fakeAutoIo({
      1: [snapshot({ number: 1 })],
      2: [snapshot({ number: 2 })],
    });
    await runAutoTrain(autoArgs('shadow', [1, 2], { dryRun: true }), io);

    assert.deepEqual(writes, []);
    assert.match(log.join('\n'), /#1: would comment "held: /);
    assert.match(log.join('\n'), /#2: would comment "held: /);
  });

  test('an on dry run writes nothing and logs the decision it would make', async () => {
    const { io, writes, log } = fakeAutoIo({
      1: [snapshot({ number: 1 })],
    });
    await runAutoTrain(autoArgs('on', [1], { dryRun: true }), io);

    assert.deepEqual(writes, []);
    assert.match(log.join('\n'), /#1: would decide "held: /);
  });

  test('a red main holds every candidate, and main is read once per pass', async () => {
    const { io, counts } = fakeAutoIo(
      {
        1: [snapshot({ number: 1 })],
        2: [snapshot({ number: 2 })],
        3: [snapshot({ number: 3 })],
      },
      { mainCi: MAIN_RED },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1, 2, 3]), io);

    assert.equal(counts.mainCi, 1);
    assert.equal(result.held.length, 3);
    for (const { reason } of result.held) {
      assert.ok(
        reason.includes('the latest CI run on `main` is failure (ffffffff)'),
        reason,
      );
    }
  });

  test('on holds each candidate with no update, merge or comment', async () => {
    const { io, writes } = fakeAutoIo({
      1: [snapshot({ number: 1 })],
      2: [snapshot({ number: 2, headRefOid: 'b'.repeat(40) })],
    });
    const result = await runAutoTrain(autoArgs('on', [1, 2]), io);

    assert.deepEqual(writes, []);
    assert.deepEqual(result.held, [
      { pr: 1, reason: ALL_NOT_READ },
      { pr: 2, reason: ALL_NOT_READ },
    ]);
    assert.deepEqual(result.merged, []);
  });

  test('shadow waits on a pending required check, then comments without an update', async () => {
    const { io, writes, readsOf } = fakeAutoIo({
      1: [
        snapshot({
          number: 1,
          checks: [
            { name: 'Lint', bucket: 'pending' },
            { name: 'Test', bucket: 'pass' },
          ],
        }),
        snapshot({ number: 1 }),
      ],
    });
    const result = await runAutoTrain(autoArgs('shadow', [1]), io);

    assert.equal(readsOf(1), 2);
    assert.deepEqual(writes, [`comment #1 held: ${ALL_NOT_READ}`]);
    assert.deepEqual(result.held, [{ pr: 1, reason: ALL_NOT_READ }]);
  });

  test('shadow gives up a candidate still waiting at the timeout, after three reads', async () => {
    const { io, writes, readsOf } = fakeAutoIo({
      1: [
        snapshot({
          number: 1,
          checks: [
            { name: 'Lint', bucket: 'pending' },
            { name: 'Test', bucket: 'pass' },
          ],
        }),
      ],
    });
    const result = await runAutoTrain(
      autoArgs('shadow', [1], { timeoutMinutes: 1 }),
      io,
    );

    const reason = `#1 waited 1 min and is still waiting on Lint; ${ALL_NOT_READ}`;
    assert.equal(readsOf(1), 3);
    assert.deepEqual(result.held, [{ pr: 1, reason }]);
    assert.deepEqual(writes, [`comment #1 held: ${reason}`]);
  });

  test('a candidate that cannot be read mid-wait is held, and its comment is still written', async () => {
    const { io, writes } = fakeAutoIo({
      1: [
        snapshot({
          number: 1,
          checks: [
            { name: 'Lint', bucket: 'pending' },
            { name: 'Test', bucket: 'pass' },
          ],
        }),
        null,
      ],
    });
    const result = await runAutoTrain(autoArgs('shadow', [1]), io);

    const reason = `#1 could not be read; ${ALL_NOT_READ}`;
    assert.deepEqual(result.held, [{ pr: 1, reason }]);
    assert.deepEqual(writes, [`comment #1 held: ${reason}`]);
  });

  test('a shadow dry run judges a waiting candidate once and logs it as still waiting', async () => {
    const { io, writes, log, readsOf } = fakeAutoIo({
      1: [
        snapshot({
          number: 1,
          checks: [
            { name: 'Lint', bucket: 'pending' },
            { name: 'Test', bucket: 'pass' },
          ],
        }),
      ],
    });
    const result = await runAutoTrain(
      autoArgs('shadow', [1], { dryRun: true }),
      io,
    );

    const reason = `#1 is still waiting on Lint; ${ALL_NOT_READ}`;
    assert.equal(readsOf(1), 1);
    assert.deepEqual(writes, []);
    assert.deepEqual(result.held, [{ pr: 1, reason }]);
    assert.ok(
      log.includes(`#1: would comment "held: ${reason}"`),
      log.join('\n'),
    );
  });

  test('an unreadable candidate and a merged one are held, with no comment on either', async () => {
    const { io, writes } = fakeAutoIo({
      2: [snapshot({ number: 2, state: 'MERGED' })],
    });
    const result = await runAutoTrain(autoArgs('shadow', [1, 2]), io);

    assert.deepEqual(result.held, [
      { pr: 1, reason: '#1 could not be read' },
      { pr: 2, reason: '#2 is merged' },
    ]);
    assert.deepEqual(writes, []);
  });

  test('no required checks holds every candidate and writes nothing', async () => {
    const { io, writes } = fakeAutoIo(
      { 1: [snapshot({ number: 1 })], 2: [snapshot({ number: 2 })] },
      { required: [] },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1, 2]), io);

    assert.equal(result.held.length, 2);
    for (const { reason } of result.held) {
      assert.match(reason, /no required checks could be read/);
    }
    assert.deepEqual(writes, []);
  });

  test('a comment GitHub refuses is listed in commentFailures', async () => {
    const { io, writes } = fakeAutoIo(
      { 1: [snapshot({ number: 1 })], 2: [snapshot({ number: 2 })] },
      { commentRefusals: new Set([1]) },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1, 2]), io);

    assert.deepEqual(result.commentFailures, [1]);
    assert.deepEqual(writes, [
      `comment #1 held: ${ALL_NOT_READ}`,
      `comment #2 held: ${ALL_NOT_READ}`,
    ]);
  });

  test('a one-way Door with an agent Review Tier surfaces as a mismatch', async () => {
    const { io } = fakeAutoIo(
      {
        1: [
          snapshot({
            number: 1,
            body: '## Merge danger\n**Door:** one-way — the migration drops a column',
          }),
        ],
      },
      { tier: 'agent' },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1]), io);

    assert.deepEqual(result.mismatches, [
      {
        pr: 1,
        reason: 'the Merge Danger Door is one-way but the Review Tier is agent',
      },
    ]);
    assert.equal(result.held.length, 1);
  });

  test('shadow holds an approve for an older commit, and the comment says which commit', async () => {
    const { io, writes } = fakeAutoIo(
      { 1: [snapshot({ number: 1 })] },
      {
        agentVerdict: () => ({
          status: 'read',
          verdict: 'approve',
          reviewedOid: OLDER_HEAD,
        }),
      },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1]), io);

    const verdictHold = `the Agent Verdict approved \`${OLDER_HEAD.slice(0, 8)}\`, not the head \`${HEAD.slice(0, 8)}\``;
    assert.deepEqual(result.wouldMerge, []);
    assert.equal(result.held.length, 1);
    assert.ok(
      result.held[0].reason.includes(verdictHold),
      result.held[0].reason,
    );
    assert.deepEqual(writes, [`comment #1 held: ${result.held[0].reason}`]);
  });

  test('shadow does not hold on the Agent Verdict when approve names the head', async () => {
    const { io } = fakeAutoIo(
      { 1: [snapshot({ number: 1 })] },
      {
        tier: 'auto',
        agentVerdict: (_pr, headRefOid) => ({
          status: 'read',
          verdict: 'approve',
          reviewedOid: headRefOid,
        }),
      },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1]), io);

    assert.equal(result.held.length, 1, 'the other unread facts still hold');
    assert.doesNotMatch(result.held[0].reason, /Agent Verdict/);
    assert.equal(result.held[0].reason, NOT_READ.qaReport);
  });
});

// ------------------------------------------------------ H: the closing lines

describe('renderAutoTrainResult', () => {
  test('a dry shadow pass names its mode, what would merge, and what is held', () => {
    const result: AutoTrainResult = {
      mode: 'shadow',
      dryRun: true,
      merged: [],
      wouldMerge: [{ pr: 1, headRefOid: 'a'.repeat(40) }],
      held: [{ pr: 2, reason: 'x' }],
      mismatches: [],
      commentFailures: [],
    };
    assert.equal(
      renderAutoTrainResult(result),
      [
        'Auto-merge mode: shadow (dry run).',
        'Merged: none.',
        'Would merge: #1 at aaaaaaaa.',
        'Held:',
        '- #2: x',
      ].join('\n'),
    );
  });

  test('with nothing held or merged, the lines say none and no blocks appear', () => {
    const result: AutoTrainResult = {
      mode: 'on',
      dryRun: false,
      merged: [3],
      wouldMerge: [],
      held: [],
      mismatches: [],
      commentFailures: [],
    };
    assert.equal(
      renderAutoTrainResult(result),
      [
        'Auto-merge mode: on.',
        'Merged: #3.',
        'Would merge: none.',
        'Held: none.',
      ].join('\n'),
    );
  });

  test('mismatches and refused comments each add their own block', () => {
    const result: AutoTrainResult = {
      mode: 'shadow',
      dryRun: false,
      merged: [],
      wouldMerge: [],
      held: [{ pr: 2, reason: 'x' }],
      mismatches: [{ pr: 2, reason: 'm' }],
      commentFailures: [3],
    };
    assert.equal(
      renderAutoTrainResult(result),
      [
        'Auto-merge mode: shadow.',
        'Merged: none.',
        'Would merge: none.',
        'Held:',
        '- #2: x',
        'Mismatches:',
        '- #2: m',
        'Shadow comment not written: #3.',
      ].join('\n'),
    );
  });
});

// ------------------------------------- F: the Review Tier record (#1526)

const OTHER_HEAD = 'c'.repeat(40);

/**
 * One comment as `gh pr view --json comments` returns it. The workflow posts
 * as `github-actions[bot]`; GraphQL, which the train reads, drops the suffix,
 * so the login is `SUMMARY_AUTHOR_LOGIN`. The body is the publisher's render.
 */
const recordComment = (
  headRefOid: string,
  tier: ReviewTier,
  overrides: Partial<ReviewComment> = {},
): ReviewComment => ({
  author: { login: SUMMARY_AUTHOR_LOGIN },
  isMinimized: false,
  body: renderReviewTierRecord(headRefOid, tier),
  ...overrides,
});

/** Bodies the writer never produces, each with the marker and nothing valid. */
const MALFORMED_RECORD_BODIES: [string, string][] = [
  ['a marker with no record line', `${REVIEW_TIER_RECORD_MARKER}\nnothing`],
  [
    'a record with no commit',
    `${REVIEW_TIER_RECORD_MARKER}\nReview Tier of: \`auto\``,
  ],
  [
    'a record with an unknown tier',
    `${REVIEW_TIER_RECORD_MARKER}\nReview Tier of \`${HEAD}\`: \`maybe\``,
  ],
  [
    'a record with a short commit',
    `${REVIEW_TIER_RECORD_MARKER}\nReview Tier of \`${HEAD.slice(0, 8)}\`: \`auto\``,
  ],
];

const NO_RECORD_REASON = 'there is no Review Tier record for this Pull Request';
const MALFORMED_REASON = 'the Review Tier record is malformed';

describe('reviewTierFromView: the record as the train reads it', () => {
  test('a record the workflow wrote reads back as its tier, for auto, agent and human', () => {
    for (const tier of ['auto', 'agent', 'human'] as const) {
      assert.deepEqual(
        reviewTierFromView({ comments: [recordComment(HEAD, tier)] }, HEAD),
        { status: 'read', tier },
        tier,
      );
    }
  });

  test('a record for another commit names both commits and reads missing', () => {
    assert.deepEqual(
      reviewTierFromView(
        { comments: [recordComment(OTHER_HEAD, 'auto')] },
        HEAD,
      ),
      {
        status: 'missing',
        reason:
          'the Review Tier record is for `cccccccc`, not the head `aaaaaaaa`',
      },
    );
  });

  test('a malformed record reads missing as malformed, whichever way it is malformed', () => {
    for (const [name, body] of MALFORMED_RECORD_BODIES) {
      assert.deepEqual(
        reviewTierFromView(
          {
            comments: [
              {
                author: { login: SUMMARY_AUTHOR_LOGIN },
                isMinimized: false,
                body,
              },
            ],
          },
          HEAD,
        ),
        { status: 'missing', reason: MALFORMED_REASON },
        name,
      );
    }
  });

  test('no record, a record for another commit and a malformed record each read missing with a different reason, and each holds the merge', () => {
    const malformed: ReviewComment = {
      author: { login: SUMMARY_AUTHOR_LOGIN },
      isMinimized: false,
      body: MALFORMED_RECORD_BODIES[1][1],
    };
    const reads = [
      reviewTierFromView(null, HEAD),
      reviewTierFromView({ comments: [] }, HEAD),
      reviewTierFromView(
        { comments: [recordComment(OTHER_HEAD, 'auto')] },
        HEAD,
      ),
      reviewTierFromView({ comments: [malformed] }, HEAD),
    ];
    const reasons = reads.map(missingReason);
    assert.equal(new Set(reasons).size, reasons.length, reasons.join(' | '));
    for (const fact of reads) {
      const decision = decideAutoMerge(facts({ reviewTier: fact }), 'shadow');
      assert.equal(decision.held, true);
      assert.ok(decision.reason.includes(missingReason(fact)), decision.reason);
    }
  });

  test('a null view reads missing with the unreadable reason', () => {
    assert.deepEqual(reviewTierFromView(null, HEAD), {
      status: 'missing',
      reason: 'the Review Tier record could not be read',
    });
  });

  test('a view with no comments key reads missing as no record', () => {
    assert.deepEqual(reviewTierFromView({}, HEAD), {
      status: 'missing',
      reason: NO_RECORD_REASON,
    });
  });

  test('a forged record by another author after the real one is ignored', () => {
    assert.deepEqual(
      reviewTierFromView(
        {
          comments: [
            recordComment(HEAD, 'agent'),
            recordComment(HEAD, 'auto', { author: { login: 'mallory' } }),
          ],
        },
        HEAD,
      ),
      { status: 'read', tier: 'agent' },
    );
  });

  test('a forged record by another author before the real one is ignored', () => {
    assert.deepEqual(
      reviewTierFromView(
        {
          comments: [
            recordComment(HEAD, 'auto', { author: { login: 'mallory' } }),
            recordComment(HEAD, 'human'),
          ],
        },
        HEAD,
      ),
      { status: 'read', tier: 'human' },
    );
  });

  test('a forged record with no real record reads as no record', () => {
    assert.deepEqual(
      reviewTierFromView(
        {
          comments: [
            recordComment(HEAD, 'auto', { author: { login: 'mallory' } }),
          ],
        },
        HEAD,
      ),
      { status: 'missing', reason: NO_RECORD_REASON },
    );
  });

  test('a minimised record is ignored, and the record before it stands', () => {
    assert.deepEqual(
      reviewTierFromView(
        {
          comments: [
            recordComment(HEAD, 'agent'),
            recordComment(HEAD, 'auto', { isMinimized: true }),
          ],
        },
        HEAD,
      ),
      { status: 'read', tier: 'agent' },
    );
  });

  test('a minimised record alone reads as no record', () => {
    assert.deepEqual(
      reviewTierFromView(
        { comments: [recordComment(HEAD, 'auto', { isMinimized: true })] },
        HEAD,
      ),
      { status: 'missing', reason: NO_RECORD_REASON },
    );
  });

  test('the latest own record wins: a later record for another commit hides an earlier one for this head', () => {
    assert.deepEqual(
      reviewTierFromView(
        {
          comments: [
            recordComment(HEAD, 'agent'),
            recordComment(HEAD, 'human'),
          ],
        },
        HEAD,
      ),
      { status: 'read', tier: 'human' },
    );
    assert.equal(
      reviewTierFromView(
        {
          comments: [
            recordComment(HEAD, 'auto'),
            recordComment(OTHER_HEAD, 'auto'),
          ],
        },
        HEAD,
      ).status,
      'missing',
    );
  });
});

describe('reviewTierFromView: a code-review summary that quotes a record', () => {
  test('is not the record: alone it reads missing, and beside the real record it does not override it', () => {
    const summary = recordComment(HEAD, 'auto', {
      body: `${SUMMARY_MARKER}\nAutomated code review of \`${HEAD}\`\n\n${renderReviewTierRecord(HEAD, 'auto')}`,
    });
    assert.deepEqual(reviewTierFromView({ comments: [summary] }, HEAD), {
      status: 'missing',
      reason: NO_RECORD_REASON,
    });
    assert.deepEqual(
      reviewTierFromView(
        { comments: [recordComment(HEAD, 'agent'), summary] },
        HEAD,
      ),
      { status: 'read', tier: 'agent' },
    );
  });
});

// ------------------------------------ G: the path guard rule (#1526)

const GUARD_RULE = 'gates-and-their-config';
const GATES_FILE = 'tools/config/review-tier-paths.json';

/** The held reason a changed file gives when it matches a human rule of `main`. */
const guardHeld = (path: string, rule: string): string =>
  `\`${path}\` matches the human rule "${rule}" in the path map of \`main\``;

describe('pathGuardFrom: the changed files against the human rules of main', () => {
  test('clear when no changed file matches a human rule, and an empty list is clear', () => {
    assert.deepEqual(pathGuardFrom([], REAL_PATH_MAP), { status: 'clear' });
    assert.deepEqual(
      pathGuardFrom(
        [{ filename: 'package.json' }, { filename: 'docs/x.md' }],
        REAL_PATH_MAP,
      ),
      { status: 'clear' },
    );
  });

  test('a file matching a human rule of the committed map is matched by that rule', () => {
    assert.deepEqual(pathGuardFrom([{ filename: GATES_FILE }], REAL_PATH_MAP), {
      status: 'matched',
      path: GATES_FILE,
      rule: GUARD_RULE,
    });
  });

  test('a rename counts under its previous path as well as its new one', () => {
    assert.deepEqual(
      pathGuardFrom(
        [{ filename: 'docs/x.md', previous_filename: GATES_FILE }],
        REAL_PATH_MAP,
      ),
      { status: 'matched', path: GATES_FILE, rule: GUARD_RULE },
    );
    assert.deepEqual(
      pathGuardFrom(
        [
          {
            filename: '.github/workflows/ci.yml',
            previous_filename: 'docs/x.md',
          },
        ],
        REAL_PATH_MAP,
      ),
      {
        status: 'matched',
        path: '.github/workflows/ci.yml',
        rule: 'workflows-and-ownership',
      },
    );
  });

  test('a null map or a null file list is unreadable, with its reason', () => {
    assert.deepEqual(pathGuardFrom([], null), {
      status: 'unreadable',
      reason: 'the path map of `main` could not be read',
    });
    assert.deepEqual(pathGuardFrom(null, REAL_PATH_MAP), {
      status: 'unreadable',
      reason: "the Pull Request's changed files could not be read",
    });
  });

  test('2999 files are still judged, and 3000 is unreadable, whatever they are', () => {
    const prose = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        filename: `docs/page-${i}.md`,
      }));
    assert.deepEqual(pathGuardFrom(prose(2999), REAL_PATH_MAP), {
      status: 'clear',
    });
    assert.deepEqual(pathGuardFrom(prose(3000), REAL_PATH_MAP), {
      status: 'unreadable',
      reason:
        'the Pull Request changes 3000 files or more, more than GitHub lists',
    });
  });
});

describe('the pathGuard rule and its place in the held reasons', () => {
  test('clear holds nothing, a match names the file and the rule, and unreadable gives its own reason', () => {
    assert.equal(AUTO_MERGE_RULES.pathGuard({ status: 'clear' }), null);
    assert.equal(
      AUTO_MERGE_RULES.pathGuard({
        status: 'matched',
        path: GATES_FILE,
        rule: GUARD_RULE,
      }),
      guardHeld(GATES_FILE, GUARD_RULE),
    );
    assert.equal(
      AUTO_MERGE_RULES.pathGuard({
        status: 'unreadable',
        reason: 'the path map of `main` could not be read',
      }),
      'the path map of `main` could not be read',
    );
  });

  test('a matched guard holds in its slot, after the Review Tier and before the Agent Verdict', () => {
    const matched: PathGuardFact = {
      status: 'matched',
      path: GATES_FILE,
      rule: GUARD_RULE,
    };
    const decision = decideAutoMerge(
      facts({
        reviewTier: { status: 'read', tier: 'auto' },
        pathGuard: matched,
      }),
      'shadow',
    );
    assert.equal(
      decision.reason,
      [
        guardHeld(GATES_FILE, GUARD_RULE),
        NOT_READ.agentVerdict,
        NOT_READ.qaReport,
      ].join('; '),
    );
  });
});

describe('the Review Tier rule: only a human tier holds', () => {
  test('auto and agent pass their row, human holds, and a missing tier holds with its reason', () => {
    assert.equal(
      AUTO_MERGE_RULES.reviewTier({ status: 'read', tier: 'auto' }),
      null,
    );
    assert.equal(
      AUTO_MERGE_RULES.reviewTier({ status: 'read', tier: 'agent' }),
      null,
    );
    assert.equal(
      AUTO_MERGE_RULES.reviewTier({ status: 'read', tier: 'human' }),
      'the Review Tier is human',
    );
    assert.equal(
      AUTO_MERGE_RULES.reviewTier(UNREAD_REVIEW_TIER),
      NOT_READ.reviewTier,
    );
    const human = decideAutoMerge(
      facts({ reviewTier: { status: 'read', tier: 'human' } }),
      'shadow',
    );
    assert.equal(human.held, true);
    assert.ok(human.reason.includes('the Review Tier is human'), human.reason);
  });
});

// ----------------------- H: runAutoTrain, the record and the path guard (#1526)

/** The Review Tier fact the train reads from one `gh pr view` view. */
const tierReadFrom =
  (view: { comments?: ReviewComment[] }) =>
  (_pr: number, head: string): ReviewTierFact =>
    reviewTierFromView(view, head);

const AUTO_VIEW = { comments: [recordComment(HEAD, 'auto')] };

describe('runAutoTrain: the Review Tier record and the path guard', () => {
  test('the record decides the tier whatever labels the view carries: a human record holds, an auto record does not', async () => {
    const views: Record<
      number,
      { labels: { name: string }[]; comments: ReviewComment[] }
    > = {
      1: {
        labels: [{ name: 'review:agent' }],
        comments: [recordComment(HEAD, 'human')],
      },
      2: {
        labels: [{ name: 'review:human' }],
        comments: [recordComment(HEAD, 'auto')],
      },
    };
    const { io, writes } = fakeAutoIo(
      { 1: [snapshot({ number: 1 })], 2: [snapshot({ number: 2 })] },
      {
        reviewTierFact: (pr, head) => reviewTierFromView(views[pr], head),
      },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1, 2]), io);

    const humanHold = [
      'the Review Tier is human',
      NOT_READ.agentVerdict,
      NOT_READ.qaReport,
    ].join('; ');
    assert.deepEqual(result.held, [
      { pr: 1, reason: humanHold },
      {
        pr: 2,
        reason: [NOT_READ.agentVerdict, NOT_READ.qaReport].join('; '),
      },
    ]);
    assert.deepEqual(result.wouldMerge, []);
    assert.equal(writes[0], `comment #1 held: ${humanHold}`);
  });

  test('a record that says auto is held by the path guard when the diff changes the path map', async () => {
    const { io } = fakeAutoIo(
      { 1: [snapshot({ number: 1 })] },
      {
        reviewTierFact: tierReadFrom(AUTO_VIEW),
        changedFiles: () => [{ filename: GATES_FILE }],
      },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1]), io);

    assert.deepEqual(result.held, [
      {
        pr: 1,
        reason: [
          guardHeld(GATES_FILE, GUARD_RULE),
          NOT_READ.agentVerdict,
          NOT_READ.qaReport,
        ].join('; '),
      },
    ]);
  });

  test('a rename out of a human path is held on the old name', async () => {
    const { io } = fakeAutoIo(
      { 1: [snapshot({ number: 1 })] },
      {
        reviewTierFact: tierReadFrom(AUTO_VIEW),
        changedFiles: () => [
          { filename: 'docs/x.md', previous_filename: GATES_FILE },
        ],
      },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1]), io);

    assert.equal(result.held.length, 1);
    assert.ok(
      result.held[0].reason.includes(guardHeld(GATES_FILE, GUARD_RULE)),
      result.held[0].reason,
    );
    assert.doesNotMatch(result.held[0].reason, /`docs\/x\.md` matches/);
  });

  test('an unreadable main path map holds every candidate, and main is read once per pass', async () => {
    const { io, counts } = fakeAutoIo(
      {
        1: [snapshot({ number: 1 })],
        2: [snapshot({ number: 2 })],
      },
      { pathMap: null, reviewTierFact: tierReadFrom(AUTO_VIEW) },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1, 2]), io);

    assert.equal(counts.mainPathMap, 1);
    assert.deepEqual(result.held, [
      {
        pr: 1,
        reason: [
          'the path map of `main` could not be read',
          NOT_READ.agentVerdict,
          NOT_READ.qaReport,
        ].join('; '),
      },
      {
        pr: 2,
        reason: [
          'the path map of `main` could not be read',
          NOT_READ.agentVerdict,
          NOT_READ.qaReport,
        ].join('; '),
      },
    ]);
  });

  test('changed files that cannot be listed hold the candidate with the unreadable reason', async () => {
    const { io } = fakeAutoIo(
      { 1: [snapshot({ number: 1 })] },
      {
        reviewTierFact: tierReadFrom(AUTO_VIEW),
        changedFiles: () => null,
      },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1]), io);

    assert.deepEqual(result.held, [
      {
        pr: 1,
        reason: [
          "the Pull Request's changed files could not be read",
          NOT_READ.agentVerdict,
          NOT_READ.qaReport,
        ].join('; '),
      },
    ]);
  });

  test('a prose-only diff is not held by the path guard', async () => {
    const { io } = fakeAutoIo(
      { 1: [snapshot({ number: 1 })] },
      {
        reviewTierFact: tierReadFrom(AUTO_VIEW),
        changedFiles: () => [
          { filename: 'docs/x.md' },
          { filename: 'README.md' },
        ],
      },
    );
    const result = await runAutoTrain(autoArgs('shadow', [1]), io);

    assert.deepEqual(result.held, [
      {
        pr: 1,
        reason: [NOT_READ.agentVerdict, NOT_READ.qaReport].join('; '),
      },
    ]);
  });

  test('changed files are asked for once per candidate', async () => {
    const { io, changedFilesAsked } = fakeAutoIo({
      1: [snapshot({ number: 1 })],
      2: [snapshot({ number: 2 })],
      3: [snapshot({ number: 3 })],
    });
    await runAutoTrain(autoArgs('shadow', [1, 2, 3]), io);

    assert.deepEqual(changedFilesAsked, [1, 2, 3]);
  });
});

// ------------------------------- I: the gh and git readers of the guard (#1526)

describe('changedFilesFromGh: the changed files as gh api lists them', () => {
  test('a failed listing is unreadable, not an empty list', () => {
    assert.equal(changedFilesFromGh({ status: 1, stdout: '' }), null);
  });

  test('one line that is not JSON makes the whole listing unreadable', () => {
    assert.equal(
      changedFilesFromGh({
        status: 0,
        stdout: '{"filename":"a.ts"}\nnot json',
      }),
      null,
    );
  });

  test('each file keeps its previous name, and blank lines are ignored', () => {
    assert.deepEqual(
      changedFilesFromGh({
        status: 0,
        stdout:
          '{"filename":"docs/x.md","previous_filename":"tools/config/review-tier-paths.json"}\n\n{"filename":"b.ts","previous_filename":null}\n',
      }),
      [
        { filename: 'docs/x.md', previous_filename: GATES_FILE },
        { filename: 'b.ts', previous_filename: null },
      ],
    );
  });

  test('an empty listing is a Pull Request with no files', () => {
    assert.deepEqual(changedFilesFromGh({ status: 0, stdout: '' }), []);
  });
});

describe("readPathMapFromGit: main's path map through a counting fake git", () => {
  const committed = readFileSync(
    join(REPO_ROOT, REVIEW_TIER_PATHS_CONFIG),
    'utf8',
  );
  const FETCH = ['fetch', '--quiet', 'origin', 'main'];
  const SHOW = ['show', 'origin/main:tools/config/review-tier-paths.json'];

  /** A fake git: answers each subcommand as scripted, and records every call. */
  const fakeGit = (answers: { fetch: GitResult; show: GitResult }) => {
    const calls: string[][] = [];
    const git = (args: string[]): GitResult => {
      calls.push(args);
      return args[0] === 'fetch' ? answers.fetch : answers.show;
    };
    return { git, calls };
  };
  const OK_FETCH: GitResult = { status: 0, stdout: '' };

  test('a successful fetch and show read the committed map, with exactly those two calls', () => {
    const { git, calls } = fakeGit({
      fetch: OK_FETCH,
      show: { status: 0, stdout: committed },
    });
    assert.deepEqual(
      readPathMapFromGit(git),
      loadPathMap(join(REPO_ROOT, REVIEW_TIER_PATHS_CONFIG)),
    );
    assert.deepEqual(calls, [FETCH, SHOW]);
  });

  test('a failed fetch is no map, and no show is run', () => {
    const { git, calls } = fakeGit({
      fetch: { status: 1, stdout: '' },
      show: { status: 0, stdout: committed },
    });
    assert.equal(readPathMapFromGit(git), null);
    assert.deepEqual(calls, [FETCH]);
  });

  test('a failed show is no map', () => {
    const { git, calls } = fakeGit({
      fetch: OK_FETCH,
      show: { status: 128, stdout: '' },
    });
    assert.equal(readPathMapFromGit(git), null);
    assert.deepEqual(calls, [FETCH, SHOW]);
  });

  test('a null status counts as a failure, for the fetch and for the show', () => {
    const failedFetch = fakeGit({
      fetch: { status: null, stdout: null },
      show: { status: 0, stdout: committed },
    });
    assert.equal(readPathMapFromGit(failedFetch.git), null);
    assert.deepEqual(failedFetch.calls, [FETCH]);

    const failedShow = fakeGit({
      fetch: OK_FETCH,
      show: { status: null, stdout: committed },
    });
    assert.equal(readPathMapFromGit(failedShow.git), null);
  });

  test('a successful show with no stdout is no map', () => {
    const { git } = fakeGit({
      fetch: OK_FETCH,
      show: { status: 0, stdout: null },
    });
    assert.equal(readPathMapFromGit(git), null);
  });

  test('a show that is not JSON is no map', () => {
    const { git } = fakeGit({
      fetch: OK_FETCH,
      show: { status: 0, stdout: 'not json' },
    });
    assert.equal(readPathMapFromGit(git), null);
  });

  test('JSON that is not a valid map is no map', () => {
    const { git } = fakeGit({
      fetch: OK_FETCH,
      show: { status: 0, stdout: '{"schemaVersion":2,"rules":[]}' },
    });
    assert.equal(readPathMapFromGit(git), null);
  });
});

// ------------------------------------------ F: the QA Report (ADR 0148, #1527)

/** The commit a report named before the head moved on (QA ran on it). */
const FORK = '1'.repeat(40);
const UPDATED_HEAD = 'b'.repeat(40);
const LATER = 'd'.repeat(40);
const MAIN_SIDE = 'e'.repeat(40);
const QA_TRUSTED = 'train-login';

const qaComment = (
  body: string,
  login: string = QA_TRUSTED,
  isMinimized = false,
): ReviewComment => ({ body, author: { login }, isMinimized });

const qaHeader = (result: 'passed' | 'failed', commit: string, left = 0) =>
  `QA Report: result=${result}; commit=${commit}; left-for-person=${left}`;

/** A report comment as the Skill posts it: the marker, the header, the heading. */
const qaReportText = (header: string) =>
  [QA_REPORT_MARKER, '', header, '', '## QA Report'].join('\n');

/** The fact for a passed report that names the commit given, with nothing left. */
const currentPassed = (commit: string): QaReportFact => ({
  status: 'read',
  result: 'passed',
  commit,
  leftForPerson: 0,
  staleness: { status: 'current' },
});

/** `qaReportFromView` with the train's login, the head and the reads defaulted. */
const readQa = (
  comments: ReviewComment[],
  {
    head = HEAD,
    commits = () => [],
    isOnMain = () => null,
  }: {
    head?: string;
    commits?: () => PrCommit[] | null;
    isOnMain?: (sha: string) => boolean | null;
  } = {},
): QaReportFact =>
  qaReportFromView({ comments }, QA_TRUSTED, head, commits, isOnMain);

const NO_QA_REPORT = 'there is no QA Report for this Pull Request';
const QA_HEADER_REASON =
  'the QA Report header is missing or not in the fixed form';

describe('qaReportFromView: the QA Report as the train reads it', () => {
  test('a passed report for the head, with nothing left, reads passed and current, and asks for no commits', () => {
    let asked = 0;
    const fact = readQa([qaComment(qaReportText(qaHeader('passed', HEAD)))], {
      commits: () => {
        asked += 1;
        return [];
      },
    });
    assert.deepEqual(fact, currentPassed(HEAD));
    assert.equal(asked, 0, 'the head is the named commit, so no list is read');
  });

  test('a forged passing report by another login, posted after a real failing one, is ignored: the result is failed', () => {
    const fact = readQa([
      qaComment(qaReportText(qaHeader('failed', HEAD))),
      qaComment(qaReportText(qaHeader('passed', HEAD)), 'someone-else'),
    ]);
    assert.deepEqual(fact, {
      status: 'read',
      result: 'failed',
      commit: HEAD,
      leftForPerson: 0,
      staleness: { status: 'current' },
    });
  });

  test('a forged report with no real report from the train reads missing as no report', () => {
    assert.deepEqual(
      readQa([
        qaComment(qaReportText(qaHeader('passed', HEAD)), 'someone-else'),
      ]),
      { status: 'missing', reason: NO_QA_REPORT },
    );
  });

  test('a minimised report is ignored, and the one before it stands', () => {
    assert.deepEqual(
      readQa([
        qaComment(qaReportText(qaHeader('failed', HEAD))),
        qaComment(qaReportText(qaHeader('passed', HEAD)), QA_TRUSTED, true),
      ]),
      {
        status: 'read',
        result: 'failed',
        commit: HEAD,
        leftForPerson: 0,
        staleness: { status: 'current' },
      },
    );
  });

  test('a minimised report alone reads missing as no report', () => {
    assert.deepEqual(
      readQa([
        qaComment(qaReportText(qaHeader('passed', HEAD)), QA_TRUSTED, true),
      ]),
      { status: 'missing', reason: NO_QA_REPORT },
    );
  });

  test('the latest trusted report wins: a later failure beats an earlier pass', () => {
    assert.deepEqual(
      readQa([
        qaComment(qaReportText(qaHeader('passed', HEAD))),
        qaComment(qaReportText(qaHeader('failed', HEAD))),
      ]),
      {
        status: 'read',
        result: 'failed',
        commit: HEAD,
        leftForPerson: 0,
        staleness: { status: 'current' },
      },
    );
  });

  test('a malformed latest trusted report holds: the earlier pass does not stand in for it', () => {
    assert.deepEqual(
      readQa([
        qaComment(qaReportText(qaHeader('passed', HEAD))),
        qaComment(qaReportText('QA Report: result=passed; commit=short')),
      ]),
      { status: 'missing', reason: QA_HEADER_REASON },
    );
  });

  test('a marker on a later line, not the first, is not a report', () => {
    assert.deepEqual(
      readQa([qaComment(`Intro\n${qaReportText(qaHeader('passed', HEAD))}`)]),
      { status: 'missing', reason: NO_QA_REPORT },
    );
  });

  test('a null view or a null login reads missing as could not be read', () => {
    const could = 'the QA Report could not be read';
    assert.deepEqual(
      qaReportFromView(
        null,
        QA_TRUSTED,
        HEAD,
        () => [],
        () => null,
      ),
      { status: 'missing', reason: could },
    );
    assert.deepEqual(
      qaReportFromView(
        { comments: [qaComment(qaReportText(qaHeader('passed', HEAD)))] },
        null,
        HEAD,
        () => [],
        () => null,
      ),
      { status: 'missing', reason: could },
    );
  });

  test('a report naming another commit with the commit list unreadable is missing, not current', () => {
    assert.deepEqual(
      readQa([qaComment(qaReportText(qaHeader('passed', OLDER_HEAD)))], {
        commits: () => null,
      }),
      {
        status: 'missing',
        reason: "the Pull Request's commits could not be read",
      },
    );
  });

  test('a report naming another commit is stale when a branch commit follows it, and asks isOnMain for nothing', () => {
    let asked = 0;
    assert.deepEqual(
      readQa([qaComment(qaReportText(qaHeader('passed', OLDER_HEAD)))], {
        commits: () => [
          { sha: FORK, parents: [] },
          { sha: OLDER_HEAD, parents: [FORK] },
          { sha: HEAD, parents: [OLDER_HEAD] },
        ],
        isOnMain: () => {
          asked += 1;
          return true;
        },
      }),
      {
        status: 'read',
        result: 'passed',
        commit: OLDER_HEAD,
        leftForPerson: 0,
        staleness: { status: 'stale', byCommit: HEAD },
      },
    );
    assert.equal(asked, 0);
  });

  test('an update merge of main after the named commit is current, read through the reader', () => {
    assert.deepEqual(
      readQa([qaComment(qaReportText(qaHeader('passed', OLDER_HEAD)))], {
        commits: () => [
          { sha: FORK, parents: [] },
          { sha: OLDER_HEAD, parents: [FORK] },
          { sha: HEAD, parents: [OLDER_HEAD, MAIN_SIDE] },
        ],
        isOnMain: (sha) => sha === MAIN_SIDE,
      }),
      {
        status: 'read',
        result: 'passed',
        commit: OLDER_HEAD,
        leftForPerson: 0,
        staleness: { status: 'current' },
      },
    );
  });

  test('a report naming a commit the branch no longer has is missing, with the reason', () => {
    assert.deepEqual(
      readQa([qaComment(qaReportText(qaHeader('passed', OLDER_HEAD)))], {
        commits: () => [
          { sha: FORK, parents: [] },
          { sha: HEAD, parents: [FORK] },
        ],
      }),
      {
        status: 'missing',
        reason:
          'the QA Report names `cccccccc`, which is no longer on the branch',
      },
    );
  });
});

describe('prCommitsFromGh: the commit list as gh api pulls/N/commits returns it', () => {
  test('each JSON line is one commit, with its sha and its parents', () => {
    const stdout = [
      JSON.stringify({ sha: HEAD, parents: [OLDER_HEAD, MAIN_SIDE] }),
      JSON.stringify({ sha: OLDER_HEAD, parents: [] }),
    ].join('\n');
    assert.deepEqual(prCommitsFromGh({ status: 0, stdout }), [
      { sha: HEAD, parents: [OLDER_HEAD, MAIN_SIDE] },
      { sha: OLDER_HEAD, parents: [] },
    ]);
  });

  test('a failed call is no list, even when its output parses', () => {
    assert.equal(
      prCommitsFromGh({
        status: 1,
        stdout: JSON.stringify({ sha: HEAD, parents: [] }),
      }),
      null,
    );
  });

  test('one line that is not JSON makes the whole list unreadable', () => {
    assert.equal(
      prCommitsFromGh({
        status: 0,
        stdout: `${JSON.stringify({ sha: HEAD, parents: [] })}\nnot json`,
      }),
      null,
    );
  });

  test('a commit with no sha, or no parents array, makes the whole list unreadable', () => {
    assert.equal(
      prCommitsFromGh({ status: 0, stdout: '{"parents":[]}' }),
      null,
    );
    assert.equal(
      prCommitsFromGh({ status: 0, stdout: `{"sha":"${HEAD}"}` }),
      null,
    );
  });

  test('an empty listing, or one of blank lines, is an empty list', () => {
    assert.deepEqual(prCommitsFromGh({ status: 0, stdout: '' }), []);
    assert.deepEqual(prCommitsFromGh({ status: 0, stdout: '\n\n' }), []);
  });
});

describe('the QA Report rule: what holds the merge and what passes', () => {
  const staleFact: QaReportFact = {
    status: 'read',
    result: 'passed',
    commit: OLDER_HEAD,
    leftForPerson: 0,
    staleness: { status: 'stale', byCommit: UPDATED_HEAD },
  };
  const holds: [string, QaReportFact, string][] = [
    [
      'a failed report',
      {
        status: 'read',
        result: 'failed',
        commit: HEAD,
        leftForPerson: 0,
        staleness: { status: 'current' },
      },
      'the QA Report records a failure',
    ],
    [
      'one item left for a person, in the singular',
      {
        status: 'read',
        result: 'passed',
        commit: HEAD,
        leftForPerson: 1,
        staleness: { status: 'current' },
      },
      'the QA Report leaves 1 item for a person',
    ],
    [
      'two items left for a person, in the plural',
      {
        status: 'read',
        result: 'passed',
        commit: HEAD,
        leftForPerson: 2,
        staleness: { status: 'current' },
      },
      'the QA Report leaves 2 items for a person',
    ],
    [
      'a stale report, naming both short shas',
      staleFact,
      'the QA Report is for `cccccccc`, and the branch commit `bbbbbbbb` came after it',
    ],
    [
      'a missing report, with its reason',
      { status: 'missing', reason: NO_QA_REPORT },
      NO_QA_REPORT,
    ],
  ];
  for (const [name, fact, reason] of holds) {
    test(`${name} holds with its reason`, () => {
      assert.equal(AUTO_MERGE_RULES.qaReport(fact), reason);
    });
  }

  test('a passed report with nothing left, on the head, passes', () => {
    assert.equal(AUTO_MERGE_RULES.qaReport(currentPassed(HEAD)), null);
  });

  test('a no-manual-QA report on the head passes, with nothing left', () => {
    assert.equal(
      AUTO_MERGE_RULES.qaReport({
        status: 'read',
        result: 'none-needed',
        commit: HEAD,
        leftForPerson: 0,
        staleness: { status: 'current' },
      }),
      null,
    );
  });
});

describe('decideAutoMerge: the QA Report under on and shadow', () => {
  const withQa = (qaReport: QaReportFact): AutoMergeFacts =>
    facts({
      reviewTier: { status: 'read', tier: 'auto' },
      agentVerdict: { status: 'read', verdict: 'approve', reviewedOid: HEAD },
      qaReport,
    });
  const holdCases: [string, QaReportFact, string][] = [
    [
      'failed',
      {
        status: 'read',
        result: 'failed',
        commit: HEAD,
        leftForPerson: 0,
        staleness: { status: 'current' },
      },
      'the QA Report records a failure',
    ],
    [
      'two items left',
      {
        status: 'read',
        result: 'passed',
        commit: HEAD,
        leftForPerson: 2,
        staleness: { status: 'current' },
      },
      'the QA Report leaves 2 items for a person',
    ],
    [
      'stale',
      {
        status: 'read',
        result: 'passed',
        commit: OLDER_HEAD,
        leftForPerson: 0,
        staleness: { status: 'stale', byCommit: UPDATED_HEAD },
      },
      'the QA Report is for `cccccccc`, and the branch commit `bbbbbbbb` came after it',
    ],
    [
      'unparseable',
      { status: 'missing', reason: QA_HEADER_REASON },
      QA_HEADER_REASON,
    ],
  ];
  for (const mode of ['on', 'shadow'] as const) {
    const heldAction = mode === 'on' ? 'skip' : 'shadow-comment';
    for (const [name, fact, reason] of holdCases) {
      test(`${mode}: ${name} holds the candidate with its reason`, () => {
        const decision = decideAutoMerge(withQa(fact), mode);
        assert.equal(decision.held, true);
        assert.equal(decision.action, heldAction);
        assert.equal(decision.reason, reason);
      });
    }
    const passes: [string, QaReportFact][] = [
      ['a passed report with nothing left', currentPassed(HEAD)],
      [
        'a no-manual-QA report',
        {
          status: 'read',
          result: 'none-needed',
          commit: HEAD,
          leftForPerson: 0,
          staleness: { status: 'current' },
        },
      ],
    ];
    for (const [name, fact] of passes) {
      test(`${mode}: ${name} is allowed`, () => {
        const decision = decideAutoMerge(withQa(fact), mode);
        assert.equal(decision.held, false);
        assert.equal(decision.reason, `every fact holds for ${HEAD}`);
        assert.equal(
          decision.action,
          mode === 'on' ? 'merge' : 'shadow-comment',
        );
      });
    }
  }
});

/** Records every `merge` the train asks for, and passes it through. */
function recordMerges(
  io: AutoTrainIo,
): { pr: number; headOid: string; method: MergeMethod }[] {
  const merges: { pr: number; headOid: string; method: MergeMethod }[] = [];
  const merge = io.merge;
  io.merge = (pr, headOid, method) => {
    merges.push({ pr, headOid, method });
    return merge(pr, headOid, method);
  };
  return merges;
}

describe('runAutoTrain under on: the facts for each head it would merge', () => {
  test('on merges a candidate whose every fact passes, with the head it read', async () => {
    const { io, writes } = fakeAutoIo(
      { 1: [snapshot({ number: 1 })] },
      {
        tier: 'auto',
        agentVerdict: (_pr, headRefOid) => ({
          status: 'read',
          verdict: 'approve',
          reviewedOid: headRefOid,
        }),
        qaReportFact: (_pr, headRefOid) => currentPassed(headRefOid),
      },
    );
    const merges = recordMerges(io);
    const result = await runAutoTrain(autoArgs('on', [1]), io);

    assert.deepEqual(result.merged, [1]);
    assert.deepEqual(result.held, []);
    assert.deepEqual(merges, [{ pr: 1, headOid: HEAD, method: 'merge' }]);
    assert.deepEqual(writes, ['merge #1 @a merge'], 'no update was needed');
  });

  test('after the train updates the branch from A to B, every fact is read again at B, and B is merged', async () => {
    const seen = {
      reviewTier: [] as string[],
      agentVerdict: [] as string[],
      qaReport: [] as string[],
    };
    const { io, writes } = fakeAutoIo(
      {
        1: [
          snapshot({ number: 1, mergeStateStatus: 'BEHIND' }),
          snapshot({ number: 1, mergeStateStatus: 'BEHIND' }),
          snapshot({ number: 1, headRefOid: UPDATED_HEAD }),
        ],
      },
      {
        reviewTierFact: (_pr, headRefOid) => {
          seen.reviewTier.push(headRefOid);
          return { status: 'read', tier: 'auto' };
        },
        agentVerdict: (_pr, headRefOid) => {
          seen.agentVerdict.push(headRefOid);
          return {
            status: 'read',
            verdict: 'approve',
            reviewedOid: headRefOid,
          };
        },
        qaReportFact: (_pr, headRefOid) => {
          seen.qaReport.push(headRefOid);
          return currentPassed(headRefOid);
        },
      },
    );
    const merges = recordMerges(io);
    const result = await runAutoTrain(autoArgs('on', [1]), io);

    assert.deepEqual(seen.reviewTier, [HEAD, UPDATED_HEAD]);
    assert.deepEqual(seen.agentVerdict, [HEAD, UPDATED_HEAD]);
    assert.deepEqual(seen.qaReport, [HEAD, UPDATED_HEAD]);
    assert.deepEqual(writes, ['update #1 @a', 'merge #1 @b merge']);
    assert.deepEqual(merges, [
      { pr: 1, headOid: UPDATED_HEAD, method: 'merge' },
    ]);
    assert.deepEqual(result.merged, [1]);
  });

  for (const [name, fact, reason] of [
    [
      'stale',
      {
        status: 'read',
        result: 'passed',
        commit: HEAD,
        leftForPerson: 0,
        staleness: { status: 'stale', byCommit: LATER },
      } as QaReportFact,
      `the QA Report is for \`${HEAD.slice(0, 8)}\`, and the branch commit \`${LATER.slice(0, 8)}\` came after it`,
    ],
    [
      'missing',
      {
        status: 'missing',
        reason: "the Pull Request's commits could not be read",
      } as QaReportFact,
      "the Pull Request's commits could not be read",
    ],
  ] as const) {
    test(`a QA Report ${name} at the updated head holds the merge with its reason, and nothing merges`, async () => {
      const { io, writes } = fakeAutoIo(
        {
          1: [
            snapshot({ number: 1, mergeStateStatus: 'BEHIND' }),
            snapshot({ number: 1, mergeStateStatus: 'BEHIND' }),
            snapshot({ number: 1, headRefOid: UPDATED_HEAD }),
          ],
        },
        {
          tier: 'auto',
          agentVerdict: (_pr, headRefOid) => ({
            status: 'read',
            verdict: 'approve',
            reviewedOid: headRefOid,
          }),
          qaReportFact: (_pr, headRefOid) =>
            headRefOid === HEAD ? currentPassed(HEAD) : fact,
        },
      );
      const merges = recordMerges(io);
      const result = await runAutoTrain(autoArgs('on', [1]), io);

      assert.deepEqual(writes, ['update #1 @a']);
      assert.deepEqual(merges, []);
      assert.deepEqual(result.merged, []);
      assert.deepEqual(result.held, [{ pr: 1, reason }]);
    });
  }

  test('an Agent Verdict that approved the pre-update head holds the candidate at the updated head, and nothing merges', async () => {
    const { io, writes } = fakeAutoIo(
      {
        1: [
          snapshot({ number: 1, mergeStateStatus: 'BEHIND' }),
          snapshot({ number: 1, mergeStateStatus: 'BEHIND' }),
          snapshot({ number: 1, headRefOid: UPDATED_HEAD }),
        ],
      },
      {
        tier: 'auto',
        agentVerdict: () => ({
          status: 'read',
          verdict: 'approve',
          reviewedOid: HEAD,
        }),
        qaReportFact: (_pr, headRefOid) => currentPassed(headRefOid),
      },
    );
    const merges = recordMerges(io);
    const result = await runAutoTrain(autoArgs('on', [1]), io);

    assert.deepEqual(writes, ['update #1 @a'], 'the pre-update head passed');
    assert.deepEqual(merges, []);
    assert.deepEqual(result.held, [
      {
        pr: 1,
        reason: `the Agent Verdict approved \`${HEAD.slice(0, 8)}\`, not the head \`${UPDATED_HEAD.slice(0, 8)}\``,
      },
    ]);
  });
});

describe('onMainFromCompare: whether a commit is on main, from gh api compare', () => {
  for (const stdout of ['behind', 'identical', 'behind\n', 'identical\n']) {
    test(`${JSON.stringify(stdout)} at status 0 means the commit is on main`, () => {
      assert.equal(onMainFromCompare({ status: 0, stdout }), true);
    });
  }

  for (const stdout of [
    'ahead',
    'diverged',
    'ahead\n',
    'diverged\n',
    'something else',
    '',
  ]) {
    test(`${JSON.stringify(stdout)} at status 0 means the commit is not on main`, () => {
      assert.equal(onMainFromCompare({ status: 0, stdout }), false);
    });
  }

  test('a nonzero status is unknown, whatever the text says', () => {
    assert.equal(onMainFromCompare({ status: 1, stdout: 'behind' }), null);
    assert.equal(onMainFromCompare({ status: 1, stdout: '' }), null);
  });
});

describe('qaReportFromView: a named commit, a main merge after it, and isOnMain unknown', () => {
  test('the report is missing with the could-not-be-checked reason, naming the second parent', () => {
    const fact = readQa(
      [qaComment(qaReportText(qaHeader('passed', OLDER_HEAD)))],
      {
        commits: () => [
          { sha: FORK, parents: [] },
          { sha: OLDER_HEAD, parents: [FORK] },
          { sha: HEAD, parents: [OLDER_HEAD, MAIN_SIDE] },
        ],
        isOnMain: () => null,
      },
    );
    assert.equal(fact.status, 'missing');
    assert.ok(
      fact.status === 'missing' &&
        fact.reason.includes('could not be checked whether') &&
        fact.reason.includes(MAIN_SIDE.slice(0, 8)),
      JSON.stringify(fact),
    );
    assert.deepEqual(fact, {
      status: 'missing',
      reason: `it could not be checked whether \`${MAIN_SIDE.slice(0, 8)}\` is on \`main\``,
    });
  });
});
