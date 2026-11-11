/**
 * The Before/After switch, planned as a pure sequence of steps and checked
 * before anything runs (ADR 0147 decision 2).
 *
 * A fix serves its Pull Request's merge-base (Before), then its head (After).
 * A feature serves After only, unless a scenario claims existing behaviour
 * still works. Each move is: stop the services, check out, migrate forward,
 * start the services again, and check the served commit. Before always runs
 * ahead of After, so `prisma migrate deploy` only ever moves forward; an order
 * that would need a backward migration is refused here, as a plan, before a
 * step runs. The Prisma client is generated before the seed, which loads it
 * (the backend regenerates it itself on every start). The QA Accounts are
 * seeded once, when the stack starts, and the
 * switch never re-seeds, so Before and After share the same data.
 *
 * Pure: facts (ancestry, whether `yarn.lock` changed) are passed in. The
 * steps are run by `qa-stack-executor.ts`; the command-line wrappers are
 * `tools/qa/qa-stack.ts` and `tools/qa/qa-switch.ts`.
 */
import type { QaStackState, Side } from './qa-stack.ts';

export const SIDES = ['before', 'after'] as const satisfies readonly Side[];

export type Step =
  | { kind: 'start-database' }
  | { kind: 'wait-database' }
  | { kind: 'stop-services' }
  | { kind: 'checkout'; commit: string }
  | { kind: 'install' }
  | { kind: 'migrate-forward' }
  | { kind: 'generate' }
  | { kind: 'seed' }
  | { kind: 'start-services'; commit: string }
  | { kind: 'check-served-commit'; commit: string }
  | { kind: 'remove-database' };

/** A plan that must not run. The executors exit 1 with its message. */
export class SwitchPlanError extends Error {}

export type ChangeKind = 'fix' | 'feature';

export interface SidesInput {
  changeKind: ChangeKind;
  /** A feature scenario claims existing behaviour still works. */
  withBefore: boolean;
  /** Only the merge-base, on a fresh stack: a feature's re-run after an After failure. */
  beforeOnly: boolean;
}

/** The sides a run serves, in the order it serves them. */
export function planSides({
  changeKind,
  withBefore,
  beforeOnly,
}: SidesInput): Side[] {
  if (beforeOnly && withBefore) {
    throw new SwitchPlanError('--before-only and --with-before conflict');
  }
  if (beforeOnly) return ['before'];
  if (changeKind === 'fix' || withBefore) return ['before', 'after'];
  return ['after'];
}

export function commitFor(
  side: Side,
  { mergeBase, head }: { mergeBase: string; head: string },
): string {
  return side === 'before' ? mergeBase : head;
}

export interface StartPlanInput {
  sides: Side[];
  mergeBase: string;
  head: string;
  /** `git merge-base --is-ancestor <mergeBase> <head>` succeeded. */
  mergeBaseIsAncestor: boolean;
  /** The stack starts its own container (no `--database-url` given). */
  ownDatabase: boolean;
  /** The worktree has no installed dependencies, or `yarn.lock` differs from what was installed. */
  installNeeded: boolean;
}

/** The steps that bring a stack up on the first side it serves. */
export function planStart(input: StartPlanInput): Step[] {
  const { sides, mergeBase, head } = input;
  checkSideOrder(sides);
  if (mergeBase === head) {
    throw new SwitchPlanError(
      `the merge-base and the head are the same commit (${head}); there is no Before to compare`,
    );
  }
  if (!input.mergeBaseIsAncestor) {
    throw new SwitchPlanError(
      `the merge-base ${mergeBase} is not an ancestor of the head ${head}, so serving them in turn could need a backward migration`,
    );
  }
  const commit = commitFor(sides[0], input);
  return [
    ...(input.ownDatabase
      ? [
          { kind: 'start-database' } as const,
          { kind: 'wait-database' } as const,
        ]
      : []),
    { kind: 'checkout', commit },
    ...(input.installNeeded ? [{ kind: 'install' } as const] : []),
    { kind: 'migrate-forward' },
    { kind: 'generate' },
    { kind: 'seed' },
    { kind: 'start-services', commit },
    { kind: 'check-served-commit', commit },
  ];
}

/** Before ahead of After, each at most once. */
function checkSideOrder(sides: readonly Side[]): void {
  if (sides.length === 0) throw new SwitchPlanError('no side to serve');
  const indexes = sides.map((side) => SIDES.indexOf(side));
  for (let i = 1; i < indexes.length; i++) {
    if (indexes[i] === indexes[i - 1]) {
      throw new SwitchPlanError(
        `${sides.join(' then ')} serves ${sides[i]} twice`,
      );
    }
    if (indexes[i] < indexes[i - 1]) {
      throw new SwitchPlanError(
        `${sides.join(' then ')} would serve Before after After, which needs a backward migration`,
      );
    }
  }
}

export interface SwitchPlanInput {
  state: Pick<QaStackState, 'sides' | 'current' | 'mergeBase' | 'head'>;
  to: Side;
  /** `yarn.lock` differs between the served commit and the target. */
  installNeeded: boolean;
}

/**
 * The steps that move a running stack to `to`. Moving to the side already
 * served only re-checks it. Moving back is refused: Before cannot follow
 * After without rolling the database back.
 */
export function planSwitch({
  state,
  to,
  installNeeded,
}: SwitchPlanInput): Step[] {
  const target = state.sides.indexOf(to);
  if (target === -1) {
    throw new SwitchPlanError(
      `this run serves ${state.sides.join(' then ')}, not ${to}`,
    );
  }
  const commit = commitFor(to, state);
  if (target === state.current) {
    return [{ kind: 'check-served-commit', commit }];
  }
  if (target < state.current) {
    throw new SwitchPlanError(
      `switching to ${to} after ${state.sides[state.current]} would need a backward migration; run "yarn qa:stack:stop", then start a fresh stack with --before-only`,
    );
  }
  return [
    { kind: 'stop-services' },
    { kind: 'checkout', commit },
    ...(installNeeded ? [{ kind: 'install' } as const] : []),
    { kind: 'migrate-forward' },
    { kind: 'start-services', commit },
    { kind: 'check-served-commit', commit },
  ];
}

/** Stopping touches only what the stack recorded: its process groups and its own container. */
export function planStop(state: Pick<QaStackState, 'container'>): Step[] {
  return [
    { kind: 'stop-services' },
    ...(state.container ? [{ kind: 'remove-database' } as const] : []),
  ];
}

const SHA = /^[0-9a-f]{7,40}$/;

export type StackArgs =
  | {
      command: 'start';
      worktree: string;
      changeKind: ChangeKind;
      mergeBase: string;
      head: string;
      withBefore: boolean;
      beforeOnly: boolean;
      databaseUrl: string | null;
    }
  | { command: 'stop' }
  | { command: 'status' };

export const STACK_USAGE =
  'usage: node tools/qa/qa-stack.ts start --worktree <path> --change-kind fix|feature --merge-base <sha> --head <sha> [--with-before | --before-only] [--database-url <url>]\n       node tools/qa/qa-stack.ts stop | status';

export const SWITCH_USAGE =
  'usage: node tools/qa/qa-switch.ts --worktree <path> --to before|after';

/** Reads `--flag value` pairs and bare `--flag`s; anything else is an error. */
function readFlags(
  argv: readonly string[],
  valued: readonly string[],
  bare: readonly string[],
): Map<string, string | true> | string {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags.has(arg)) return `${arg} given twice`;
    if (valued.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return `${arg} needs a value`;
      }
      flags.set(arg, value);
      i++;
    } else if (bare.includes(arg)) {
      flags.set(arg, true);
    } else {
      return `unknown argument "${arg}"`;
    }
  }
  return flags;
}

export function parseStackArgs(
  argv: readonly string[],
): StackArgs | { error: string } {
  const [command, ...rest] = argv;
  if (command === 'stop' || command === 'status') {
    return rest.length === 0
      ? { command }
      : { error: `unknown argument "${rest[0]}"` };
  }
  if (command !== 'start') return { error: STACK_USAGE };
  const flags = readFlags(
    rest,
    ['--worktree', '--change-kind', '--merge-base', '--head', '--database-url'],
    ['--with-before', '--before-only'],
  );
  if (typeof flags === 'string') return { error: flags };
  const worktree = flags.get('--worktree');
  const changeKind = flags.get('--change-kind');
  const mergeBase = flags.get('--merge-base');
  const head = flags.get('--head');
  const databaseUrl = flags.get('--database-url');
  if (typeof worktree !== 'string') return { error: '--worktree is required' };
  if (changeKind !== 'fix' && changeKind !== 'feature') {
    return { error: '--change-kind must be fix or feature' };
  }
  if (typeof mergeBase !== 'string' || !SHA.test(mergeBase)) {
    return { error: '--merge-base must be a commit sha' };
  }
  if (typeof head !== 'string' || !SHA.test(head)) {
    return { error: '--head must be a commit sha' };
  }
  return {
    command: 'start',
    worktree,
    changeKind,
    mergeBase,
    head,
    withBefore: flags.has('--with-before'),
    beforeOnly: flags.has('--before-only'),
    databaseUrl: typeof databaseUrl === 'string' ? databaseUrl : null,
  };
}

export function parseSwitchArgs(
  argv: readonly string[],
): { worktree: string; to: Side } | { error: string } {
  const flags = readFlags(argv, ['--worktree', '--to'], []);
  if (typeof flags === 'string') return { error: flags };
  const worktree = flags.get('--worktree');
  const to = flags.get('--to');
  if (typeof worktree !== 'string') return { error: '--worktree is required' };
  if (to !== 'before' && to !== 'after') {
    return { error: '--to must be before or after' };
  }
  return { worktree, to };
}
