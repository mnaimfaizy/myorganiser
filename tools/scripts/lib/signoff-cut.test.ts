// Contract Suite for the Sign-off Issue at the Cut (ADR 0151 decisions 7 and
// 8): the freeze and its carry-forward, the trust a Cut runs on, the single
// write and its read-back, the Cut's printed result, and the close. Driven
// over an in-memory fake of the owner's issues: every accepted write is kept
// and read back, and a knob makes a write fail, drops it, or hides the read.
//
// Run with: node --test tools/scripts/lib/signoff-cut.test.ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type ClosePlan,
  type CutPlan,
  type CutResult,
  type CutPlanResult,
  executeClose,
  executeCut,
  planClose,
  planCut,
  closeExitCode,
  renderClose,
  renderCutPlan,
  renderCutResult,
  type SignOffCutIo,
} from './signoff-cut.ts';
import type { GateComment, GateIssue } from './signoff-gate.ts';
import {
  findSignOffIssue,
  parseSignOffIssue,
  renderCarriedComment,
  renderCarriedLine,
  renderFrozenSignOffIssue,
  renderSignOffFrozen,
  renderSignOffIssue,
  SIGNOFF_ISSUE_MARKER,
  SIGNOFF_ISSUE_TITLE,
  type SignOffCheck,
  type SignOffEntry,
  type SignOffIssueCandidate,
  type SignOffPlace,
  signOffCheckId,
  signOffFrozenTitle,
  signOffKey,
} from './signoff-issue.ts';

// ------------------------------------------------------------- fixtures

const OWNER = 'maintainer';
const COLLAB = 'collaborator';
const EARLIER = 'v1.0.0';
const NEXT = 'v1.1.0';
const ISSUE = 11;
const EARLY = 10;
const COMMENT_URL = 'https://github.test/comments/1';

interface Check {
  pr: number;
  place: SignOffPlace;
  text: string;
}
const STAGING: Check = {
  pr: 7,
  place: 'staging',
  text: 'Check the invoice email',
};
const PROD: Check = {
  pr: 7,
  place: 'production',
  text: 'Confirm the tax line',
};
const SIGNUP: Check = {
  pr: 8,
  place: 'staging',
  text: 'Check the signup mail',
};
const NEW: Check = { pr: 9, place: 'staging', text: 'Check the new banner' };

const keyOf = (c: Check): string => signOffKey(c.place, c.text);
const idOf = (c: Check): string => signOffCheckId(c.pr, keyOf(c));
const idsOf = (checks: readonly SignOffCheck[]): string[] =>
  checks.map((c) => signOffCheckId(c.pr, c.key));
const entryOf = (c: Check): SignOffEntry => ({
  pr: c.pr,
  place: c.place,
  text: c.text,
  reportUrl: COMMENT_URL,
});
const checkOf = (c: Check): SignOffCheck => ({
  ...entryOf(c),
  key: keyOf(c),
  checked: false,
});
const trailerOf = (c: Check): string =>
  `<!-- signoff-check pr=${c.pr} key=${keyOf(c)} -->`;

/** The body of an open, unfrozen Sign-off Issue holding `checks`. */
const openBody = (...checks: Check[]): string =>
  renderSignOffIssue(checks.map(entryOf));
/** The body of an issue frozen at `version`, holding `checks` as carried lines. */
const frozenBody = (version: string, ...checks: Check[]): string =>
  renderFrozenSignOffIssue(version, checks.map(checkOf));

/** `body` with the one check line for `c` ticked by its checkbox. */
const setTicked = (body: string, c: Check): string => {
  const from = `- [ ] [${c.place}] ${c.text} · `;
  const to = `- [x] [${c.place}] ${c.text} · `;
  assert.equal(body.split('\n').filter((l) => l.startsWith(from)).length, 1);
  return body
    .split('\n')
    .map((l) => (l.startsWith(from) ? to + l.slice(from.length) : l))
    .join('\n');
};

/** `body` with the one line carrying `c`'s trailer removed; nothing else changes. */
const withoutLine = (body: string, c: Check): string => {
  const lines = body.split('\n');
  const kept = lines.filter((l) => !l.endsWith(trailerOf(c)));
  assert.equal(lines.length - kept.length, 1, trailerOf(c));
  return kept.join('\n');
};

/** `body` with `from` replaced by `to`, where `from` occurs exactly once. */
const editText = (body: string, from: string, to: string): string => {
  assert.equal(body.split(from).length - 1, 1, from);
  return body.replace(from, to);
};

interface Rev {
  body: string;
  editor: string;
}

/** The Stored shape: a GateIssue plus the title the Cut reads back. */
interface Stored extends GateIssue {
  title: string;
}

/**
 * An issue whose edit history is `revisions`, oldest first; its body is the
 * newest revision. Revision `i` is stamped minute `i`.
 */
const historied = (
  number: number,
  revisions: Rev[],
  extra: Partial<Stored> = {},
): Stored => ({
  number,
  state: 'OPEN',
  author: { login: OWNER },
  title: SIGNOFF_ISSUE_TITLE,
  body: revisions[revisions.length - 1].body,
  edits: {
    totalCount: revisions.length,
    nodes: revisions
      .map((r, i) => ({
        editedAt: at(i),
        deletedAt: null,
        editor: { login: r.editor },
        diff: r.body,
      }))
      .reverse(),
  },
  comments: { totalCount: 0, nodes: [] },
  ...extra,
});

const T0 = Date.parse('2026-06-01T00:00:00Z');
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

/** A comment the owner wrote, as the GraphQL node reads it: OWNER, unedited, not minimised. */
const ownerComment = (
  body: string,
  overrides: Partial<GateComment> = {},
): GateComment => ({
  author: { login: OWNER },
  authorAssociation: 'OWNER',
  body,
  isMinimized: false,
  lastEditedAt: null,
  ...overrides,
});

const withComments = (issue: Stored, ...nodes: GateComment[]): Stored => ({
  ...issue,
  comments: { totalCount: nodes.length, nodes },
});

const waiveLine = (c: Check): string =>
  `waive: ${idOf(c)} — accepted on staging`;

/** An earlier Cut's issue: open, frozen for `version`, holding `checks` unticked. */
const earlierIssue = (
  checks: Check[],
  version = EARLIER,
  number = EARLY,
): Stored =>
  historied(number, [{ body: frozenBody(version, ...checks), editor: OWNER }]);

/** The open unfrozen issue the Cut freezes, holding `checks`. */
const openIssue = (checks: Check[], number = ISSUE): Stored =>
  historied(number, [{ body: openBody(...checks), editor: OWNER }]);

/** An issue frozen for `version`, holding `checks`, in `state`. */
const frozenFor = (
  number: number,
  checks: Check[],
  state: 'OPEN' | 'CLOSED' = 'OPEN',
  version = NEXT,
): Stored =>
  historied(number, [{ body: frozenBody(version, ...checks), editor: OWNER }], {
    state,
  });

// ------------------------------------------------------------- write fake

interface Knobs {
  viewer?: string | null;
  owner?: { __typename: string; login: string };
  /** Whether each version's tag is on origin; a version not listed reads as not released. */
  released?: Record<string, boolean | null>;
  /** Reads of the issues return null. */
  hideIssues?: boolean;
  /** Reads of a title return null. */
  hideTitle?: boolean;
  /** Writes of an issue body or title are refused and stored nothing. */
  refuseUpdate?: boolean;
  /** Body and title writes are accepted but nothing is stored. */
  dropUpdate?: boolean;
  /** Body writes are stored; title writes are accepted but nothing is stored. */
  dropTitle?: boolean;
  /** A line of the written body for which this is true is not kept. */
  stripLine?: (line: string) => boolean;
  /** The first body write is accepted but not stored, and leaves no revision. */
  dropFirstUpdate?: boolean;
  /** The first body write is refused, after `onFirstUpdate` has changed the store. */
  refuseFirstUpdate?: boolean;
  /** Runs before the first body write, with the store as it is then. */
  onFirstUpdate?: (store: Stored[]) => void;
  refuseCreate?: boolean;
  /** The issue is created and kept, but its number is not returned. */
  createNumberLost?: boolean;
  /** The issue is created with its number returned, but the frozen line is not kept. */
  createReadsUnfrozen?: boolean;
  refuseComment?: boolean;
  /** The comment is accepted but not kept. */
  dropComment?: boolean;
  refuseClose?: boolean;
  /** The close is accepted but the issue stays open. */
  dropClose?: boolean;
}

interface Fake {
  io: SignOffCutIo;
  store: Stored[];
  /** Every mutating call, in order: `update #n`, `create`, `comment #n`, `close #n`. */
  calls: string[];
}

function fakeGitHub(seed: Stored[], knobs: Knobs = {}): Fake {
  const store: Stored[] = structuredClone(seed);
  const calls: string[] = [];
  let minute = 1000;
  const stamp = (): string => {
    minute += 1;
    return at(minute);
  };
  const viewer = knobs.viewer === undefined ? OWNER : knobs.viewer;
  const owner = knobs.owner ?? { __typename: 'User', login: OWNER };
  const find = (n: number): Stored | undefined =>
    store.find((i) => i.number === n);
  let droppedOnce = false;
  let bodyWrites = 0;

  const editsWith = (issue: Stored, body: string, editor: string | null) => ({
    totalCount: (issue.edits?.totalCount ?? 0) + 1,
    nodes: [
      {
        editedAt: stamp(),
        deletedAt: null,
        editor: { login: editor },
        diff: body,
      },
      ...(issue.edits?.nodes ?? []),
    ],
  });

  const io: SignOffCutIo = {
    read: () => ({
      owner,
      viewer,
      issues: knobs.hideIssues ? null : structuredClone(store),
    }),
    readTitle: (n) => (knobs.hideTitle ? null : (find(n)?.title ?? null)),
    isReleased: (version) =>
      knobs.released && version in knobs.released
        ? knobs.released[version]
        : false,
    updateIssue: (n, change) => {
      calls.push(`update #${n}`);
      bodyWrites += 1;
      if (bodyWrites === 1) knobs.onFirstUpdate?.(store);
      const target = find(n);
      if (!target || knobs.refuseUpdate) return false;
      if (bodyWrites === 1 && knobs.refuseFirstUpdate) return false;
      if (knobs.dropUpdate) return true;
      if (knobs.dropFirstUpdate && !droppedOnce) {
        droppedOnce = true;
        return true;
      }
      const stored = knobs.stripLine
        ? change.body
            .split('\n')
            .filter((line) => !knobs.stripLine?.(line))
            .join('\n')
        : change.body;
      target.body = stored;
      if (!knobs.dropTitle) target.title = change.title;
      target.edits = editsWith(target, stored, viewer);
      return true;
    },
    createIssue: ({ title, body }) => {
      calls.push('create');
      if (knobs.refuseCreate) return null;
      const number = Math.max(0, ...store.map((i) => i.number)) + 1;
      const kept = knobs.createReadsUnfrozen
        ? body
            .split('\n')
            .filter((line) => !line.startsWith('<!-- signoff-frozen'))
            .join('\n')
        : body;
      store.push({
        number,
        state: 'OPEN',
        author: { login: viewer },
        title,
        body: kept,
        edits: {
          totalCount: 1,
          nodes: [
            {
              editedAt: stamp(),
              deletedAt: null,
              editor: { login: viewer },
              diff: kept,
            },
          ],
        },
        comments: { totalCount: 0, nodes: [] },
      });
      return knobs.createNumberLost ? null : number;
    },
    comment: (n, body) => {
      calls.push(`comment #${n}`);
      const target = find(n);
      if (!target || knobs.refuseComment) return false;
      if (knobs.dropComment) return true;
      const nodes = [
        ...(target.comments?.nodes ?? []),
        ownerComment(body, { author: { login: viewer } }),
      ];
      target.comments = { totalCount: nodes.length, nodes };
      return true;
    },
    close: (n) => {
      calls.push(`close #${n}`);
      const target = find(n);
      if (!target || knobs.refuseClose) return false;
      if (!knobs.dropClose) target.state = 'CLOSED';
      return true;
    },
  };
  return { io, store, calls };
}

function storedIssue(fake: Fake, number: number): Stored {
  const found = fake.store.find((i) => i.number === number);
  if (!found) assert.fail(`no issue #${number} in the store`);
  return found;
}

/** The open issues as `gh issue list` returns them, for the train's lookup. */
const openCandidates = (fake: Fake): SignOffIssueCandidate[] =>
  fake.store
    .filter((i) => i.state === 'OPEN')
    .map((i) => ({ number: i.number, body: i.body, author: i.author }));

function planned(result: CutPlanResult): CutPlan {
  if (result.status === 'refused')
    assert.fail(`expected a plan, got refused: ${result.reason}`);
  return result.plan;
}

/**
 * The last line `release:cut` prints for a Cut whose freeze did not hold: it
 * must say the release branch was not pushed, and name the version.
 */
function assertNotPushed(version: string, result: CutResult): void {
  assert.equal(result.ok, false);
  const last = renderCutResult(version, result).at(-1) ?? '';
  assert.match(last, /NOT pushed/);
  assert.ok(last.includes(version), last);
}

/** The reason a Cut or close plan refused. */
function reasonOf(result: CutPlanResult | ClosePlan): string {
  if (result.status !== 'refused')
    assert.fail(`expected refused, got ${JSON.stringify(result)}`);
  return result.reason;
}

// ------------------------------------------------------------ freeze

describe('freezing the open issue (planCut, executeCut)', () => {
  // 1
  test('an open unfrozen issue is frozen in one write: retitled, the frozen line after the marker, and every other line, tick and CRLF ending kept', () => {
    const unfrozen = setTicked(openBody(STAGING, PROD), STAGING).replace(
      /\n/g,
      '\r\n',
    );
    const fake = fakeGitHub([
      historied(ISSUE, [{ body: unfrozen, editor: OWNER }]),
    ]);
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.equal(result.issue, ISSUE);
    assert.equal(result.created, false);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);

    const lines = unfrozen.split('\r\n');
    const stored = storedIssue(fake, ISSUE);
    // Every line of the old body is kept exactly, with the frozen line inserted after the marker.
    assert.equal(
      stored.body,
      [lines[0], renderSignOffFrozen(NEXT), ...lines.slice(1)].join('\r\n'),
    );
    assert.equal(stored.title, signOffFrozenTitle(NEXT));
    const parsed = parseSignOffIssue(stored.body);
    assert.deepEqual(parsed?.frozen, { version: NEXT });
    assert.deepEqual(
      parsed?.checks.map((c) => c.checked),
      [true, false],
    );
  });

  // 2
  test('a dry run plans the freeze and the carry, prints both, and writes nothing', () => {
    const fake = fakeGitHub([earlierIssue([STAGING, PROD]), openIssue([NEW])], {
      released: { [EARLIER]: false },
    });
    const plan = planned(planCut(fake.io, NEXT));
    assert.deepEqual(renderCutPlan(plan), [
      'would freeze Sign-off Issue #11 for v1.1.0: retitle it "Sign-off: Person Checks for v1.1.0" and add the frozen line',
      'would carry 2 unfinished Person Checks from #10 (v1.0.0, never released) and comment on it where they went',
    ]);
    assert.deepEqual(fake.calls, []);
  });

  // 3
  test('no open issue and nothing to carry: the Cut targets none, reports ok, writes nothing, and says why', () => {
    const fake = fakeGitHub([]);
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.equal(result.issue, null);
    assert.equal(result.created, false);
    assert.deepEqual(result.carried, []);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.notes, [
      'no open Sign-off Issue and nothing to carry, so no Sign-off Issue was frozen',
    ]);
    assert.deepEqual(fake.calls, []);
  });

  // 4
  test('a version frozen on exactly one issue is a re-run: planned as frozen with nothing carried, nothing written, ok true, whether the issue is open or closed', () => {
    for (const state of ['OPEN', 'CLOSED'] as const) {
      const fake = fakeGitHub([frozenFor(12, [NEW], state)]);
      const plan = planned(planCut(fake.io, NEXT));
      assert.deepEqual(plan.target, { kind: 'frozen', number: 12 }, state);
      assert.deepEqual(plan.carry, [], state);
      assert.deepEqual(
        plan.notes,
        [
          'Sign-off Issue #12 is already frozen for v1.1.0, so nothing was written to it',
        ],
        state,
      );
      const result = executeCut(fake.io, NEXT);
      assert.equal(result.ok, true, state);
      assert.equal(result.issue, 12, state);
      assert.equal(result.created, false, state);
      assert.deepEqual(fake.calls, [], state);
    }
  });

  // 4b
  test('a re-run prints the frozen issue and its note; a dry run prints the note alone; neither says the branch was not pushed', () => {
    const fake = fakeGitHub([frozenFor(12, [NEW])]);
    assert.deepEqual(renderCutPlan(planned(planCut(fake.io, NEXT))), [
      'note: Sign-off Issue #12 is already frozen for v1.1.0, so nothing was written to it',
    ]);
    const lines = renderCutResult(NEXT, executeCut(fake.io, NEXT));
    assert.deepEqual(lines, [
      'Sign-off Issue #12 frozen for v1.1.0.',
      'Note: Sign-off Issue #12 is already frozen for v1.1.0, so nothing was written to it.',
    ]);
    assert.equal(
      lines.some((l) => l.includes('NOT pushed')),
      false,
    );
    assert.deepEqual(fake.calls, []);
  });

  // 4c
  test('two issues frozen for the version, or a history that froze it while the current line says another version, refuse the Cut with the naming reason, and the branch is not pushed', () => {
    const twoIssues = fakeGitHub([
      frozenFor(12, [NEW]),
      frozenFor(13, [SIGNUP], 'CLOSED'),
    ]);
    assert.equal(
      reasonOf(planCut(twoIssues.io, NEXT)),
      'a Sign-off Issue is already frozen for v1.1.0, but not as one issue still frozen for it (#12, #13)',
    );
    const twoResult = executeCut(twoIssues.io, NEXT);
    assertNotPushed(NEXT, twoResult);
    assert.deepEqual(twoIssues.calls, []);

    const rewritten = fakeGitHub([
      historied(12, [
        { body: frozenBody(NEXT, NEW), editor: OWNER },
        { body: frozenBody('v1.0.9', NEW), editor: OWNER },
      ]),
    ]);
    assert.equal(
      reasonOf(planCut(rewritten.io, NEXT)),
      'a Sign-off Issue is already frozen for v1.1.0, but not as one issue still frozen for it (#12)',
    );
    assert.deepEqual(rewritten.calls, []);
  });

  // 4d
  test('a closed issue left unfrozen with a staging check neither ticked nor waived gets a note, with no refusal or write; a ticked one gets none', () => {
    const closedOpen = historied(
      12,
      [{ body: openBody(STAGING), editor: OWNER }],
      { state: 'CLOSED' },
    );
    const note = `closed, unfrozen Sign-off Issue #12 still has a \`staging\` Person Check neither ticked nor waived, which holds every production deploy until it is ticked or waived`;
    const fake = fakeGitHub([openIssue([NEW]), closedOpen]);
    assert.deepEqual(planned(planCut(fake.io, NEXT)).notes, [note]);
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.ok(result.notes.includes(note));
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);

    const ticked = fakeGitHub([
      openIssue([NEW]),
      historied(
        12,
        [{ body: setTicked(openBody(STAGING), STAGING), editor: OWNER }],
        { state: 'CLOSED' },
      ),
    ]);
    assert.deepEqual(planned(planCut(ticked.io, NEXT)).notes, []);
  });

  // 5
  test('two open unfrozen Sign-off Issues refuse the Cut, naming both, and nothing is written', () => {
    const fake = fakeGitHub([openIssue([NEW]), openIssue([SIGNUP], 12)]);
    assert.equal(
      reasonOf(planCut(fake.io, NEXT)),
      'more than one Sign-off Issue is open and unfrozen (#11, #12)',
    );
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, false);
    assert.deepEqual(fake.calls, []);
  });

  // 6
  test('an issue whose body is not in the fixed form refuses the Cut, and nothing is written', () => {
    const fake = fakeGitHub([
      historied(ISSUE, [
        {
          body: `${SIGNOFF_ISSUE_MARKER}\n\nNo checks section here.`,
          editor: OWNER,
        },
      ]),
    ]);
    assert.match(
      reasonOf(planCut(fake.io, NEXT)),
      /the body of #11 is not in the Sign-off Issue's fixed form/,
    );
    assert.deepEqual(fake.calls, []);
  });

  // 7
  test('a truncated edit history, or a deleted revision, refuses the Cut', () => {
    const body = openBody(NEW);
    const node = {
      editedAt: at(0),
      deletedAt: null,
      editor: { login: OWNER },
      diff: body,
    };
    const cases: [string, Stored, RegExp][] = [
      [
        'truncated',
        { ...openIssue([NEW]), edits: { totalCount: 2, nodes: [node] } },
        /was not read whole \(1 of 2 revisions\)/,
      ],
      [
        'deleted revision',
        {
          ...openIssue([NEW]),
          edits: {
            totalCount: 1,
            nodes: [{ ...node, deletedAt: at(1) }],
          },
        },
        /was deleted from its history/,
      ],
    ];
    for (const [why, issue, reason] of cases) {
      const fake = fakeGitHub([issue]);
      assert.match(reasonOf(planCut(fake.io, NEXT)), reason, why);
      assert.deepEqual(fake.calls, [], why);
    }
  });

  // 8
  test('comments not read whole, or a null comment list, refuse the Cut', () => {
    const cases: [string, Stored][] = [
      [
        'a truncated comment list',
        {
          ...openIssue([NEW]),
          comments: { totalCount: 2, nodes: [ownerComment('A note.')] },
        },
      ],
      ['a null comment list', { ...openIssue([NEW]), comments: null }],
    ];
    for (const [why, issue] of cases) {
      const fake = fakeGitHub([issue]);
      assert.match(
        reasonOf(planCut(fake.io, NEXT)),
        /the comments on #11 could not be read whole/,
        why,
      );
      assert.deepEqual(fake.calls, [], why);
    }
  });

  // 9
  test('issues that could not be read at all refuse the Cut', () => {
    const fake = fakeGitHub([openIssue([NEW])], { hideIssues: true });
    assert.match(reasonOf(planCut(fake.io, NEXT)), /could not be read whole/);
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, false);
    assert.deepEqual(fake.calls, []);
  });

  // 10
  test('an issue unfrozen now whose history once froze it refuses the Cut, since its frozen line was removed', () => {
    const fake = fakeGitHub([
      historied(ISSUE, [
        { body: frozenBody('v1.0.9', NEW), editor: OWNER },
        { body: openBody(NEW), editor: OWNER },
      ]),
    ]);
    assert.equal(
      reasonOf(planCut(fake.io, NEXT)),
      'the frozen line of #11 was removed after it was written',
    );
    assert.deepEqual(fake.calls, []);
  });

  // 11
  test('a version that is not vX.Y.Z is refused before any read, and executeCut writes nothing', () => {
    const fake = fakeGitHub([openIssue([NEW])]);
    assert.match(
      reasonOf(planCut(fake.io, '1.1.0')),
      /`1\.1\.0` is not a release version/,
    );
    const result = executeCut(fake.io, '1.1.0');
    assert.equal(result.ok, false);
    assert.deepEqual(fake.calls, []);
  });
});

// ------------------------------------------------------- trust and candidates

describe('the trust a Cut runs on (planCut, executeCut)', () => {
  // 12
  test('a viewer who is not the repository owner refuses the plan; the dry run and executeCut both write nothing', () => {
    const fake = fakeGitHub([openIssue([NEW])], { viewer: COLLAB });
    assert.match(reasonOf(planCut(fake.io, NEXT)), /run it as the owner$/);
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, false);
    assert.match(result.failures[0], /run it as the owner/);
    assert.deepEqual(fake.calls, []);
  });

  // 13
  test('a repository owner that is not a single User, or has an empty login, refuses the Cut', () => {
    const owners = [
      { __typename: 'Organization', login: OWNER },
      { __typename: 'User', login: '' },
    ];
    for (const owner of owners) {
      const fake = fakeGitHub([openIssue([NEW])], { owner });
      assert.match(
        reasonOf(planCut(fake.io, NEXT)),
        /not a single user login/,
        owner.__typename,
      );
      assert.deepEqual(fake.calls, [], owner.__typename);
    }
  });

  // 13b
  test('a viewer whose login could not be read refuses the plan, and executeCut writes nothing', () => {
    const fake = fakeGitHub([openIssue([NEW])], { viewer: null });
    assert.match(reasonOf(planCut(fake.io, NEXT)), /a login it could not read/);
    const result = executeCut(fake.io, NEXT);
    assert.match(result.failures[0], /a login it could not read/);
    assert.deepEqual(fake.calls, []);
    assertNotPushed(NEXT, result);
  });

  // 14
  test('an issue another login wrote, with the marker, is never frozen and never a carry source', () => {
    const foreignFrozen: Stored = {
      ...earlierIssue([STAGING]),
      author: { login: COLLAB },
    };
    const foreignOpen: Stored = {
      ...openIssue([SIGNUP], 12),
      author: { login: COLLAB },
    };
    const fake = fakeGitHub([foreignFrozen, foreignOpen, openIssue([NEW])], {
      released: { [EARLIER]: false },
    });
    const plan = planned(planCut(fake.io, NEXT));
    if (plan.target.kind !== 'freeze') assert.fail('expected a freeze');
    assert.equal(plan.target.number, ISSUE);
    assert.deepEqual(plan.carry, []);
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
  });

  // 15
  test('a closed earlier issue frozen for an earlier version is not a carry source', () => {
    const fake = fakeGitHub(
      [{ ...earlierIssue([STAGING]), state: 'CLOSED' }, openIssue([NEW])],
      { released: { [EARLIER]: false } },
    );
    const plan = planned(planCut(fake.io, NEXT));
    assert.deepEqual(plan.carry, []);
    assert.equal(executeCut(fake.io, NEXT).ok, true);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
  });

  // 16
  test('an open issue frozen for a later version is not a carry source', () => {
    const fake = fakeGitHub(
      [earlierIssue([STAGING], 'v9.0.0'), openIssue([NEW])],
      { released: { 'v9.0.0': false } },
    );
    const plan = planned(planCut(fake.io, NEXT));
    assert.deepEqual(plan.carry, []);
    assert.equal(executeCut(fake.io, NEXT).ok, true);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
  });
});

// --------------------------------------------------------- the next lookup

describe('the train after a freeze (findSignOffIssue over the Cut result)', () => {
  // 17
  test('after the freeze, the train finds no open unfrozen issue, so its next write creates a fresh one', () => {
    const fake = fakeGitHub([openIssue([NEW])]);
    assert.equal(executeCut(fake.io, NEXT).ok, true);
    assert.deepEqual(findSignOffIssue(openCandidates(fake), OWNER), {
      status: 'none',
    });
  });

  // 18
  test('two open unfrozen matches are still unreadable to the train, naming both', () => {
    const fake = fakeGitHub([openIssue([NEW]), openIssue([SIGNUP], 12)]);
    assert.deepEqual(findSignOffIssue(openCandidates(fake), OWNER), {
      status: 'unreadable',
      reason: 'more than one Sign-off Issue is open (#11, #12)',
    });
  });
});

// ------------------------------------------------------------- carry

describe('carrying unfinished checks (planCut, executeCut)', () => {
  // 19
  test('unfinished staging and production checks of an earlier unreleased Cut are carried unticked into the one write that freezes the new issue, and the earlier issue is commented', () => {
    const fake = fakeGitHub([earlierIssue([STAGING, PROD]), openIssue([NEW])], {
      released: { [EARLIER]: false },
    });
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.deepEqual(result.carried, [
      { from: EARLY, ids: [idOf(STAGING), idOf(PROD)] },
    ]);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`, `comment #${EARLY}`]);

    const parsed = parseSignOffIssue(storedIssue(fake, ISSUE).body);
    assert.deepEqual(parsed?.frozen, { version: NEXT });
    assert.deepEqual(
      parsed?.checks.map((c) => [c.checked, signOffCheckId(c.pr, c.key)]),
      [
        [false, idOf(NEW)],
        [false, idOf(STAGING)],
        [false, idOf(PROD)],
      ],
    );
    const note = storedIssue(fake, EARLY).comments?.nodes.at(-1)?.body;
    assert.equal(
      note,
      renderCarriedComment(ISSUE, NEXT, [idOf(STAGING), idOf(PROD)]),
    );
  });

  // 20
  test('a carried check keeps its original key when its visible text was edited after it was rendered', () => {
    const edited = editText(
      frozenBody(EARLIER, STAGING),
      STAGING.text,
      'Check the invoice email, reworded',
    );
    const fake = fakeGitHub(
      [historied(EARLY, [{ body: edited, editor: OWNER }]), openIssue([NEW])],
      { released: { [EARLIER]: false } },
    );
    const result = executeCut(fake.io, NEXT);
    assert.deepEqual(result.carried, [{ from: EARLY, ids: [idOf(STAGING)] }]);
    const body = storedIssue(fake, ISSUE).body ?? '';
    assert.ok(
      body.includes('[staging] Check the invoice email, reworded · #7 '),
    );
    assert.ok(body.includes(trailerOf(STAGING)));
    assert.notEqual(
      signOffKey('staging', 'Check the invoice email, reworded'),
      keyOf(STAGING),
    );
  });

  // 21
  test('a check the owner ticked, one the owner waived, and one another login ticked: only the last is carried', () => {
    const rev1 = frozenBody(EARLIER, STAGING, PROD, SIGNUP);
    const rev2 = setTicked(rev1, STAGING);
    const rev3 = setTicked(rev2, SIGNUP);
    const early = withComments(
      historied(EARLY, [
        { body: rev1, editor: OWNER },
        { body: rev2, editor: OWNER },
        { body: rev3, editor: COLLAB },
      ]),
      ownerComment(waiveLine(PROD)),
    );
    const plan = planned(
      planCut(
        fakeGitHub([early, openIssue([NEW])], {
          released: { [EARLIER]: false },
        }).io,
        NEXT,
      ),
    );
    assert.deepEqual(idsOf(plan.carry.flatMap((s) => s.checks)), [
      idOf(SIGNUP),
    ]);
  });

  // 22
  test('a waiver by another login, an edited waiver, or a minimised waiver does not stop a carry', () => {
    const variants: [string, Partial<GateComment>][] = [
      ['by another login', { author: { login: COLLAB } }],
      ['edited after it was written', { lastEditedAt: at(5) }],
      ['minimised', { isMinimized: true }],
    ];
    for (const [why, override] of variants) {
      const early = withComments(
        earlierIssue([STAGING]),
        ownerComment(waiveLine(STAGING), override),
      );
      const plan = planned(
        planCut(
          fakeGitHub([early, openIssue([NEW])], {
            released: { [EARLIER]: false },
          }).io,
          NEXT,
        ),
      );
      assert.deepEqual(
        idsOf(plan.carry.flatMap((s) => s.checks)),
        [idOf(STAGING)],
        why,
      );
    }
  });

  // 23
  test('a removed line and a check text holding <!-- are not carried, and each produces a note', () => {
    const rev1 = frozenBody(EARLIER, STAGING, PROD, SIGNUP);
    const rev2 = withoutLine(
      editText(rev1, SIGNUP.text, 'Check <!-- the signup mail'),
      PROD,
    );
    const fake = fakeGitHub(
      [
        historied(EARLY, [
          { body: rev1, editor: OWNER },
          { body: rev2, editor: OWNER },
        ]),
        openIssue([NEW]),
      ],
      { released: { [EARLIER]: false } },
    );
    const plan = planned(planCut(fake.io, NEXT));
    assert.deepEqual(idsOf(plan.carry.flatMap((s) => s.checks)), [
      idOf(STAGING),
    ]);
    assert.deepEqual(plan.notes, [
      `#10: a Person Check whose text holds \`<!--\` or \`-->\` was not carried: ${idOf(SIGNUP)}`,
      `#10: a Person Check removed from the issue was not carried: ${idOf(PROD)} (${PROD.text})`,
    ]);
  });

  // 23b
  test('a removed check that its owner waived is carried by no one and produces no note', () => {
    const rev1 = frozenBody(EARLIER, STAGING, PROD);
    const early = withComments(
      historied(EARLY, [
        { body: rev1, editor: OWNER },
        { body: withoutLine(rev1, PROD), editor: OWNER },
      ]),
      ownerComment(waiveLine(PROD)),
    );
    const plan = planned(
      planCut(
        fakeGitHub([early, openIssue([NEW])], {
          released: { [EARLIER]: false },
        }).io,
        NEXT,
      ),
    );
    assert.deepEqual(idsOf(plan.carry.flatMap((s) => s.checks)), [
      idOf(STAGING),
    ]);
    assert.deepEqual(plan.notes, []);
  });

  // 24
  test('a check in two earlier issues is carried once, and a check the new issue already holds is not added twice', () => {
    const fake = fakeGitHub(
      [
        earlierIssue([STAGING, PROD]),
        earlierIssue([STAGING], 'v1.0.5', 12),
        openIssue([STAGING, NEW]),
      ],
      { released: { [EARLIER]: false, 'v1.0.5': false } },
    );
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.carried.flatMap((c) => c.ids),
      [idOf(STAGING), idOf(PROD)],
    );
    const body = storedIssue(fake, ISSUE).body ?? '';
    assert.equal(body.split(`key=${keyOf(STAGING)} -->`).length - 1, 1);
    assert.equal(body.split(`key=${keyOf(PROD)} -->`).length - 1, 1);
  });

  // 25
  test('an earlier issue released by its tag carries nothing', () => {
    const fake = fakeGitHub([earlierIssue([STAGING]), openIssue([NEW])], {
      released: { [EARLIER]: true },
    });
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.deepEqual(result.carried, []);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
  });

  // 26
  test('an earlier issue whose release cannot be read carries nothing, and the Cut says so', () => {
    const fake = fakeGitHub([earlierIssue([STAGING]), openIssue([NEW])], {
      released: { [EARLIER]: null },
    });
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.deepEqual(result.carried, []);
    assert.deepEqual(result.notes, [
      'could not tell whether v1.0.0 was released, so nothing was carried from #10',
    ]);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
  });

  // 26b
  test('an earlier issue whose every check is ticked by the owner has nothing to carry: no carry entry, no comment, and no Carried line', () => {
    const rev1 = frozenBody(EARLIER, STAGING);
    const fake = fakeGitHub(
      [
        historied(EARLY, [
          { body: rev1, editor: OWNER },
          { body: setTicked(rev1, STAGING), editor: OWNER },
        ]),
        openIssue([NEW]),
      ],
      { released: { [EARLIER]: false } },
    );
    assert.deepEqual(planned(planCut(fake.io, NEXT)).carry, []);
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.deepEqual(result.carried, []);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
    assert.equal(
      renderCutResult(NEXT, result).some((l) => l.startsWith('Carried')),
      false,
    );
  });

  // 27
  test('with no open unfrozen issue, a carry creates one already frozen for the version, holding the carried lines, and comments on the earlier issue', () => {
    const fake = fakeGitHub([earlierIssue([STAGING, PROD])], {
      released: { [EARLIER]: false },
    });
    const result = executeCut(fake.io, NEXT);
    assert.deepEqual(result, {
      ok: true,
      issue: ISSUE,
      created: true,
      carried: [{ from: EARLY, ids: [idOf(STAGING), idOf(PROD)] }],
      notes: [],
      failures: [],
    });
    assert.deepEqual(fake.calls, ['create', `comment #${EARLY}`]);
    const created = storedIssue(fake, ISSUE);
    assert.equal(created.title, signOffFrozenTitle(NEXT));
    const parsed = parseSignOffIssue(created.body);
    assert.deepEqual(parsed?.frozen, { version: NEXT });
    assert.deepEqual(idsOf(parsed?.checks ?? []), [idOf(STAGING), idOf(PROD)]);
  });

  // 28
  test('a create whose number is not returned is found by its read-back, frozen, and the Cut holds', () => {
    const fake = fakeGitHub([earlierIssue([STAGING])], {
      released: { [EARLIER]: false },
      createNumberLost: true,
    });
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.equal(result.issue, ISSUE);
    assert.equal(result.created, true);
    assert.deepEqual(fake.calls, ['create', `comment #${EARLY}`]);
  });

  // 29
  test('a create that did not happen fails with the body to paste, and no comment is posted on the earlier issue', () => {
    const fake = fakeGitHub([earlierIssue([STAGING, PROD])], {
      released: { [EARLIER]: false },
      refuseCreate: true,
    });
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, false);
    assert.equal(result.issue, null);
    assert.deepEqual(fake.calls, ['create']);
    assert.equal(result.failures.length, 1);
    assert.match(
      result.failures[0],
      /could not be created or read back as frozen\. Otherwise create it by hand/,
    );
    assertNotPushed(NEXT, result);
    assert.doesNotMatch(result.failures[0], /may exist/);
    assertNotPushed(NEXT, result);
    assert.ok(
      result.failures[0].includes(
        renderFrozenSignOffIssue(NEXT, [checkOf(STAGING), checkOf(PROD)]),
      ),
    );
  });

  // 29b
  test('a create that returned a number but does not read back frozen tells the Maintainer the issue may exist, and creates nothing more', () => {
    const fake = fakeGitHub([earlierIssue([STAGING, PROD])], {
      released: { [EARLIER]: false },
      createReadsUnfrozen: true,
    });
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, false);
    assert.equal(result.issue, null);
    assert.deepEqual(fake.calls, ['create']);
    assert.equal(result.failures.length, 1);
    assert.ok(
      result.failures[0].includes(
        `(#${ISSUE} may exist: check it first, and freeze it rather than create a second)`,
      ),
    );
    assertNotPushed(NEXT, result);
    assert.ok(
      result.failures[0].includes(
        renderFrozenSignOffIssue(NEXT, [checkOf(STAGING), checkOf(PROD)]),
      ),
    );
  });
});

// ---------------------------------------------------------- carry marker

describe('the carry marker on an earlier issue (planCut)', () => {
  // 30
  test("an owner's carry marker on an earlier issue stops a later Cut re-carrying from it, so checks ticked in the newer issue are not resurrected", () => {
    const early = withComments(
      earlierIssue([STAGING]),
      ownerComment(renderCarriedComment(ISSUE, NEXT, [idOf(STAGING)])),
    );
    const target = historied(ISSUE, [
      { body: setTicked(openBody(STAGING), STAGING), editor: OWNER },
    ]);
    const fake = fakeGitHub([early, target], {
      released: { [EARLIER]: false },
    });
    assert.deepEqual(planned(planCut(fake.io, NEXT)).carry, []);
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, true);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
  });

  // 31
  test('a marker by another author, by a non-OWNER association, edited, or minimised does not stop the carry', () => {
    const variants: [string, Partial<GateComment>][] = [
      ['by another author', { author: { login: COLLAB } }],
      ['by a non-OWNER association', { authorAssociation: 'MEMBER' }],
      ['edited', { lastEditedAt: at(5) }],
      ['minimised', { isMinimized: true }],
    ];
    for (const [why, override] of variants) {
      const early = withComments(
        earlierIssue([STAGING]),
        ownerComment(
          renderCarriedComment(ISSUE, NEXT, [idOf(STAGING)]),
          override,
        ),
      );
      const plan = planned(
        planCut(
          fakeGitHub([early, openIssue([NEW])], {
            released: { [EARLIER]: false },
          }).io,
          NEXT,
        ),
      );
      assert.deepEqual(
        idsOf(plan.carry.flatMap((s) => s.checks)),
        [idOf(STAGING)],
        why,
      );
    }
  });
});

// ------------------------------------------------------- writes and order

describe('writes, read-backs and retries (executeCut)', () => {
  // 32
  test('a freeze write refused is attempted once: ok false, the manual steps naming the carried lines, no comment on an earlier issue, and the branch not pushed', () => {
    const fake = fakeGitHub([earlierIssue([STAGING]), openIssue([NEW])], {
      released: { [EARLIER]: false },
      refuseUpdate: true,
    });
    const before = storedIssue(fake, ISSUE);
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.issue, null);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /Freeze it by hand/);
    assert.ok(result.failures[0].includes(renderCarriedLine(checkOf(STAGING))));
    assert.equal(storedIssue(fake, ISSUE).body, before.body);
    assert.equal(storedIssue(fake, ISSUE).title, before.title);
    assertNotPushed(NEXT, result);
  });

  // 33
  test('a write accepted but read back without the frozen line or without the title fails the freeze after one write, with no comment on an earlier issue, and the branch not pushed', () => {
    const cases: [string, Knobs][] = [
      ['the body not stored', { dropUpdate: true }],
      ['the title not stored', { dropTitle: true }],
    ];
    for (const [why, knobs] of cases) {
      const fake = fakeGitHub([earlierIssue([STAGING]), openIssue([NEW])], {
        released: { [EARLIER]: false },
        ...knobs,
      });
      const result = executeCut(fake.io, NEXT);
      assert.equal(result.ok, false, why);
      assert.match(result.failures[0], /Freeze it by hand/, why);
      assert.deepEqual(fake.calls, [`update #${ISSUE}`], why);
      assertNotPushed(NEXT, result);
    }
  });

  // 34
  test('a write accepted without a carried check line fails the freeze, and no comment is posted', () => {
    const fake = fakeGitHub([earlierIssue([STAGING]), openIssue([NEW])], {
      released: { [EARLIER]: false },
      stripLine: (line) => line.endsWith(trailerOf(STAGING)),
    });
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, false);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
    assert.ok(result.failures[0].includes(renderCarriedLine(checkOf(STAGING))));
  });

  // 35
  test('a write accepted but never kept fails the freeze with no second write, no comment on an earlier issue, and the branch not pushed', () => {
    const fake = fakeGitHub([earlierIssue([STAGING]), openIssue([NEW])], {
      released: { [EARLIER]: false },
      dropFirstUpdate: true,
    });
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.issue, null);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
    assert.equal(storedIssue(fake, ISSUE).state, 'OPEN');
    assert.deepEqual(
      parseSignOffIssue(storedIssue(fake, ISSUE).body)?.frozen,
      null,
    );
    assertNotPushed(NEXT, result);
  });

  // 36
  test('a carry marker refused, or accepted but not kept, leaves ok true with a failure holding the exact comment to post', () => {
    const cases: Knobs[] = [{ refuseComment: true }, { dropComment: true }];
    for (const knobs of cases) {
      const fake = fakeGitHub([earlierIssue([STAGING]), openIssue([NEW])], {
        released: { [EARLIER]: false },
        ...knobs,
      });
      const result = executeCut(fake.io, NEXT);
      assert.equal(result.ok, true);
      assert.equal(result.issue, ISSUE);
      assert.equal(result.failures.length, 1);
      assert.match(
        result.failures[0],
        /#10: its unfinished checks were carried to #11/,
      );
      assert.ok(
        result.failures[0].includes(
          renderCarriedComment(ISSUE, NEXT, [idOf(STAGING)]),
        ),
      );
      assert.deepEqual(
        parseSignOffIssue(storedIssue(fake, ISSUE).body)?.frozen,
        {
          version: NEXT,
        },
      );
    }
  });

  // 36b
  test('a freeze write refused after #11 closes and #12 opens leaves both issues as they were, with one write attempted and the branch not pushed', () => {
    const fake = fakeGitHub(
      [
        openIssue([NEW]),
        historied(12, [{ body: openBody(SIGNUP), editor: OWNER }], {
          state: 'CLOSED',
        }),
      ],
      {
        refuseFirstUpdate: true,
        onFirstUpdate: (store) => {
          for (const issue of store) {
            if (issue.number === ISSUE) issue.state = 'CLOSED';
            if (issue.number === 12) issue.state = 'OPEN';
          }
        },
      },
    );
    const before = new Map(
      fake.store.map((i) => [i.number, [i.body, i.title]] as const),
    );
    const result = executeCut(fake.io, NEXT);
    assert.equal(result.ok, false);
    assert.equal(result.issue, null);
    assert.deepEqual(fake.calls, [`update #${ISSUE}`]);
    assert.match(result.failures[0], /Freeze it by hand/);
    assertNotPushed(NEXT, result);
    for (const number of [ISSUE, 12]) {
      const issue = storedIssue(fake, number);
      assert.deepEqual(
        [issue.body, issue.title],
        before.get(number),
        `#${number}`,
      );
    }
  });

  // 37
  test('a Cut planCut refuses never writes, whatever the refusal: executeCut is ok false with one failure and no mutating call', () => {
    const cases: [string, Stored[], Knobs, string][] = [
      [
        'a viewer that is not the owner',
        [openIssue([NEW])],
        { viewer: COLLAB },
        NEXT,
      ],
      [
        'two unfrozen issues',
        [openIssue([NEW]), openIssue([SIGNUP], 12)],
        {},
        NEXT,
      ],
      [
        'a version frozen on two issues',
        [frozenFor(12, [NEW]), frozenFor(13, [SIGNUP], 'CLOSED')],
        {},
        NEXT,
      ],
      ['a version that is not a release', [openIssue([NEW])], {}, '1.1'],
    ];
    for (const [why, seed, knobs, version] of cases) {
      const fake = fakeGitHub(seed, knobs);
      const result = executeCut(fake.io, version);
      assert.equal(result.ok, false, why);
      assert.equal(result.failures.length, 1, why);
      assert.deepEqual(fake.calls, [], why);
      assertNotPushed(version, result);
    }
  });
});

// ----------------------------------------------------------- the Cut result

describe('the lines a Cut prints (renderCutResult)', () => {
  // 38
  test('a Cut that did not hold ends by saying the release branch was NOT pushed, names the version, and lists the failures first', () => {
    const fake = fakeGitHub([earlierIssue([STAGING]), openIssue([NEW])], {
      released: { [EARLIER]: false },
      refuseUpdate: true,
    });
    const lines = renderCutResult(NEXT, executeCut(fake.io, NEXT));
    const last = lines.at(-1) ?? '';
    assert.match(last, /NOT pushed/);
    assert.ok(last.includes(NEXT));
    assert.ok(
      lines
        .slice(0, -1)
        .some((l) =>
          l.startsWith(
            'Sign-off Issue: Sign-off Issue #11 was not frozen for v1.1.0',
          ),
        ),
    );
    assert.equal(
      lines.some((l) => l.includes('NOT pushed') && l !== last),
      false,
    );
  });

  // 39
  test('a Cut that held says nothing of a push, and names the issue, frozen or created, and each carry', () => {
    const frozen = fakeGitHub(
      [earlierIssue([STAGING, PROD]), openIssue([NEW])],
      {
        released: { [EARLIER]: false },
      },
    );
    assert.deepEqual(renderCutResult(NEXT, executeCut(frozen.io, NEXT)), [
      'Sign-off Issue #11 frozen for v1.1.0.',
      'Carried 2 unfinished Person Checks from #10 into #11.',
    ]);
    const created = fakeGitHub([earlierIssue([STAGING])], {
      released: { [EARLIER]: false },
    });
    assert.deepEqual(renderCutResult(NEXT, executeCut(created.io, NEXT)), [
      'Sign-off Issue #11 created for v1.1.0.',
      'Carried 1 unfinished Person Check from #10 into #11.',
    ]);
  });
});

// ------------------------------------------------------------------ close

/** The close's fixture: an issue frozen for the Cut, with `body` and `history` as given. */
const closable = (
  revisions: Rev[],
  released: boolean | null = true,
  extra: Partial<Stored> = {},
): Fake =>
  fakeGitHub([historied(ISSUE, revisions, extra)], {
    released: { [NEXT]: released },
  });

describe('closing the Sign-off Issue (planClose, executeClose)', () => {
  // 40
  test('a close is refused unless exactly one issue is frozen for the version', () => {
    const none = fakeGitHub([openIssue([NEW])], { released: { [NEXT]: true } });
    assert.match(
      reasonOf(planClose(none.io, NEXT)),
      /no Sign-off Issue is frozen for v1\.1\.0/,
    );
    assert.equal(
      reasonOf(planClose(none.io, '1.1')),
      '`1.1` is not a release version',
    );
    const two = fakeGitHub(
      [frozenFor(ISSUE, [PROD]), frozenFor(12, [PROD], 'CLOSED')],
      { released: { [NEXT]: true } },
    );
    assert.equal(
      reasonOf(planClose(two.io, NEXT)),
      'more than one Sign-off Issue is frozen for v1.1.0 (#11, #12)',
    );
  });

  // 41
  test('a close is refused when the release is not out, naming the tag, or when it cannot be read', () => {
    const notOut = fakeGitHub([frozenFor(ISSUE, [PROD])], {
      released: { [NEXT]: false },
    });
    assert.equal(
      reasonOf(planClose(notOut.io, NEXT)),
      'v1.1.0 is not released: its tag is not on origin',
    );
    const unknown = fakeGitHub([frozenFor(ISSUE, [PROD])], {
      released: { [NEXT]: null },
    });
    assert.equal(
      reasonOf(planClose(unknown.io, NEXT)),
      'could not tell whether v1.1.0 was released',
    );
  });

  // 42
  test('an issue already closed is reported as already closed, and nothing is written', () => {
    const fake = fakeGitHub([frozenFor(ISSUE, [PROD], 'CLOSED')], {
      released: { [NEXT]: true },
    });
    assert.deepEqual(planClose(fake.io, NEXT), {
      status: 'already-closed',
      number: ISSUE,
    });
    const result = executeClose(fake.io, NEXT);
    assert.equal(result.closed, false);
    assert.deepEqual(fake.calls, []);
  });

  // 43
  test('production checks ticked by the owner or waived let the issue close, and a removed production check that is waived does too', () => {
    const prod = (c: Check): Check => ({ ...c, place: 'production' });
    const rev1 = frozenBody(NEXT, prod(PROD), prod(SIGNUP), prod(NEW));
    const rev2 = setTicked(rev1, prod(PROD));
    const rev3 = withoutLine(rev2, prod(NEW));
    const fake = closable(
      [
        { body: rev1, editor: OWNER },
        { body: rev2, editor: OWNER },
        { body: rev3, editor: OWNER },
      ],
      true,
      {
        comments: {
          totalCount: 1,
          nodes: [
            ownerComment(
              [waiveLine(prod(SIGNUP)), waiveLine(prod(NEW))].join('\n'),
            ),
          ],
        },
      },
    );
    assert.deepEqual(planClose(fake.io, NEXT), {
      status: 'ready',
      number: ISSUE,
    });
  });

  // 44
  test('a production tick by another login, an unticked production check, and a removed production check each keep the issue open, listed with why', () => {
    const prod = (c: Check): Check => ({ ...c, place: 'production' });
    const rev1 = frozenBody(NEXT, prod(PROD), prod(SIGNUP), prod(NEW));
    const rev2 = withoutLine(setTicked(rev1, prod(PROD)), prod(NEW));
    const fake = closable([
      { body: rev1, editor: OWNER },
      { body: rev2, editor: COLLAB },
    ]);
    const plan = planClose(fake.io, NEXT);
    if (plan.status !== 'open')
      assert.fail(`expected open, got ${JSON.stringify(plan)}`);
    assert.deepEqual(
      plan.open.map((c) => [c.text, c.why]),
      [
        [PROD.text, 'ticked, but not by the Maintainer'],
        [SIGNUP.text, 'not ticked'],
        [NEW.text, 'removed from the issue'],
      ],
    );
  });

  // 45
  test('a staging check still open holds the close, even when every production check is done', () => {
    const rev1 = frozenBody(NEXT, STAGING, PROD);
    const rev2 = setTicked(rev1, PROD);
    const fake = closable([
      { body: rev1, editor: OWNER },
      { body: rev2, editor: OWNER },
    ]);
    const plan = planClose(fake.io, NEXT);
    assert.equal(plan.status, 'open');
    if (plan.status !== 'open') assert.fail('expected open');
    assert.deepEqual(
      plan.open.map((c) => [c.text, c.why]),
      [[STAGING.text, 'not ticked']],
    );
  });

  // 46
  test('a ready issue is closed and the close read back as CLOSED, then gets one closing comment', () => {
    const rev1 = frozenBody(NEXT, PROD);
    const fake = closable([
      { body: rev1, editor: OWNER },
      { body: setTicked(rev1, PROD), editor: OWNER },
    ]);
    const result = executeClose(fake.io, NEXT);
    assert.equal(result.status, 'ready');
    assert.equal(result.closed, true);
    assert.deepEqual(fake.calls, [`close #${ISSUE}`, `comment #${ISSUE}`]);
    assert.equal(storedIssue(fake, ISSUE).state, 'CLOSED');
  });

  // 47
  test('a close refused, or accepted but not read back as CLOSED, is closed false and posts no comment', () => {
    const rev1 = frozenBody(NEXT, PROD);
    const ready = [
      { body: rev1, editor: OWNER },
      { body: setTicked(rev1, PROD), editor: OWNER },
    ];
    const cases: [string, Knobs][] = [
      ['the close refused', { refuseClose: true }],
      ['the close not read back', { dropClose: true }],
    ];
    for (const [why, knobs] of cases) {
      const fake = fakeGitHub([historied(ISSUE, ready)], {
        released: { [NEXT]: true },
        ...knobs,
      });
      assert.equal(executeClose(fake.io, NEXT).closed, false, why);
      assert.deepEqual(fake.calls, [`close #${ISSUE}`], why);
    }
  });

  // 47b
  test('a closing comment refused after a read-back CLOSED leaves closed true: the close is what counts', () => {
    const rev1 = frozenBody(NEXT, PROD);
    const fake = fakeGitHub(
      [
        historied(ISSUE, [
          { body: rev1, editor: OWNER },
          { body: setTicked(rev1, PROD), editor: OWNER },
        ]),
      ],
      { released: { [NEXT]: true }, refuseComment: true },
    );
    const result = executeClose(fake.io, NEXT);
    assert.equal(result.closed, true);
    assert.deepEqual(fake.calls, [`close #${ISSUE}`, `comment #${ISSUE}`]);
    assert.equal(storedIssue(fake, ISSUE).state, 'CLOSED');
  });

  // 48
  test('renderClose prints each status, including the dry-run wording and the open checks with why', () => {
    assert.deepEqual(
      renderClose(NEXT, { status: 'refused', reason: 'x' }, false),
      ['Sign-off Issue not closed: x.'],
    );
    assert.deepEqual(
      renderClose(NEXT, { status: 'already-closed', number: ISSUE }, false),
      ['Sign-off Issue #11 for v1.1.0 is already closed.'],
    );
    assert.deepEqual(
      renderClose(
        NEXT,
        {
          status: 'open',
          number: ISSUE,
          open: [
            {
              issue: ISSUE,
              pr: PROD.pr,
              key: keyOf(PROD),
              text: PROD.text,
              why: 'not ticked',
            },
          ],
        },
        false,
      ),
      [
        'Sign-off Issue #11 for v1.1.0 stays open: 1 Person Check neither ticked nor waived by the Maintainer:',
        `- ${idOf(PROD)} · ${PROD.text} · from #${PROD.pr} · not ticked`,
      ],
    );
    assert.deepEqual(
      renderClose(NEXT, { status: 'ready', number: ISSUE }, true),
      [
        '[dry-run] would close Sign-off Issue #11 for v1.1.0: every Person Check is ticked or waived by the Maintainer.',
      ],
    );
    assert.deepEqual(
      renderClose(
        NEXT,
        { status: 'ready', number: ISSUE, closed: true },
        false,
      ),
      ['Closed Sign-off Issue #11 for v1.1.0.'],
    );
    assert.deepEqual(
      renderClose(
        NEXT,
        { status: 'ready', number: ISSUE, closed: false },
        false,
      ),
      [
        'Sign-off Issue #11 for v1.1.0 could not be closed, or the close could not be read back. Close it by hand.',
      ],
    );
  });
});

describe('closeExitCode (release:signoff-close exit status)', () => {
  // 1
  test('1 for a refusal, and for a ready issue that did not close outside a dry run; 0 for every other status', () => {
    assert.equal(closeExitCode({ status: 'refused', reason: 'x' }, false), 1);
    assert.equal(closeExitCode({ status: 'refused', reason: 'x' }, true), 1);
    assert.equal(
      closeExitCode({ status: 'ready', number: ISSUE, closed: false }, false),
      1,
    );
    assert.equal(closeExitCode({ status: 'ready', number: ISSUE }, false), 1);
    assert.equal(
      closeExitCode({ status: 'ready', number: ISSUE, closed: false }, true),
      0,
    );
    assert.equal(
      closeExitCode({ status: 'ready', number: ISSUE, closed: true }, false),
      0,
    );
    assert.equal(closeExitCode({ status: 'ready', number: ISSUE }, true), 0);
    assert.equal(
      closeExitCode({ status: 'already-closed', number: ISSUE }, false),
      0,
    );
    assert.equal(
      closeExitCode({ status: 'open', number: ISSUE, open: [] }, false),
      0,
    );
  });
});
