import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const CHECKER = 'tools/scripts/check-review-golden-results.ts';

const CAUGHT_LINE = JSON.stringify({
  date: '2026-09-30',
  run_id: '111',
  commit: 'a'.repeat(40),
  case: 'export-envelope-drops-tasks',
  outcome: 'caught',
  void_reason: null,
  recall: 1,
  total_cost_usd: 1.47,
  turns: 14,
  model: 'claude-sonnet-5',
});

const VOID_LINE = JSON.stringify({
  date: '2026-09-30',
  run_id: '111',
  commit: 'a'.repeat(40),
  case: 'release-bump-leaves-generated-client-stale',
  outcome: 'void',
  void_reason: 'rate-limit',
  recall: null,
  total_cost_usd: null,
  turns: null,
  model: 'claude-sonnet-5',
});

const SET = JSON.stringify({
  cases: [
    { id: 'export-envelope-drops-tasks', tier: 'frontier' },
    { id: 'release-bump-leaves-generated-client-stale', tier: 'guard' },
  ],
});

// Both generated sections sit inside a prettier-ignore range, so a formatted
// commit and the checker's own --write produce the same text.
const unformatted = (body: string) =>
  `<!-- prettier-ignore-start -->\n${body}\n<!-- prettier-ignore-end -->`;

const NO_RUNS = unformatted('_No recorded runs yet._');

const STANDING_HEADER =
  '| Case | Declared tier | Scored runs | Caught of last ten | Rate | Stands at | Why |\n' +
  '| --- | --- | --- | --- | --- | --- | --- |\n';
const UNDER_TEN = 'declared; under 10 scored runs, so nothing moves';

// What the standing table says of SET before anything is recorded.
const NO_STANDING = unformatted(
  STANDING_HEADER +
    `| \`export-envelope-drops-tasks\` | \`frontier\` | 0 | 0 of 0 | — | \`frontier\` | ${UNDER_TEN} |\n` +
    `| \`release-bump-leaves-generated-client-stale\` | \`guard\` | 0 | 0 of 0 | — | \`guard\` | ${UNDER_TEN} |`,
);

// And after CAUGHT_LINE: one scored run, one catch, and no move.
const ONE_CATCH_STANDING = unformatted(
  STANDING_HEADER +
    `| \`export-envelope-drops-tasks\` | \`frontier\` | 1 | 1 of 1 | 100% | \`frontier\` | ${UNDER_TEN} |\n` +
    `| \`release-bump-leaves-generated-client-stale\` | \`guard\` | 0 | 0 of 0 | — | \`guard\` | ${UNDER_TEN} |`,
);

const RUNS_HEADER =
  '| Date | Run ID | Model | Cases | Result | Commit |\n' +
  '| --- | --- | --- | --- | --- | --- |\n';

const LEDGER_TEMPLATE = (
  generated: string,
  standing: string,
) => `# Golden replay results

## Tiers

<!-- GENERATED:golden-standing:START -->

${standing}

<!-- GENERATED:golden-standing:END -->

## Runs

| Date | Model | Cases | Result | Reviewer change under test |
| --- | --- | --- | --- | --- |
| 2026-09-07 | \`claude-sonnet-5\` | 3 (pre-tier) | 1 of 3 | none — first measurement |

### Recorded runs

<!-- GENERATED:golden-runs:START -->

${generated}

<!-- GENERATED:golden-runs:END -->
`;

/**
 * The checker reads three fixed paths, so each case runs it in a throwaway
 * tree holding just those files. `record` is the raw jsonl text; `generated`
 * and `standing` are what sit between the ledger's two marker pairs; `ledger`
 * replaces the whole ledger.
 */
const runOn = ({
  record = '',
  generated = NO_RUNS,
  standing = NO_STANDING,
  ledger,
  args = [],
}: {
  record?: string;
  generated?: string;
  standing?: string;
  ledger?: string;
  args?: string[];
} = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'review-golden-results-'));
  mkdirSync(join(dir, 'docs', 'review'), { recursive: true });
  mkdirSync(join(dir, 'tools', 'config'), { recursive: true });
  writeFileSync(join(dir, 'tools', 'config', 'review-golden-set.json'), SET);
  writeFileSync(
    join(dir, 'docs', 'review', 'golden-replay-results.jsonl'),
    record,
    'utf8',
  );
  const ledgerPath = join(dir, 'docs', 'review', 'golden-replay-results.md');
  writeFileSync(
    ledgerPath,
    ledger ?? LEDGER_TEMPLATE(generated, standing),
    'utf8',
  );
  const read = () => readFileSync(ledgerPath, 'utf8');
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(process.cwd(), CHECKER), ...args],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, out: stdout, dir, read };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: e.status,
      out: `${e.stdout ?? ''}${e.stderr ?? ''}`,
      dir,
      read,
    };
  }
};

test('an empty record matches the placeholder generated section', () => {
  const { code, out } = runOn({});
  assert.equal(code, 0, out);
  assert.match(out, /OK — 0 recorded line/);
});

test('a recorded run matching the generated sections passes', () => {
  const generated = unformatted(
    RUNS_HEADER +
      `| 2026-09-30 | \`111\` | \`claude-sonnet-5\` | 2 | 1 of 1 scorable, 1 void | \`${'a'.repeat(7)}\` |`,
  );
  const { code, out } = runOn({
    record: `${CAUGHT_LINE}\n${VOID_LINE}\n`,
    generated,
    standing: ONE_CATCH_STANDING,
  });
  assert.equal(code, 0, out);
  assert.match(out, /OK — 2 recorded line/);
});

// This is the drift the whole checker exists to catch: the record moved
// (a case caught became a case missed) and nobody regenerated the ledger.
test('a stale generated section is caught as drift', () => {
  const staleGenerated = unformatted(
    RUNS_HEADER +
      `| 2026-09-30 | \`111\` | \`claude-sonnet-5\` | 1 | 0 of 1 | \`${'a'.repeat(7)}\` |`,
  );
  const { code, out } = runOn({
    record: `${CAUGHT_LINE}\n`,
    generated: staleGenerated,
    standing: ONE_CATCH_STANDING,
  });
  assert.equal(code, 1, out);
  assert.match(out, /generated Runs section does not match/);
});

test('a placeholder generated section left in place after a run was recorded is caught', () => {
  const { code, out } = runOn({
    record: `${CAUGHT_LINE}\n`,
    standing: ONE_CATCH_STANDING,
  });
  assert.equal(code, 1, out);
  assert.match(out, /generated Runs section does not match/);
});

// The standing table's own drift (issue #937): a run was recorded, the Runs
// section was regenerated, and the table still shows the case with no scored
// run — so the ledger states a rate the record does not carry.
test('a stale standing table is caught as drift', () => {
  const generated = unformatted(
    RUNS_HEADER +
      `| 2026-09-30 | \`111\` | \`claude-sonnet-5\` | 1 | 1 of 1 | \`${'a'.repeat(7)}\` |`,
  );
  const { code, out } = runOn({ record: `${CAUGHT_LINE}\n`, generated });
  assert.equal(code, 1, out);
  assert.match(out, /generated standing section does not match/);
  assert.doesNotMatch(out, /generated Runs section does not match/);
});

// A table Prettier has padded is not the text the checker renders, which is
// why the sections are wrapped in a prettier-ignore range; without the range
// the same table is drift.
test('a generated section outside a prettier-ignore range is caught as drift', () => {
  const { code, out } = runOn({ generated: '_No recorded runs yet._' });
  assert.equal(code, 1, out);
  assert.match(out, /generated Runs section does not match/);
});

// What the scheduled replay runs after appending to the record, so the
// record never reaches main without its ledger.
test('--write regenerates both sections and the result passes the check', () => {
  const written = runOn({ record: `${CAUGHT_LINE}\n`, args: ['--write'] });
  assert.equal(written.code, 0, written.out);
  assert.match(written.out, /wrote Runs and standing/);
  const ledger = written.read();
  assert.match(ledger, /\| 2026-09-30 \| `111` \|/);
  assert.match(ledger, /\| 1 \| 1 of 1 \| 100% \| `frontier` \|/);
  assert.match(ledger, /none — first measurement/);

  const checked = runOn({ record: `${CAUGHT_LINE}\n`, ledger });
  assert.equal(checked.code, 0, checked.out);
});

test('--write leaves a ledger already in sync untouched', () => {
  const before = LEDGER_TEMPLATE(NO_RUNS, NO_STANDING);
  const { code, out, read } = runOn({ ledger: before, args: ['--write'] });
  assert.equal(code, 0, out);
  assert.match(out, /nothing written/);
  assert.equal(read(), before);
});

test('an invalid record line fails loudly, naming the line', () => {
  const { code, out } = runOn({ record: 'not json\n' });
  assert.equal(code, 2, out);
  assert.match(out, /line 1: not valid JSON/);
});

// ADR 0101: a void must never be scorable, so a hand-edited void carrying a
// recall has to be rejected rather than silently read as a catch or a miss.
test('a void record carrying a recall is rejected as corrupt', () => {
  const corrupt = JSON.stringify({
    ...JSON.parse(VOID_LINE),
    recall: 1,
  });
  const { code, out } = runOn({ record: `${corrupt}\n` });
  assert.equal(code, 2, out);
  assert.match(out, /carries no recall/);
});

test('missing markers cannot run', () => {
  const { code, out } = runOn({
    ledger: '# Golden replay results\n\nNo markers here.\n',
  });
  assert.equal(code, 2, out);
  assert.match(out, /no .*marker pair/);
});

test('a ledger with only one of the two marker pairs cannot run', () => {
  const { code, out } = runOn({
    ledger: `# Golden replay results\n\n<!-- GENERATED:golden-runs:START -->\n\n${NO_RUNS}\n\n<!-- GENERATED:golden-runs:END -->\n`,
  });
  assert.equal(code, 2, out);
  assert.match(out, /golden-standing:START.*marker pair/);
});

test('--print renders both expected sections without failing', () => {
  const { code, out } = runOn({
    record: `${CAUGHT_LINE}\n`,
    generated: 'anything, --print never reads it',
    args: ['--print'],
  });
  assert.equal(code, 0, out);
  assert.match(
    out,
    /\| Date \| Run ID \| Model \| Cases \| Result \| Commit \|/,
  );
  assert.match(out, /\| Case \| Declared tier \| Scored runs \|/);
});
