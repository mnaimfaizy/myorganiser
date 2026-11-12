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

import {
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
  autoMergeHolds,
  checksOnCurrentHead,
  decideAutoMerge,
  mainCiFromRuns,
  parseAutoMergeMode,
  readDoor,
  renderAutoTrainResult,
  renderShadowComment,
  runAutoTrain,
  type AutoMergeDecision,
  type AutoMergeFacts,
  type AutoMergeMode,
  type AutoTrainIo,
  type AutoTrainResult,
  type CheckRun,
  type MainCiFact,
  type MergeMethod,
  type PullRequestSnapshot,
  type ReviewTier,
  type ReviewTierFact,
} from './merge-train.ts';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
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
function missingReason(fact: ReviewTierFact): string {
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
}

const fakeAutoIo = (
  scripts: Record<number, (PullRequestSnapshot | null)[]>,
  {
    required = REQUIRED,
    clockStep = 30_000,
    mainCi = MAIN_GREEN,
    tier,
    commentRefusals = new Set<number>(),
  }: AutoFakeOptions = {},
) => {
  const reads = new Map<number, number>();
  const writes: string[] = [];
  const log: string[] = [];
  const comments = new Map<number, string>();
  const created: number[] = [];
  const counts = { read: 0, mainCi: 0 };
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
    reviewTier: () => (tier ? { status: 'read', tier } : UNREAD_REVIEW_TIER),
    agentVerdict: () => UNREAD_AGENT_VERDICT,
    qaReport: () => UNREAD_QA_REPORT,
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
