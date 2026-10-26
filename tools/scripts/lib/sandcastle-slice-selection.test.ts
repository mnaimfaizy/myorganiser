import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blockedBy,
  blocks,
  describeAssembly,
  describeBlockedSlices,
  findDependencyCycles,
  isCompleted,
  isDependencySatisfied,
  isSatisfiedAsDependency,
  selectPrdSlices,
  slicesOfPrd,
  unfinishedDependencies,
  type Issue,
} from './sandcastle-slice-selection.ts';

const PRD = 461;

interface SliceOptions {
  labels?: string[];
  state?: string;
  body?: string;
  prd?: number;
}

const slice = (
  number: number,
  { labels = [], state = 'OPEN', body = '', prd = PRD }: SliceOptions = {},
): Issue => ({
  number,
  state,
  labels: labels.map((name) => ({ name })),
  body: `PRD: #${prd}\n\n${body}`,
});

const READY = ['ready-for-agent', 'type:afk'];
const blockedBySection = (...refs: number[]): string =>
  `## Blocked by\n\n${refs.length ? refs.map((r) => `- #${r}`).join('\n') : '- None'}\n`;

// ─── The regression this module exists for ────────────────────────────────────

test('a PRD whose later slices are blocked on its first slice selects all of them', () => {
  const issues = [
    slice(463, { labels: READY, body: blockedBySection() }),
    slice(464, {
      labels: [...READY, 'status:blocked'],
      body: blockedBySection(463),
    }),
    slice(465, {
      labels: [...READY, 'status:blocked'],
      body: blockedBySection(464),
    }),
  ];

  const { selected, admitted, deferred } = selectPrdSlices(issues, {
    prd: PRD,
  });

  assert.deepEqual(
    selected.map((i) => i.number),
    [463, 464, 465],
    'the run must consider slices it is about to unblock itself',
  );
  assert.deepEqual(
    admitted.map((i) => i.number),
    [464, 465],
  );
  assert.deepEqual(deferred, []);
});

test('a slice already dispatched in a previous run is not selected again', () => {
  const issues = [
    slice(463, { labels: [...READY, 'status:done'], state: 'CLOSED' }),
    slice(464, { labels: READY, body: blockedBySection(463) }),
  ];

  const { selected } = selectPrdSlices(issues, { prd: PRD });

  assert.deepEqual(
    selected.map((i) => i.number),
    [464],
  );
});

// ─── status:blocked that this run cannot evaluate ─────────────────────────────

test('status:blocked with no `## Blocked by` section is deferred, not admitted', () => {
  const issues = [slice(470, { labels: [...READY, 'status:blocked'] })];

  const { selected, deferred } = selectPrdSlices(issues, { prd: PRD });

  assert.deepEqual(selected, []);
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].issue.number, 470);
  assert.match(deferred[0].reason, /no in-PRD blocker/);
});

test('status:blocked on an issue outside this PRD is deferred', () => {
  const issues = [
    slice(470, {
      labels: [...READY, 'status:blocked'],
      body: blockedBySection(999),
    }),
  ];

  const { selected, deferred } = selectPrdSlices(issues, { prd: PRD });

  assert.deepEqual(selected, []);
  assert.deepEqual(
    deferred.map((d) => d.issue.number),
    [470],
  );
});

test('a slice blocked on an in-PRD slice AND an external issue is still admitted', () => {
  // Ordering, not selection, decides whether it can actually run: the external
  // blocker never enters completedIssueNumbers, so the loop reports it blocked.
  const issues = [
    slice(463, { labels: READY, body: blockedBySection() }),
    slice(464, {
      labels: [...READY, 'status:blocked'],
      body: blockedBySection(463, 999),
    }),
  ];

  const { selected, admitted } = selectPrdSlices(issues, { prd: PRD });

  assert.deepEqual(
    selected.map((i) => i.number),
    [463, 464],
  );
  assert.deepEqual(
    admitted.map((i) => i.number),
    [464],
  );
});

test('a slice naming only itself as a blocker is deferred, not self-admitted', () => {
  const issues = [
    slice(470, {
      labels: [...READY, 'status:blocked'],
      body: blockedBySection(470),
    }),
  ];

  const { selected, deferred } = selectPrdSlices(issues, { prd: PRD });

  assert.deepEqual(selected, []);
  assert.equal(deferred.length, 1);
});

// ─── The label gate is otherwise unchanged ────────────────────────────────────

test('an issue missing ready-for-agent or type:afk is not selected', () => {
  const issues = [
    slice(470, { labels: ['type:afk'] }),
    slice(471, { labels: ['ready-for-agent'] }),
    slice(472, { labels: READY }),
  ];

  const { selected } = selectPrdSlices(issues, { prd: PRD });

  assert.deepEqual(
    selected.map((i) => i.number),
    [472],
  );
});

test('an issue belonging to a different PRD is not selected', () => {
  const issues = [
    slice(470, { labels: READY, prd: 999 }),
    slice(471, { labels: READY }),
  ];

  const { selected } = selectPrdSlices(issues, { prd: PRD });

  assert.deepEqual(
    selected.map((i) => i.number),
    [471],
  );
});

test('selection is ordered by issue number regardless of input order', () => {
  const issues = [
    slice(465, { labels: READY }),
    slice(463, { labels: READY }),
    slice(464, { labels: READY }),
  ];

  const { selected } = selectPrdSlices(issues, { prd: PRD });

  assert.deepEqual(
    selected.map((i) => i.number),
    [463, 464, 465],
  );
});

// ─── `only` narrows, never widens ─────────────────────────────────────────────

test('only restricts the run to the named slice', () => {
  const issues = [slice(463, { labels: READY }), slice(464, { labels: READY })];

  const { selected } = selectPrdSlices(issues, { prd: PRD, only: 464 });

  assert.deepEqual(
    selected.map((i) => i.number),
    [464],
  );
});

test('a stale status:blocked does not strand a slice whose blocker is complete', () => {
  // Before this rule, `--prd N --issue 465` against a slice still carrying a label
  // its blocker had already earned it out of failed outright: "not found as an open
  // AFK slice". The label lags the fact; the fact is what selection reads.
  const issues = [
    slice(464, { labels: [...READY, 'status:done'], state: 'CLOSED' }),
    slice(465, {
      labels: [...READY, 'status:blocked'],
      body: blockedBySection(464),
    }),
  ];

  const { selected, admitted, deferred } = selectPrdSlices(issues, {
    prd: PRD,
    only: 465,
  });

  assert.deepEqual(
    selected.map((i) => i.number),
    [465],
  );
  assert.deepEqual(
    admitted.map((i) => i.number),
    [465],
  );
  assert.deepEqual(deferred, []);
});

test('only does not override a deferral — naming a slice cannot widen the rule', () => {
  const issues = [
    slice(470, {
      labels: [...READY, 'status:blocked'],
      body: blockedBySection(999),
    }),
  ];

  const { selected, deferred } = selectPrdSlices(issues, {
    prd: PRD,
    only: 470,
  });

  assert.deepEqual(selected, []);
  assert.equal(deferred.length, 1);
});

// ─── Body parsing ─────────────────────────────────────────────────────────────

test('blockedBy reads `- None` as an explicit empty list', () => {
  assert.deepEqual(blockedBy({ body: '## Blocked by\n\n- None\n' }), []);
});

test('blockedBy stops at the next section heading', () => {
  const body = '## Blocked by\n\n- #463\n\n## Blocks\n\n- #465\n';
  assert.deepEqual(blockedBy({ body }), [463]);
  assert.deepEqual(blocks({ body }), [465]);
});

test('blockedBy on an issue with no such section is empty', () => {
  assert.deepEqual(blockedBy({ body: '## What to build\n\nthings\n' }), []);
});

// ─── PRD #772: prose in `## Blocked by` is not a dependency edge ───────────────

// The shape slice #774 carried when the run stalled: one genuine blocker, then a
// note whose issue references are explanation, one of them a negation.
const PROSE_NOTE_SECTION =
  '## Blocked by\n\n' +
  '- #773 — the ADR this rule implements\n\n' +
  'Note: **not** blocked by #771. Every stale citation it corrected pointed at a ' +
  'line that exists. #787 is the slice that needs it. (#771 has since merged.)\n\n' +
  '## Blocks\n\n- #787 — anchoring\n- #788 — tightening\n';

test('blockedBy ignores an issue reference that appears only in prose', () => {
  assert.deepEqual(blockedBy({ body: PROSE_NOTE_SECTION }), [773]);
});

test('blockedBy does not read a negated mention as a blocker', () => {
  const body =
    '## Blocked by\n\n- None — can start immediately. Does not wait on #272.\n';
  assert.deepEqual(blockedBy({ body }), []);
});

test('blockedBy reports a repeated reference once', () => {
  const body = '## Blocked by\n\n- #787 — anchors\n- #774\n- #787 again\n';
  assert.deepEqual(blockedBy({ body }), [787, 774]);
});

test('blockedBy accepts the list-item forms a slice body uses', () => {
  const body =
    '## Blocked by\n\n* #1\n- [#2](https://github.com/o/r/issues/2)\n' +
    '- [ ] #3\n1. #4\n  - #5 nested\n- see #6\n';
  assert.deepEqual(blockedBy({ body }), [1, 2, 3, 4, 5]);
});

test('blocks ignores prose the same way blockedBy does', () => {
  const body = '## Blocks\n\n- #788 — tightening\n\nIndirectly, #790.\n';
  assert.deepEqual(blocks({ body }), [788]);
});

test('a closed issue outside the PRD satisfies a dependency on it', () => {
  // #787's real blocker list named #771, a standalone bug that was already closed.
  const outside = { number: 771, state: 'CLOSED', labels: [], body: '' };
  const lookup = (n: number) => (n === 771 ? outside : undefined);

  assert.equal(isDependencySatisfied(771, { lookup }), true);
  const migrate = slice(787, { body: blockedBySection(774, 771) });
  assert.deepEqual(
    unfinishedDependencies(migrate, { completed: new Set([774]), lookup }),
    [],
  );
});

test('an open or unknown dependency is not satisfied', () => {
  const open = { number: 900, state: 'OPEN', labels: [], body: '' };
  const lookup = (n: number) => (n === 900 ? open : undefined);
  assert.equal(isDependencySatisfied(900, { lookup }), false);
  assert.equal(isDependencySatisfied(901, { lookup }), false);
  assert.equal(
    isDependencySatisfied(901, { completed: new Set([901]), lookup }),
    true,
    'completing in this run satisfies a dependency GitHub has not caught up on',
  );
});

// ADR 0111: a slice whose run did not end clean is integrated and status:done,
// but held open as ready-for-human — and what depends on it stays blocked.
test('a slice held for a person does not satisfy its dependents', () => {
  const held = {
    number: 913,
    state: 'OPEN',
    labels: [{ name: 'status:done' }, { name: 'ready-for-human' }],
    body: '',
  };
  const lookup = (n: number) => (n === 913 ? held : undefined);
  assert.equal(isCompleted(held), true, 'still skipped on a re-run');
  assert.equal(isSatisfiedAsDependency(held), false);
  assert.equal(isDependencySatisfied(913, { lookup }), false);
  const account = slice(918, { body: blockedBySection(913) });
  assert.deepEqual(unfinishedDependencies(account, { lookup }), [913]);
});

test('closing a held slice releases its dependents', () => {
  const released = {
    number: 913,
    state: 'CLOSED',
    labels: [{ name: 'status:done' }, { name: 'ready-for-human' }],
    body: '',
  };
  assert.equal(isSatisfiedAsDependency(released), true);
});

test('a done slice that is not held satisfies its dependents', () => {
  const done = {
    number: 912,
    state: 'OPEN',
    labels: [{ name: 'status:done' }],
  };
  assert.equal(isSatisfiedAsDependency(done), true);
});

test('a two-slice cycle is found once, whichever slice the walk starts from', () => {
  const pending = [
    slice(787, { body: blockedBySection(774) }),
    slice(774, { body: blockedBySection(787) }),
    slice(788, { body: blockedBySection(787, 774) }),
  ];
  assert.deepEqual(findDependencyCycles(pending), [[774, 787, 774]]);
});

test('a chain without a loop, or a self-reference, is not a cycle', () => {
  const pending = [
    slice(774, { body: blockedBySection(774) }),
    slice(787, { body: blockedBySection(774) }),
    slice(788, { body: blockedBySection(787) }),
  ];
  assert.deepEqual(findDependencyCycles(pending), []);
});

test('slices left blocked by a cycle are reported as a cycle, not as unfinished work', () => {
  const pending = [
    slice(774, { body: blockedBySection(787) }),
    slice(787, { body: blockedBySection(774) }),
    slice(788, { body: blockedBySection(787, 774) }),
  ];
  const reasons = Object.fromEntries(
    describeBlockedSlices(pending, { completed: new Set<number>() }).map(
      ({ issue, reason }) => [issue.number, reason],
    ),
  );
  assert.equal(reasons[774], 'dependency cycle: #774 → #787 → #774');
  assert.equal(reasons[787], 'dependency cycle: #774 → #787 → #774');
  assert.equal(reasons[788], 'blocked by unfinished slice(s): #787, #774');
});

test('the #772 run drains once prose is ignored and closed outside issues count', () => {
  const issues = new Map(
    [
      { number: 771, state: 'CLOSED', labels: [], body: 'a standalone bug' },
      slice(773, { state: 'CLOSED', body: blockedBySection() }),
    ].map((issue) => [issue.number, issue]),
  );
  const options = {
    completed: new Set<number>(),
    lookup: (n: number) => issues.get(n),
  };
  const pending = [
    slice(774, { body: PROSE_NOTE_SECTION }),
    slice(787, { body: blockedBySection(774, 771) }),
    slice(788, { body: blockedBySection(787, 774) }),
  ];

  const order = [];
  while (pending.length > 0) {
    const ready = pending.find(
      (issue) => unfinishedDependencies(issue, options).length === 0,
    );
    assert.ok(ready, `stalled with ${pending.map((i) => i.number)} pending`);
    order.push(ready.number);
    options.completed.add(ready.number);
    pending.splice(pending.indexOf(ready), 1);
  }
  assert.deepEqual(order, [774, 787, 788]);
});

test('isCompleted accepts either a closed state or status:done', () => {
  assert.equal(isCompleted({ state: 'CLOSED', labels: [] }), true);
  assert.equal(
    isCompleted({ state: 'OPEN', labels: [{ name: 'status:done' }] }),
    true,
  );
  assert.equal(isCompleted({ state: 'OPEN', labels: [] }), false);
});

test('slicesOfPrd matches the PRD back-reference, not a bare number', () => {
  const issues = [
    { number: 1, body: 'PRD: #461' },
    { number: 2, body: 'mentions 461 in prose' },
    { number: 3, body: undefined },
  ];
  assert.deepEqual(
    slicesOfPrd(issues, 461).map((i) => i.number),
    [1],
  );
});

// ─── Assembly reporting ───────────────────────────────────────────────────────

test('describeAssembly reports partial assembly rather than claiming completion', () => {
  const issues = [
    slice(463, { labels: ['status:done'], state: 'CLOSED' }),
    slice(464, { labels: READY }),
    slice(465, { labels: READY }),
  ];

  const assembly = describeAssembly(issues, PRD);

  assert.equal(assembly.total, 3);
  assert.equal(assembly.done, 1);
  assert.equal(assembly.complete, false);
  assert.equal(assembly.summary, '1/3 slice(s) assembled');
});

test('describeAssembly reports completion only when every slice is done', () => {
  const issues = [
    slice(463, { state: 'CLOSED' }),
    slice(464, { labels: ['status:done'] }),
  ];

  const assembly = describeAssembly(issues, PRD);

  assert.equal(assembly.complete, true);
  assert.equal(assembly.summary, '2/2 slice(s) assembled');
});

test('describeAssembly does not claim completion for a PRD with no slices', () => {
  const assembly = describeAssembly([], PRD);
  assert.equal(assembly.complete, false);
  assert.equal(assembly.summary, 'no slices found');
});
