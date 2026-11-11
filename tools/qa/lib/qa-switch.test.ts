// Contracts for the Before/After switch plan (ADR 0147 decision 2), exercised
// through its public entry: planSides, planStart, planSwitch, planStop,
// parseStackArgs, parseSwitchArgs, and SwitchPlanError. Pure functions, so no
// fixtures and no subprocess; git ancestry, dependency state, and the database
// are facts passed in as arguments.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  SwitchPlanError,
  parseStackArgs,
  parseSwitchArgs,
  planSides,
  planStart,
  planStop,
  planSwitch,
  type ChangeKind,
  type StartPlanInput,
  type Step,
} from './qa-switch.ts';
import type { Side } from './qa-stack.ts';

const MERGE_BASE = 'a1b2c3d';
const HEAD = 'e4f5a6b7';

const START: StartPlanInput = {
  sides: ['before', 'after'],
  mergeBase: MERGE_BASE,
  head: HEAD,
  mergeBaseIsAncestor: true,
  ownDatabase: true,
  installNeeded: true,
};

const RUNNING: { sides: Side[]; mergeBase: string; head: string } = {
  sides: ['before', 'after'],
  mergeBase: MERGE_BASE,
  head: HEAD,
};

describe('planSides', () => {
  const ROWS: readonly {
    name: string;
    changeKind: ChangeKind;
    withBefore: boolean;
    beforeOnly: boolean;
    sides: Side[];
  }[] = [
    {
      name: 'a fix serves Before then After',
      changeKind: 'fix',
      withBefore: false,
      beforeOnly: false,
      sides: ['before', 'after'],
    },
    {
      name: 'a feature serves After only',
      changeKind: 'feature',
      withBefore: false,
      beforeOnly: false,
      sides: ['after'],
    },
    {
      name: 'a feature with --with-before serves Before then After',
      changeKind: 'feature',
      withBefore: true,
      beforeOnly: false,
      sides: ['before', 'after'],
    },
    {
      name: 'a fix with --before-only serves Before only',
      changeKind: 'fix',
      withBefore: false,
      beforeOnly: true,
      sides: ['before'],
    },
    {
      name: 'a feature with --before-only serves Before only',
      changeKind: 'feature',
      withBefore: false,
      beforeOnly: true,
      sides: ['before'],
    },
  ];

  for (const row of ROWS) {
    test(row.name, () => {
      assert.deepEqual(
        planSides({
          changeKind: row.changeKind,
          withBefore: row.withBefore,
          beforeOnly: row.beforeOnly,
        }),
        row.sides,
      );
    });
  }

  test('--before-only with --with-before throws SwitchPlanError naming the conflict', () => {
    assert.throws(
      () =>
        planSides({
          changeKind: 'feature',
          withBefore: true,
          beforeOnly: true,
        }),
      (error: unknown) =>
        error instanceof SwitchPlanError && /conflict/.test(error.message),
    );
  });
});

describe('planStart', () => {
  test('a fix with its own database and changed dependencies runs the full ordered sequence on the merge-base', () => {
    assert.deepEqual(planStart(START), [
      { kind: 'start-database' },
      { kind: 'wait-database' },
      { kind: 'checkout', commit: MERGE_BASE },
      { kind: 'install' },
      { kind: 'migrate-forward' },
      { kind: 'generate' },
      { kind: 'seed' },
      { kind: 'start-services', commit: MERGE_BASE },
      { kind: 'check-served-commit', commit: MERGE_BASE },
    ]);
  });

  test('a feature on a given database with installed dependencies uses the head only and seeds once', () => {
    const steps = planStart({
      ...START,
      sides: ['after'],
      ownDatabase: false,
      installNeeded: false,
    });
    assert.deepEqual(steps, [
      { kind: 'checkout', commit: HEAD },
      { kind: 'migrate-forward' },
      { kind: 'generate' },
      { kind: 'seed' },
      { kind: 'start-services', commit: HEAD },
      { kind: 'check-served-commit', commit: HEAD },
    ]);
    assert.equal(steps.filter((step) => step.kind === 'seed').length, 1);
  });

  const REFUSALS: readonly {
    name: string;
    input: StartPlanInput;
    message: RegExp;
  }[] = [
    {
      name: 'a merge-base that is not an ancestor of the head',
      input: { ...START, mergeBaseIsAncestor: false },
      message: /backward migration/,
    },
    {
      name: 'a merge-base equal to the head',
      input: { ...START, mergeBase: HEAD },
      message: /same commit/,
    },
    {
      name: 'sides out of order (After before Before)',
      input: { ...START, sides: ['after', 'before'] },
      message: /backward migration/,
    },
    {
      name: 'a side listed twice',
      input: { ...START, sides: ['before', 'before'] },
      message: /serves before twice/,
    },
    {
      name: 'an empty side list',
      input: { ...START, sides: [] },
      message: /no side to serve/,
    },
  ];

  for (const { name, input, message } of REFUSALS) {
    test(`refuses ${name} with SwitchPlanError before any step`, () => {
      assert.throws(
        () => planStart(input),
        (error: unknown) =>
          error instanceof SwitchPlanError && message.test(error.message),
      );
    });
  }
});

describe('planSwitch', () => {
  test('moving Before to After stops, checks out the head, installs, migrates forward, and restarts', () => {
    assert.deepEqual(
      planSwitch({
        state: { ...RUNNING, current: 0 },
        to: 'after',
        installNeeded: true,
      }),
      [
        { kind: 'stop-services' },
        { kind: 'checkout', commit: HEAD },
        { kind: 'install' },
        { kind: 'migrate-forward' },
        { kind: 'start-services', commit: HEAD },
        { kind: 'check-served-commit', commit: HEAD },
      ],
    );
  });

  test('a switch without changed dependencies has no install step, and never re-seeds or restarts the database', () => {
    const kinds = planSwitch({
      state: { ...RUNNING, current: 0 },
      to: 'after',
      installNeeded: false,
    }).map((step) => step.kind);
    assert.deepEqual(kinds, [
      'stop-services',
      'checkout',
      'migrate-forward',
      'start-services',
      'check-served-commit',
    ]);
    for (const forbidden of ['seed', 'start-database', 'wait-database']) {
      assert.ok(!kinds.includes(forbidden as Step['kind']), forbidden);
    }
  });

  test('a switch keeps the required order: checkout, then migrate, then start, then check', () => {
    const kinds = planSwitch({
      state: { ...RUNNING, current: 0 },
      to: 'after',
      installNeeded: true,
    }).map((step) => step.kind);
    const index = (kind: Step['kind']) => kinds.indexOf(kind);
    const checkout = index('checkout');
    const migrate = index('migrate-forward');
    const start = index('start-services');
    const check = index('check-served-commit');
    assert.ok(checkout >= 0, 'checkout step is present');
    assert.ok(migrate >= 0, 'migrate-forward step is present');
    assert.ok(start >= 0, 'start-services step is present');
    assert.ok(check >= 0, 'check-served-commit step is present');
    assert.ok(checkout < migrate);
    assert.ok(migrate < start);
    assert.ok(start < check);
  });

  test('moving After back to Before is refused with a message naming the backward migration and --before-only', () => {
    assert.throws(
      () =>
        planSwitch({
          state: { ...RUNNING, current: 1 },
          to: 'before',
          installNeeded: false,
        }),
      (error: unknown) =>
        error instanceof SwitchPlanError &&
        /backward migration/.test(error.message) &&
        error.message.includes('--before-only'),
    );
  });

  const SERVED: readonly {
    name: string;
    current: number;
    to: 'before' | 'after';
    commit: string;
  }[] = [
    { name: 'Before', current: 0, to: 'before', commit: MERGE_BASE },
    { name: 'After', current: 1, to: 'after', commit: HEAD },
  ];

  for (const { name, current, to, commit } of SERVED) {
    test(`switching to ${name} while it is already served only re-checks its commit`, () => {
      assert.deepEqual(
        planSwitch({
          state: { ...RUNNING, current },
          to,
          installNeeded: true,
        }),
        [{ kind: 'check-served-commit', commit }],
      );
    });
  }

  test('switching to a side this run does not serve throws SwitchPlanError', () => {
    assert.throws(
      () =>
        planSwitch({
          state: {
            sides: ['after'],
            current: 0,
            mergeBase: MERGE_BASE,
            head: HEAD,
          },
          to: 'before',
          installNeeded: false,
        }),
      (error: unknown) =>
        error instanceof SwitchPlanError && /not before/.test(error.message),
    );
  });
});

describe('planStop', () => {
  test('a stack with its own container stops its services and removes the container', () => {
    assert.deepEqual(planStop({ container: 'myorganiser-qa-db' }), [
      { kind: 'stop-services' },
      { kind: 'remove-database' },
    ]);
  });

  test('a stack given --database-url stops its services and leaves the database alone', () => {
    assert.deepEqual(planStop({ container: null }), [
      { kind: 'stop-services' },
    ]);
  });
});

test('parseStackArgs parses a valid start line into the start command with flags defaulted', () => {
  assert.deepEqual(
    parseStackArgs([
      'start',
      '--worktree',
      '/work/tree',
      '--change-kind',
      'fix',
      '--merge-base',
      MERGE_BASE,
      '--head',
      HEAD,
    ]),
    {
      command: 'start',
      worktree: '/work/tree',
      changeKind: 'fix',
      mergeBase: MERGE_BASE,
      head: HEAD,
      withBefore: false,
      beforeOnly: false,
      databaseUrl: null,
    },
  );
});

test('parseStackArgs parses stop and status with no arguments', () => {
  assert.deepEqual(parseStackArgs(['stop']), { command: 'stop' });
  assert.deepEqual(parseStackArgs(['status']), { command: 'status' });
});

test('parseStackArgs keeps both Before flags and the given database URL on a start line', () => {
  const databaseUrl = 'postgresql://example';
  assert.deepEqual(
    parseStackArgs([
      'start',
      '--worktree',
      '/work/tree',
      '--change-kind',
      'fix',
      '--merge-base',
      MERGE_BASE,
      '--head',
      HEAD,
      '--with-before',
      '--before-only',
      '--database-url',
      databaseUrl,
    ]),
    {
      command: 'start',
      worktree: '/work/tree',
      changeKind: 'fix',
      mergeBase: MERGE_BASE,
      head: HEAD,
      withBefore: true,
      beforeOnly: true,
      databaseUrl,
    },
  );
});

const VALID_START = [
  'start',
  '--worktree',
  '/work/tree',
  '--change-kind',
  'feature',
  '--merge-base',
  MERGE_BASE,
  '--head',
  HEAD,
];

const REJECTED_STACK_ARGS: readonly {
  name: string;
  argv: string[];
  message: RegExp;
}[] = [
  {
    name: 'a start line without --worktree',
    argv: VALID_START.filter((_, i) => i !== 1 && i !== 2),
    message: /--worktree is required/,
  },
  {
    name: 'an unknown --change-kind',
    argv: VALID_START.map((arg) => (arg === 'feature' ? 'bugfix' : arg)),
    message: /--change-kind must be fix or feature/,
  },
  {
    name: 'a --merge-base that is not a sha',
    argv: VALID_START.map((arg) => (arg === MERGE_BASE ? 'main' : arg)),
    message: /--merge-base must be a commit sha/,
  },
  {
    name: 'an unknown flag',
    argv: [...VALID_START, '--bogus'],
    message: /unknown argument "--bogus"/,
  },
  {
    name: 'a flag given twice',
    argv: [...VALID_START, '--worktree', '/other'],
    message: /--worktree given twice/,
  },
  {
    name: 'a valued flag with no value at the end',
    argv: [...VALID_START, '--database-url'],
    message: /--database-url needs a value/,
  },
  {
    name: 'a valued flag followed by another flag',
    argv: ['start', '--worktree', '--change-kind', 'fix'],
    message: /--worktree needs a value/,
  },
  {
    name: 'an unknown argument to stop',
    argv: ['stop', '--force'],
    message: /unknown argument "--force"/,
  },
  {
    name: 'no command',
    argv: [],
    message: /usage: node tools\/qa\/qa-stack\.ts start/,
  },
  {
    name: 'an unknown command',
    argv: ['bogus'],
    message: /usage: node tools\/qa\/qa-stack\.ts start/,
  },
  {
    name: 'a --head that is not a sha',
    argv: VALID_START.map((arg) => (arg === HEAD ? 'main' : arg)),
    message: /--head must be a commit sha/,
  },
];

describe('parseStackArgs: rejected arguments', () => {
  for (const { name, argv, message } of REJECTED_STACK_ARGS) {
    test(`rejects ${name} with an error result`, () => {
      const result = parseStackArgs(argv);
      assert.ok('error' in result, 'expected an error result');
      assert.match(result.error, message);
    });
  }
});

test('parseSwitchArgs parses --worktree and --to into the switch target', () => {
  assert.deepEqual(
    parseSwitchArgs(['--worktree', '/work/tree', '--to', 'after']),
    { worktree: '/work/tree', to: 'after' },
  );
});

const REJECTED_SWITCH_ARGS: readonly {
  name: string;
  argv: string[];
  message: RegExp;
}[] = [
  {
    name: 'a --to that is neither before nor after',
    argv: ['--worktree', '/work/tree', '--to', 'sideways'],
    message: /--to must be before or after/,
  },
  {
    name: 'a missing --worktree',
    argv: ['--to', 'after'],
    message: /--worktree is required/,
  },
  {
    name: 'an unknown flag',
    argv: ['--worktree', '/work/tree', '--to', 'after', '--force'],
    message: /unknown argument/,
  },
];

describe('parseSwitchArgs: rejected arguments', () => {
  for (const { name, argv, message } of REJECTED_SWITCH_ARGS) {
    test(`rejects ${name} with an error result`, () => {
      const result = parseSwitchArgs(argv);
      assert.ok('error' in result, 'expected an error result');
      assert.match(result.error, message);
    });
  }
});
