// Contract Suite for the production gate's pure pieces (ADR 0151 decisions 8
// and 9). Batch A covers the release branch reader, the waiver grammar, which
// comments may waive, and the revision history. Batch B adds the proof of who
// ticked a box, the staging scan, the decision and its rendering.
//
// Run with: node --test tools/scripts/lib/signoff-gate.test.ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  renderSignOffFrozen,
  renderSignOffIssue,
  renderSignOffLine,
  type SignOffEntry,
  signOffKey,
} from './signoff-issue.ts';
import {
  checkId,
  type ContentEdit,
  decideProductionGate,
  type GateComment,
  type GateDecision,
  type GateInput,
  type GateIssue,
  type OpenCheck,
  type OpenWhy,
  parseWaivers,
  releaseVersion,
  renderGateDecision,
  revisionsOf,
  trustedWaivers,
} from './signoff-gate.ts';

// ------------------------------------------------------------- fixtures

const OWNER = 'maintainer';
const ISSUE_NUMBER = 5;
const COMMENT_URL = 'https://github.test/comments/1';

const entryOf = (
  place: SignOffEntry['place'],
  text: string,
  pr = 7,
): SignOffEntry => ({
  pr,
  place,
  text,
  reportUrl: COMMENT_URL,
});
const A = entryOf('staging', 'Check the invoice email');
const B = entryOf('production', 'Confirm the tax line');

// A waiver's check id, `<pr>:<key>`: a 12-character lowercase hex key.
const ID = '1576:0123456789ab';
const REASON = 'accepted on staging';
const waiveLine = (dash: string, reason = REASON): string =>
  `waive: ${ID} ${dash} ${reason}`;

const waiverComment = (overrides: Partial<GateComment> = {}): GateComment => ({
  author: { login: OWNER },
  authorAssociation: 'OWNER',
  body: waiveLine('—'),
  isMinimized: false,
  lastEditedAt: null,
  ...overrides,
});

const issueOf = (overrides: Partial<GateIssue> = {}): GateIssue => ({
  number: ISSUE_NUMBER,
  state: 'OPEN',
  author: { login: OWNER },
  body: renderSignOffIssue([A]),
  edits: { totalCount: 0, nodes: [] },
  comments: null,
  ...overrides,
});

// ------------------------------------------------------------- releaseVersion

describe('releaseVersion', () => {
  // 1
  test('a release/vX.Y.Z branch gives its version, trimmed, and every other shape gives null', () => {
    assert.equal(releaseVersion('release/v1.2.3'), 'v1.2.3');
    assert.equal(releaseVersion(' release/v1.2.3 '), 'v1.2.3');
    for (const branch of [
      'release/1.2.3',
      'release/v1.2',
      'release/v1.2.3-rc.1',
      'feature/x',
    ]) {
      assert.equal(releaseVersion(branch), null, branch);
    }
  });
});

// ------------------------------------------------------------- parseWaivers

describe('parseWaivers', () => {
  // 2
  test('each dash form is accepted with whitespace on both sides, and the reason is trimmed', () => {
    for (const dash of ['—', '–', '--', '-']) {
      assert.deepEqual(
        parseWaivers(`  waive: ${ID} ${dash} ${REASON}  `),
        [{ id: ID, reason: REASON }],
        dash,
      );
    }
    assert.deepEqual(parseWaivers(`waive: ${ID} —   ${REASON}   `), [
      { id: ID, reason: REASON },
    ]);
  });

  // 3
  test('a line with no reason, a blank reason, or no dash is not a waiver, so the comment states none', () => {
    const cases: [string, string][] = [
      ['no reason', `waive: ${ID} —`],
      ['a whitespace-only reason', `waive: ${ID} —    `],
      ['no dash', `waive: ${ID} ${REASON}`],
    ];
    for (const [why, body] of cases) {
      assert.equal(parseWaivers(body), null, why);
    }
  });

  // 4
  test('an uppercase keyword, a visible #pr or text in place of <pr>:<key>, or a key that is not 12 lowercase hex is not a waiver', () => {
    const cases: [string, string][] = [
      ['an uppercase keyword', `WAIVE: ${ID} — ${REASON}`],
      ['a visible #pr in place of <pr>:<key>', `waive: #1576 — ${REASON}`],
      [
        'text in place of <pr>:<key>',
        `waive: Check the invoice email — ${REASON}`,
      ],
      ['an uppercase key', `waive: 1576:0123456789AB — ${REASON}`],
      ['an 11-character key', `waive: 1576:0123456789a — ${REASON}`],
      ['a 13-character key', `waive: 1576:0123456789abc — ${REASON}`],
    ];
    for (const [why, body] of cases) {
      assert.equal(parseWaivers(body), null, why);
    }
  });

  // 5
  test('several waiver lines in one comment, with blank lines between, are all returned in order', () => {
    const second = 'waive: 8:fedcba987654 -- second reason';
    assert.deepEqual(
      parseWaivers(
        [waiveLine('—', 'first reason'), '', '   ', second].join('\n'),
      ),
      [
        { id: ID, reason: 'first reason' },
        { id: '8:fedcba987654', reason: 'second reason' },
      ],
    );
  });

  // 6
  test('one non-waiver line makes the whole comment count for nothing; an empty or missing body is null', () => {
    assert.equal(parseWaivers(`${waiveLine('—')}\nthanks`), null);
    assert.equal(parseWaivers(`thanks\n${waiveLine('—')}`), null);
    for (const body of ['', '  \n\n', null, undefined]) {
      assert.equal(parseWaivers(body), null, JSON.stringify(body));
    }
  });
});

// ------------------------------------------------------------- trustedWaivers

describe('trustedWaivers', () => {
  // 7
  test('a waiver from the owner login, with the OWNER association, not minimised and never edited, is counted by check id', () => {
    assert.deepEqual(
      trustedWaivers([waiverComment()], OWNER),
      new Map([[ID, REASON]]),
    );
  });

  // 8
  test('a comment that is a MEMBER or COLLABORATOR, another login with OWNER, minimised, or edited is ignored', () => {
    const ignored: [string, Partial<GateComment>][] = [
      ['a MEMBER association', { authorAssociation: 'MEMBER' }],
      ['a COLLABORATOR association', { authorAssociation: 'COLLABORATOR' }],
      [
        'the OWNER association but another login (an agent bot)',
        { author: { login: 'agent-bot' } },
      ],
      ['a minimised comment', { isMinimized: true }],
      ['an edited comment', { lastEditedAt: '2026-03-03T00:00:00Z' }],
    ];
    for (const [why, overrides] of ignored) {
      assert.deepEqual(
        trustedWaivers([waiverComment(overrides)], OWNER),
        new Map(),
        why,
      );
    }
  });

  // 9
  test('the same check id waived in two trusted comments keeps the first reason', () => {
    assert.deepEqual(
      trustedWaivers(
        [
          waiverComment({ body: waiveLine('—', 'first reason') }),
          waiverComment({ body: waiveLine('-', 'second reason') }),
        ],
        OWNER,
      ),
      new Map([[ID, 'first reason']]),
    );
  });

  // 9b
  test('a trusted comment that holds no waiver does not void a later trusted waiver', () => {
    assert.deepEqual(
      trustedWaivers(
        [
          waiverComment({ body: 'thanks' }),
          waiverComment({ body: waiveLine('—') }),
        ],
        OWNER,
      ),
      new Map([[ID, REASON]]),
    );
  });
});

// ------------------------------------------------------------- revisionsOf

describe('revisionsOf', () => {
  // 10
  test('an issue with no edits has one revision: its current body, by the issue author', () => {
    const issue = issueOf();
    assert.deepEqual(revisionsOf(issue), {
      status: 'read',
      revisions: [{ editor: OWNER, body: issue.body }],
    });
  });

  // 10b
  test('an edit whose editor is null is read with a null editor, and its diff is the revision body', () => {
    const body = renderSignOffIssue([A]);
    assert.deepEqual(
      revisionsOf(
        issueOf({
          body,
          edits: {
            totalCount: 1,
            nodes: [
              { editedAt: '2026-03-03T00:00:00Z', editor: null, diff: body },
            ],
          },
        }),
      ),
      { status: 'read', revisions: [{ editor: null, body }] },
    );
  });

  // 11
  test("edits given newest first are returned oldest first, reversing GitHub's order, when the timestamps agree with it", () => {
    const body1 = renderSignOffIssue([]);
    const body2 = renderSignOffIssue([A]);
    const body3 = renderSignOffIssue([A, B]);
    const issue = issueOf({
      body: body3,
      edits: {
        totalCount: 3,
        nodes: [
          {
            editedAt: '2026-03-03T00:00:00Z',
            editor: { login: OWNER },
            diff: body3,
          },
          {
            editedAt: '2026-02-02T00:00:00Z',
            editor: { login: 'agent-bot' },
            diff: body2,
          },
          {
            editedAt: '2026-01-01T00:00:00Z',
            editor: { login: OWNER },
            diff: body1,
          },
        ],
      },
    });
    assert.deepEqual(revisionsOf(issue), {
      status: 'read',
      revisions: [
        { editor: OWNER, body: body1 },
        { editor: 'agent-bot', body: body2 },
        { editor: OWNER, body: body3 },
      ],
    });
  });

  // 12a
  test('a null edit history, or one not read whole, is unreadable', () => {
    const nullEdits = revisionsOf(issueOf({ edits: null }));
    assert.equal(nullEdits.status, 'unreadable');
    assert.match(
      nullEdits.status === 'unreadable' ? nullEdits.reason : '',
      /could not be read/,
    );

    const partial = revisionsOf(
      issueOf({
        body: renderSignOffIssue([A]),
        edits: {
          totalCount: 2,
          nodes: [
            {
              editedAt: '2026-03-03T00:00:00Z',
              editor: { login: OWNER },
              diff: renderSignOffIssue([A]),
            },
          ],
        },
      }),
    );
    assert.equal(partial.status, 'unreadable');
    assert.match(
      partial.status === 'unreadable' ? partial.reason : '',
      /not read whole \(1 of 2 revisions\)/,
    );
  });

  // 12b
  test('a revision with deletedAt set, or with a null diff, is unreadable as deleted', () => {
    const body = renderSignOffIssue([A]);
    const deleted = revisionsOf(
      issueOf({
        body,
        edits: {
          totalCount: 1,
          nodes: [
            {
              editedAt: '2026-03-03T00:00:00Z',
              deletedAt: '2026-03-04T00:00:00Z',
              editor: { login: OWNER },
              diff: body,
            },
          ],
        },
      }),
    );
    assert.equal(deleted.status, 'unreadable');
    assert.match(
      deleted.status === 'unreadable' ? deleted.reason : '',
      /was deleted from its history/,
    );

    const nullDiff = revisionsOf(
      issueOf({
        body,
        edits: {
          totalCount: 1,
          nodes: [
            {
              editedAt: '2026-03-03T00:00:00Z',
              editor: { login: OWNER },
              diff: null,
            },
          ],
        },
      }),
    );
    assert.equal(nullDiff.status, 'unreadable');
    assert.match(
      nullDiff.status === 'unreadable' ? nullDiff.reason : '',
      /was deleted from its history/,
    );
  });

  // 13
  test('a newest revision whose text differs from the body is unreadable, but a CRLF-only difference is read', () => {
    const lf = renderSignOffIssue([A]);
    const crlfBody = lf.replace(/\n/g, '\r\n');

    const different = revisionsOf(
      issueOf({
        body: lf,
        edits: {
          totalCount: 1,
          nodes: [
            {
              editedAt: '2026-03-03T00:00:00Z',
              editor: { login: OWNER },
              diff: renderSignOffIssue([B]),
            },
          ],
        },
      }),
    );
    assert.equal(different.status, 'unreadable');
    assert.match(
      different.status === 'unreadable' ? different.reason : '',
      /is not its current body/,
    );

    assert.deepEqual(
      revisionsOf(
        issueOf({
          body: crlfBody,
          edits: {
            totalCount: 1,
            nodes: [
              {
                editedAt: '2026-03-03T00:00:00Z',
                editor: { login: OWNER },
                diff: lf,
              },
            ],
          },
        }),
      ),
      { status: 'read', revisions: [{ editor: OWNER, body: lf }] },
    );
  });
});

// ------------------------------------------------------------- batch B fixtures

const VERSION = 'v1.2.3';
const REVISED = 'Check the invoice email, revised';
const NOTE = 'A note from a collaborator.';

/** The ISO time `minute` minutes into the fixture day: later minutes are later edits. */
const at = (minute: number): string =>
  new Date(Date.parse('2026-03-03T00:00:00Z') + minute * 60_000).toISOString();

/** A rendered body with its frozen line on line 2, right after the marker. */
const frozenBody = (
  entries: readonly SignOffEntry[],
  version = VERSION,
): string => {
  const lines = renderSignOffIssue(entries).split('\n');
  lines.splice(1, 0, renderSignOffFrozen(version));
  return lines.join('\n');
};

/** `body` with the one check line for `entry` ticked or unticked; no other line changes. */
const setChecked = (
  body: string,
  entry: SignOffEntry,
  checked: boolean,
): string => {
  const from = `- [${checked ? ' ' : 'x'}] [${entry.place}] ${entry.text} · `;
  const to = `- [${checked ? 'x' : ' '}] [${entry.place}] ${entry.text} · `;
  const hits = body.split('\n').filter((line) => line.startsWith(from));
  assert.equal(hits.length, 1, `exactly one line starts with: ${from}`);
  return body
    .split('\n')
    .map((line) =>
      line.startsWith(from) ? to + line.slice(from.length) : line,
    )
    .join('\n');
};

const commentsOf = (
  nodes: GateComment[],
): { totalCount: number; nodes: GateComment[] } => ({
  totalCount: nodes.length,
  nodes,
});

const editOf = (
  diff: string,
  editor: string,
  minute: number,
  overrides: Partial<ContentEdit> = {},
): ContentEdit => ({
  editedAt: at(minute),
  deletedAt: null,
  editor: { login: editor },
  diff,
  ...overrides,
});

/**
 * An issue whose history is `revisions`, oldest first; its current body is the
 * newest. Minute `i` is revision `i`, and the nodes are listed newest first as
 * GitHub returns them.
 */
const historied = (
  revisions: readonly { body: string; editor: string }[],
  overrides: Partial<GateIssue> = {},
): GateIssue =>
  issueOf({
    body: revisions[revisions.length - 1].body,
    edits: {
      totalCount: revisions.length,
      nodes: revisions.map((r, i) => editOf(r.body, r.editor, i)).reverse(),
    },
    comments: commentsOf([]),
    ...overrides,
  });

/** The same revisions, all stamped with one `editedAt`, listed newest first. */
const tiedHistory = (
  revisions: readonly { body: string; editor: string }[],
): GateIssue =>
  issueOf({
    body: revisions[revisions.length - 1].body,
    edits: {
      totalCount: revisions.length,
      nodes: revisions.map((r) => editOf(r.body, r.editor, 0)).reverse(),
    },
    comments: commentsOf([]),
  });

const gateInput = (
  issues: GateIssue[] | null,
  overrides: Partial<GateInput> = {},
): GateInput => ({
  owner: { __typename: 'User', login: OWNER },
  version: VERSION,
  issues,
  ...overrides,
});

/** The waiver line the Maintainer writes for one check. */
const waiveFor = (entry: SignOffEntry, reason = REASON): string =>
  `waive: ${checkId(entry.pr, signOffKey(entry.place, entry.text))} — ${reason}`;

/** The open entry a `staging` check of `entry` makes on `issue`. */
const openOf = (
  entry: SignOffEntry,
  why: OpenWhy,
  issue = ISSUE_NUMBER,
): OpenCheck => ({
  issue,
  pr: entry.pr,
  key: signOffKey(entry.place, entry.text),
  text: entry.text,
  why,
});

/** The open checks of a decision that must be `held`. */
const heldOpen = (decision: GateDecision): OpenCheck[] => {
  if (decision.status !== 'held')
    assert.fail(`expected held, got ${JSON.stringify(decision)}`);
  return decision.open;
};

// ------------------------------------------------------------- who may tick

describe('who may tick a staging check (proveIssue, openStagingChecks)', () => {
  // B1
  test('a staging check the Maintainer ticked is not open, so the gate allows', () => {
    const unticked = frozenBody([A]);
    const issue = historied([
      { body: unticked, editor: OWNER },
      { body: setChecked(unticked, A, true), editor: OWNER },
    ]);
    const decision = decideProductionGate(gateInput([issue]));
    assert.equal(decision.status, 'allow');
    assert.match(decision.reason, /ticked or waived by the Maintainer/);
  });

  // B2
  test('a staging check ticked by a collaborator is open as ticked, but not by the Maintainer', () => {
    const unticked = frozenBody([A]);
    const issue = historied([
      { body: unticked, editor: OWNER },
      { body: setChecked(unticked, A, true), editor: 'collaborator' },
    ]);
    assert.deepEqual(heldOpen(decideProductionGate(gateInput([issue]))), [
      openOf(A, 'ticked, but not by the Maintainer'),
    ]);
  });

  // B3
  test('a collaborator edit that keeps the Maintainer tick does not undo it', () => {
    const unticked = frozenBody([A]);
    const ticked = setChecked(unticked, A, true);
    const issue = historied([
      { body: unticked, editor: OWNER },
      { body: ticked, editor: OWNER },
      { body: `${ticked}${NOTE}\n`, editor: 'collaborator' },
    ]);
    const decision = decideProductionGate(gateInput([issue]));
    assert.equal(decision.status, 'allow');
  });

  // B4
  test('a collaborator untick after the Maintainer tick holds the check as not ticked', () => {
    const unticked = frozenBody([A]);
    const ticked = setChecked(unticked, A, true);
    const issue = historied([
      { body: unticked, editor: OWNER },
      { body: ticked, editor: OWNER },
      { body: unticked, editor: 'collaborator' },
    ]);
    assert.deepEqual(heldOpen(decideProductionGate(gateInput([issue]))), [
      openOf(A, 'not ticked'),
    ]);
  });

  // B5
  test('a Maintainer untick, then a collaborator re-tick, is a tick by someone other than the Maintainer', () => {
    const unticked = frozenBody([A]);
    const ticked = setChecked(unticked, A, true);
    const issue = historied([
      { body: unticked, editor: OWNER },
      { body: ticked, editor: OWNER },
      { body: unticked, editor: OWNER },
      { body: ticked, editor: 'collaborator' },
    ]);
    assert.deepEqual(heldOpen(decideProductionGate(gateInput([issue]))), [
      openOf(A, 'ticked, but not by the Maintainer'),
    ]);
  });

  // B6
  test('a tick made across an unparseable revision counts only if every editor in the span is the Maintainer', () => {
    const unticked = frozenBody([A]);
    const ticked = setChecked(unticked, A, true);
    // A top-level list item that is not a rendered check line makes a body unparseable.
    const messy = `${ticked}- Injected by a collaborator\n`;

    const mixed = historied([
      { body: unticked, editor: OWNER },
      { body: messy, editor: 'collaborator' },
      { body: ticked, editor: OWNER },
    ]);
    assert.deepEqual(heldOpen(decideProductionGate(gateInput([mixed]))), [
      openOf(A, 'ticked, but not by the Maintainer'),
    ]);

    const owned = historied([
      { body: unticked, editor: OWNER },
      { body: messy, editor: OWNER },
      { body: ticked, editor: OWNER },
    ]);
    assert.equal(decideProductionGate(gateInput([owned])).status, 'allow');
  });

  // B6b
  test('revisions that share one editedAt keep the API order, so the last collaborator re-tick still counts against the Maintainer', () => {
    const unticked = frozenBody([A]);
    const ticked = setChecked(unticked, A, true);
    const issue = tiedHistory([
      { body: unticked, editor: OWNER },
      { body: ticked, editor: OWNER },
      { body: unticked, editor: 'collaborator' },
      { body: ticked, editor: 'collaborator' },
    ]);
    assert.deepEqual(heldOpen(decideProductionGate(gateInput([issue]))), [
      openOf(A, 'ticked, but not by the Maintainer'),
    ]);
  });
});

// ------------------------------------------------------------- revision order

describe('revision order (revisionsOf)', () => {
  // B17
  test('nodes listed newest first whose timestamps run the other way are unreadable', () => {
    const body1 = frozenBody([A]);
    const body2 = setChecked(body1, A, true);
    const issue = issueOf({
      body: body2,
      edits: {
        totalCount: 2,
        nodes: [editOf(body2, OWNER, 1), editOf(body1, OWNER, 2)],
      },
      comments: commentsOf([]),
    });
    const result = revisionsOf(issue);
    assert.equal(result.status, 'unreadable');
    assert.match(
      result.status === 'unreadable' ? result.reason : '',
      /is not in the order of its timestamps/,
    );
  });

  // B17b
  test('a node whose editedAt is not a date is unreadable as out of timestamp order', () => {
    const body1 = frozenBody([A]);
    const body2 = setChecked(body1, A, true);
    const issue = issueOf({
      body: body2,
      edits: {
        totalCount: 2,
        nodes: [
          { ...editOf(body1, OWNER, 0), editedAt: 'not-a-date' },
          editOf(body2, OWNER, 1),
        ],
      },
      comments: commentsOf([]),
    });
    const result = revisionsOf(issue);
    assert.equal(result.status, 'unreadable');
    assert.match(
      result.status === 'unreadable' ? result.reason : '',
      /is not in the order of its timestamps/,
    );
  });
});

// ------------------------------------------------------------- staging scan

describe('which staging checks hold (proveIssue, openStagingChecks)', () => {
  // B7
  test('a staging check relabelled [production] by a collaborator stays open as staging, with its latest text', () => {
    const relabelled = frozenBody([A]).replace(
      `[staging] ${A.text} ·`,
      `[production] ${REVISED} ·`,
    );
    const issue = historied([
      { body: frozenBody([A]), editor: OWNER },
      { body: relabelled, editor: 'collaborator' },
    ]);
    assert.deepEqual(heldOpen(decideProductionGate(gateInput([issue]))), [
      {
        issue: ISSUE_NUMBER,
        pr: A.pr,
        key: signOffKey(A.place, A.text),
        text: REVISED,
        why: 'not ticked',
      },
    ]);
  });

  // B8
  test('a staging check deleted from the body is open as removed, and an owner waiver for it releases it', () => {
    const removedHistory = [
      { body: frozenBody([A]), editor: OWNER },
      { body: frozenBody([]), editor: 'collaborator' },
    ];
    assert.deepEqual(
      heldOpen(decideProductionGate(gateInput([historied(removedHistory)]))),
      [openOf(A, 'removed from the issue')],
    );

    const waived = historied(removedHistory, {
      comments: commentsOf([waiverComment({ body: waiveFor(A) })]),
    });
    assert.equal(decideProductionGate(gateInput([waived])).status, 'allow');
  });

  // B9
  test('a production check never holds the gate', () => {
    const issue = issueOf({ body: frozenBody([B]), comments: commentsOf([]) });
    assert.equal(decideProductionGate(gateInput([issue])).status, 'allow');
  });

  // B10
  test('an indented continuation under an unticked staging check gives the same open checks as the body without it', () => {
    const plain = frozenBody([A]);
    const line = renderSignOffLine(A);
    const withContinuation = plain.replace(line, `${line}\n  - Bug: #999`);
    assert.notEqual(withContinuation, plain);
    const decide = (body: string) =>
      heldOpen(
        decideProductionGate(
          gateInput([issueOf({ body, comments: commentsOf([]) })]),
        ),
      );
    assert.deepEqual(decide(withContinuation), decide(plain));
    assert.deepEqual(decide(withContinuation), [openOf(A, 'not ticked')]);
  });
});

// ------------------------------------------------------------- decision: frozen

describe('decideProductionGate with a frozen issue', () => {
  // B11
  test('a frozen issue with an open staging check holds, naming the issue and version, until a trusted waiver releases it', () => {
    const held = decideProductionGate(
      gateInput([issueOf({ body: frozenBody([A]), comments: commentsOf([]) })]),
    );
    assert.match(held.reason, /Sign-off Issue #5 for v1\.2\.3 has 1/);
    assert.deepEqual(heldOpen(held), [openOf(A, 'not ticked')]);

    const waived = issueOf({
      body: frozenBody([A]),
      comments: commentsOf([waiverComment({ body: waiveFor(A) })]),
    });
    assert.equal(decideProductionGate(gateInput([waived])).status, 'allow');
  });

  // B12
  test('a collaborator who rewrites the frozen line to another version cannot decide: the new frozen line was not written by the Maintainer', () => {
    const issue = historied([
      { body: frozenBody([A], VERSION), editor: OWNER },
      { body: frozenBody([A], 'v1.2.4'), editor: 'collaborator' },
    ]);
    const decision = decideProductionGate(gateInput([issue]));
    assert.equal(decision.status, 'cannot-decide');
    assert.match(
      decision.reason,
      /a frozen line on #5 \(v1\.2\.4\) was not written by the Maintainer/,
    );
  });

  // B12b
  test('a frozen line a collaborator first writes into an open issue is forged, so the gate cannot decide', () => {
    const unfrozenHistory = [
      { body: renderSignOffIssue([A]), editor: OWNER },
      { body: frozenBody([A], 'v1.2.4'), editor: 'collaborator' },
    ];
    const decision = decideProductionGate(
      gateInput([historied(unfrozenHistory)]),
    );
    assert.equal(decision.status, 'cannot-decide');
    assert.match(
      decision.reason,
      /a frozen line on #5 \(v1\.2\.4\) was not written by the Maintainer/,
    );
  });

  // B12c
  test('a version the Maintainer froze in an earlier revision still matches after a later Maintainer rewrite to another version', () => {
    const issue = historied([
      { body: frozenBody([A], VERSION), editor: OWNER },
      { body: frozenBody([A], 'v1.2.4'), editor: OWNER },
    ]);
    const decision = decideProductionGate(gateInput([issue]));
    assert.match(decision.reason, /Sign-off Issue #5 for v1\.2\.3 has 1/);
    assert.deepEqual(heldOpen(decision), [openOf(A, 'not ticked')]);
  });

  // B12d
  test("a frozen line first written after an unparseable collaborator revision is not the Maintainer's alone, so the gate cannot decide", () => {
    const unfrozen = renderSignOffIssue([A]);
    const junked = `${unfrozen}- junk\n`;
    const issue = historied([
      { body: unfrozen, editor: OWNER },
      { body: junked, editor: 'collaborator' },
      { body: frozenBody([A], VERSION), editor: OWNER },
    ]);
    const decision = decideProductionGate(gateInput([issue]));
    assert.equal(decision.status, 'cannot-decide');
    assert.match(
      decision.reason,
      /a frozen line on #5 \(v1\.2\.3\) was not written by the Maintainer/,
    );
  });
});

// ------------------------------------------------------------- decision: unfrozen

describe('decideProductionGate with no frozen issue', () => {
  // B13
  test('an open unfrozen issue holds on its open checks, a closed unfrozen issue holds too, and an empty candidate list allows', () => {
    const openUnfrozen = issueOf({
      body: renderSignOffIssue([A]),
      comments: commentsOf([]),
    });
    const held = decideProductionGate(gateInput([openUnfrozen]));
    assert.match(
      held.reason,
      /no Sign-off Issue was frozen for v1\.2\.3, and the unfrozen Sign-off Issue #5 was not frozen for it/,
    );
    assert.deepEqual(heldOpen(held), [openOf(A, 'not ticked')]);

    const closedUnfrozen = issueOf({
      state: 'CLOSED',
      body: renderSignOffIssue([A]),
      comments: commentsOf([]),
    });
    const heldClosed = decideProductionGate(gateInput([closedUnfrozen]));
    assert.match(
      heldClosed.reason,
      /the unfrozen Sign-off Issue #5 was not frozen for it/,
    );
    assert.deepEqual(heldOpen(heldClosed), [openOf(A, 'not ticked')]);

    const none = decideProductionGate(gateInput([]));
    assert.equal(none.status, 'allow');
    assert.match(none.reason, /no unfrozen Sign-off Issue has a `staging`/);
  });
});

// ------------------------------------------------------------- decision: cannot decide

describe('decideProductionGate cannot decide', () => {
  // B14a
  test('two issues frozen for one version, a non-User owner, a null issue list, or a version that is not vX.Y.Z cannot decide', () => {
    const frozenFive = issueOf({
      body: frozenBody([A]),
      comments: commentsOf([]),
    });
    const frozenSix = issueOf({
      number: 6,
      body: frozenBody([A]),
      comments: commentsOf([]),
    });

    const two = decideProductionGate(gateInput([frozenFive, frozenSix]));
    assert.equal(two.status, 'cannot-decide');
    assert.match(
      two.reason,
      /more than one Sign-off Issue was frozen for v1\.2\.3 \(#5, #6\)/,
    );

    const org = decideProductionGate(
      gateInput([frozenFive], {
        owner: { __typename: 'Organization', login: OWNER },
      }),
    );
    assert.equal(org.status, 'cannot-decide');
    assert.match(org.reason, /not a single user login/);

    const nullList = decideProductionGate(gateInput(null));
    assert.equal(nullList.status, 'cannot-decide');
    assert.match(nullList.reason, /could not be read whole/);

    const badVersion = decideProductionGate(
      gateInput([frozenFive], { version: '1.2.3' }),
    );
    assert.equal(badVersion.status, 'cannot-decide');
    assert.match(badVersion.reason, /is not a release version/);

    for (const owner of [null, { __typename: 'User', login: null }] as const) {
      const decision = decideProductionGate(gateInput([frozenFive], { owner }));
      assert.equal(decision.status, 'cannot-decide', JSON.stringify(owner));
      assert.match(decision.reason, /not a single user login/);
    }
  });

  // B14b
  test('a candidate with a deleted revision, a null comment list, or a truncated comment list on a staging check cannot decide', () => {
    const body = frozenBody([A]);
    const deleted = issueOf({
      body,
      edits: {
        totalCount: 1,
        nodes: [editOf(body, OWNER, 0, { deletedAt: at(1) })],
      },
      comments: commentsOf([]),
    });
    const onDeleted = decideProductionGate(gateInput([deleted]));
    assert.equal(onDeleted.status, 'cannot-decide');
    assert.match(onDeleted.reason, /was deleted from its history/);

    // A trusted waiver in a partial list must not release the check.
    const truncated = issueOf({
      body,
      comments: {
        totalCount: 2,
        nodes: [waiverComment({ body: waiveFor(A) })],
      },
    });
    const onTruncated = decideProductionGate(gateInput([truncated]));
    assert.equal(onTruncated.status, 'cannot-decide');
    assert.match(
      onTruncated.reason,
      /the comments on #5 could not be read whole/,
    );

    const nullComments = issueOf({ body, comments: null });
    const onNull = decideProductionGate(gateInput([nullComments]));
    assert.equal(onNull.status, 'cannot-decide');
    assert.match(onNull.reason, /the comments on #5 could not be read whole/);

    // The same truncation on an open, unfrozen issue: its open checks cannot be judged either.
    const unfrozenTruncated = issueOf({
      body: renderSignOffIssue([A]),
      comments: {
        totalCount: 2,
        nodes: [waiverComment({ body: waiveFor(A) })],
      },
    });
    const onUnfrozen = decideProductionGate(gateInput([unfrozenTruncated]));
    assert.equal(onUnfrozen.status, 'cannot-decide');
    assert.match(
      onUnfrozen.reason,
      /the comments on #5 could not be read whole/,
    );
  });

  // B14c
  test('a candidate whose body is not in the fixed form, with a stray list item in the checks section, cannot decide', () => {
    const stray = `${renderSignOffIssue([A])}- Injected by a collaborator\n`;
    const decision = decideProductionGate(
      gateInput([issueOf({ body: stray, comments: commentsOf([]) })]),
    );
    assert.equal(decision.status, 'cannot-decide');
    assert.match(
      decision.reason,
      /the body of #5 is not in the Sign-off Issue's fixed form/,
    );
  });
});

// ------------------------------------------------------------- decision: candidates

describe('decideProductionGate candidates', () => {
  // B15
  test('an issue by another author, or an owner issue whose first line is not the marker, is not a candidate even with open staging checks', () => {
    const byAgent = issueOf({
      number: 8,
      author: { login: 'some-agent[bot]' },
      body: frozenBody([A]),
      comments: commentsOf([]),
    });
    const noMarker = issueOf({
      number: 9,
      body: `A note\n${frozenBody([A])}`,
      comments: commentsOf([]),
    });
    const decision = decideProductionGate(gateInput([byAgent, noMarker]));
    assert.equal(decision.status, 'allow');
    assert.match(decision.reason, /no Sign-off Issue was frozen for v1\.2\.3/);
  });
});

// ------------------------------------------------------------- rendering

describe('renderGateDecision', () => {
  // B16
  test('a held decision renders its reason, one line per open check, and one waive line per check; allow and cannot-decide are one line', () => {
    const second = entryOf('staging', 'Confirm the tax line', 8);
    const open: OpenCheck[] = [
      openOf(A, 'not ticked'),
      openOf(second, 'removed from the issue'),
    ];
    assert.deepEqual(
      renderGateDecision({
        status: 'held',
        reason:
          'Sign-off Issue #5 for v1.2.3 has 2 `staging` Person Checks neither ticked nor waived by the Maintainer',
        open,
      }),
      [
        'Production gate: held — Sign-off Issue #5 for v1.2.3 has 2 `staging` Person Checks neither ticked nor waived by the Maintainer:',
        '- #5 · [staging] Check the invoice email · from #7 · not ticked',
        '- #5 · [staging] Confirm the tax line · from #8 · removed from the issue',
        '',
        'The Maintainer ticks each check on its Sign-off Issue, or waives it with one comment line each:',
        `waive: 7:${signOffKey('staging', A.text)} — <reason>`,
        `waive: 8:${signOffKey('staging', second.text)} — <reason>`,
      ],
    );
    assert.deepEqual(renderGateDecision({ status: 'allow', reason: 'R' }), [
      'Production gate: allowed — R.',
    ]);
    assert.deepEqual(
      renderGateDecision({ status: 'cannot-decide', reason: 'R' }),
      ['Production gate: held — it cannot decide: R.'],
    );
  });
});
