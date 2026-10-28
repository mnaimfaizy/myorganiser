// Covers the matcher and the two extractions the allowlist gate compares.
//
// The matcher carries the risk. It decides whether a command a document hands
// the reviewer is one the harness would permit, and every way it can be wrong
// is a way this gate passes while the reviewer is refused: a prefix entry read
// as a substring permits commands nobody granted, and a prefix entry carrying
// a flag read as if the flag were optional hides the shape that leaves an
// entry matching nothing anyone was told to run.
//
// The extractions matter for the same reason the checklist parser's tests do —
// a parser that reads nothing passes everything.
//
// The interception direction is tested on the case that bought it. The gate
// passed for two runs while the reviewer was refused an instructed command
// eleven times, because it compared the instructions against `--allowedTools`
// and nothing else; the refusal came from an `ask` rule in the repository's own
// project settings, which outranks the grant (ADR 0099). A suite that only
// proved direction 1 would still be green today.
//
// Direction 3 is the same mechanism on a grant no document instructs. Direction
// 2 stays green there: it only sees a command a document names. The suite has
// to fail a grant an ask rule repeats, fail a grant an ask rule narrows, and
// stay green on `git merge-base` against `git merge`, which a character-prefix
// comparison would call an override.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOT_THE_REVIEWERS_TO_RUN,
  PROGRAMS,
  assertFileGrants,
  assertGrantRetractions,
  assertToolAllowlist,
  commandsFrom,
  extractInstructions,
  formatFileGrant,
  formatFinding,
  formatInterception,
  formatRetraction,
  matchesEntry,
  nearestEntry,
  parseAllowedTools,
  parseInterposedRules,
  parseToolEntry,
  splitToolList,
  unknownGrantedPrograms,
  type GrantRetractionExemption,
} from './check-review-tool-allowlist.ts';
import { tokenize } from './lib/shell-command.ts';

const entry = (raw: string) => parseToolEntry(raw);
const permits = (raw: string, command: string) =>
  matchesEntry(entry(raw), tokenize(command));

test('a prefix entry permits an invocation that starts with it', () => {
  assert.equal(permits('Bash(yarn nx test:*)', 'yarn nx test web-vault'), true);
  assert.equal(
    permits('Bash(git log:*)', 'git log main..HEAD --oneline'),
    true,
  );
});

test('a prefix entry permits the bare command it names', () => {
  // `:*` means "and anything after"; nothing after is still anything after.
  assert.equal(permits('Bash(git worktree:*)', 'git worktree'), true);
});

test('an entry the command diverges from permits nothing', () => {
  assert.equal(permits('Bash(yarn nx test:*)', 'yarn openapi:check'), false);
  assert.equal(
    permits(
      'Bash(corepack yarn review:validate:*)',
      'corepack yarn review:render out.json',
    ),
    false,
  );
});

test('a prefix entry carrying a flag does not match an invocation without it', () => {
  // The failure mode that leaves an entry matching nothing anyone was told to
  // run: `sed -n` grants two tokens, not one, so every other spelling of sed
  // is refused however harmless it looks.
  const sed = 'Bash(sed -n:*)';
  assert.equal(permits(sed, 'sed -n 1,20p file.ts'), true);
  assert.equal(permits(sed, "sed '1,20p' file.ts"), false);
  assert.equal(permits(sed, 'sed -e 1,20p file.ts'), false);
  assert.equal(permits(sed, 'sed file.ts'), false);
});

test('a prefix is tokens, not characters', () => {
  // A string-prefix reading permits `git logs-everything`, which is a
  // different program as far as anyone reading the allowlist is concerned.
  assert.equal(permits('Bash(git log:*)', 'git logs-everything'), false);
  assert.equal(permits('Bash(git log:*)', 'git log'), true);
});

test('an entry without :* is exact, so a longer command is refused', () => {
  const rm = 'Bash(rm -f tmp/code-review/report.json)';
  assert.equal(permits(rm, 'rm -f tmp/code-review/report.json'), true);
  assert.equal(
    permits(rm, 'rm -f tmp/code-review/report.json extra.json'),
    false,
  );
  assert.equal(permits(rm, 'rm -rf tmp/code-review/report.json'), false);
});

test('a `*` inside an exact entry is a glob over one token', () => {
  const rm = 'Bash(rm -f tmp/code-review/*)';
  assert.equal(permits(rm, 'rm -f tmp/code-review/report.json'), true);
  assert.equal(permits(rm, 'rm -f tmp/other/report.json'), false);
});

test('a placeholder token matches, because the document fixed no value', () => {
  assert.equal(permits('Bash(yarn nx test:*)', 'yarn nx test <project>'), true);
  assert.equal(
    permits('Bash(git diff:*)', 'git diff <fixed-point>...HEAD'),
    true,
  );
  // Only where the placeholder sits. A placeholder later in the command
  // cannot rescue a program the entry never named.
  assert.equal(
    permits('Bash(yarn nx test:*)', 'yarn openapi:check <project>'),
    false,
  );
});

test('a non-Bash grant permits no command at all', () => {
  assert.equal(permits('Read', 'yarn nx test web-vault'), false);
  assert.equal(entry('Agent').kind, 'tool');
});

test('the tool list splits on commas outside Bash(...)', () => {
  assert.deepEqual(
    splitToolList('Read,Bash(git log:*),Bash(rm -f tmp/x/*),Agent'),
    ['Read', 'Bash(git log:*)', 'Bash(rm -f tmp/x/*)', 'Agent'],
  );
});

test("the allowlist is read out of the composite action's claude_args", () => {
  const yaml = `        claude_args: >-\n          --model x\n          --max-turns 80\n          --allowedTools "Read,Bash(git log:*)"\n`;
  assert.deepEqual(
    parseAllowedTools(yaml)?.map((e) => e.raw),
    ['Read', 'Bash(git log:*)'],
  );
  assert.equal(parseAllowedTools('no tools here'), null);
});

test('the nearest entry is the one agreeing for longest', () => {
  const entries = [
    'Bash(git log:*)',
    'Bash(corepack yarn nx test:*)',
    'Read',
  ].map(entry);
  const nearest = nearestEntry(
    entries,
    tokenize('corepack yarn openapi:check'),
  );
  assert.equal(nearest?.entry.raw, 'Bash(corepack yarn nx test:*)');
  assert.equal(nearest?.shared, 2);
});

test('a command line yields its program invocation', () => {
  assert.deepEqual(
    commandsFrom('corepack yarn review:validate report.json').map(
      (c) => c.command,
    ),
    ['corepack yarn review:validate report.json'],
  );
});

test('a command substitution inside an assignment is still a command', () => {
  assert.deepEqual(
    commandsFrom('base=$(git merge-base main HEAD)').map((c) => c.command),
    ['git merge-base main HEAD'],
  );
});

test('a bare script name carries both documented spellings', () => {
  const [found] = commandsFrom('openapi:check', new Set(['openapi:check']));
  assert.equal(found.command, 'corepack yarn openapi:check');
  assert.deepEqual(found.alternatives, [
    ['corepack', 'yarn', 'openapi:check'],
    ['yarn', 'openapi:check'],
  ]);
});

test('a word that is not a script is not a command', () => {
  // `namesEverything` and `delete` are answer fields and keywords, and the
  // checklist is full of them. Requiring a colon keeps `test` and `build` out
  // for the same reason.
  assert.deepEqual(
    commandsFrom('namesEverything', new Set(['openapi:check'])),
    [],
  );
  assert.deepEqual(commandsFrom('test', new Set(['test'])), []);
});

test('a shell comment is not a command', () => {
  assert.deepEqual(commandsFrom('# corepack yarn review:render out.json'), []);
});

test('a fenced shell block and an inline span are both instruction sites', () => {
  const md = [
    'Run `yarn nx test <project>` when you need evidence.',
    '',
    '```bash',
    'corepack yarn review:validate report.json',
    '```',
  ].join('\n');
  assert.deepEqual(
    extractInstructions(md, { file: 'doc.md' }).map((s) => [s.line, s.command]),
    [
      [1, 'yarn nx test <project>'],
      [4, 'corepack yarn review:validate report.json'],
    ],
  );
});

test('a fence that is not shell is read the way prose is', () => {
  // The Standards brief's reach-through block is an unlabelled fence the
  // sub-agent reads as instructions, and it hands the reviewer a `git grep`. Skipping
  // the fence whole would hide a block of instructions for being formatted
  // like a quotation; the finding-contract fence beside it carries no spans,
  // so it still yields nothing.
  const md = [
    '```json',
    '{ "executed": ["yarn nx test web-vault"] }',
    '```',
    '',
    '```',
    '3. Prefer executed evidence: `git grep -n "<name>" <head> -- <paths>`.',
    'A finding is not a verdict.',
    '```',
  ].join('\n');
  assert.deepEqual(
    extractInstructions(md, { file: 'doc.md' }).map((s) => [s.line, s.command]),
    [[6, 'git grep -n <name> <head> -- <paths>']],
  );
});

test('a shell utility the allowlist grants is a program the extractor sees', () => {
  // PROGRAMS omitted every utility at first, so an instruction to run `sed`
  // read as prose and was compared against nothing — the gate passing while
  // the reviewer is refused, which is the one outcome it exists to rule out.
  const [found] = commandsFrom("sed '1,20p' libs/x.ts");
  assert.equal(found.command, 'sed 1,20p libs/x.ts');
  assert.equal(
    matchesEntry(entry('Bash(sed -n:*)'), found.alternatives[0]),
    false,
  );
});

test('a bare program word is a name, not an instruction', () => {
  // The skill writes `head` for the head SHA in running prose.
  assert.deepEqual(commandsFrom('head'), []);
  assert.deepEqual(commandsFrom('node'), []);
  assert.equal(commandsFrom('head -20 file.ts').length, 1);
});

test('every program the allowlist grants is one the vocabulary knows', () => {
  const entries = ['Bash(sed -n:*)', 'Bash(git log:*)', 'Read'].map(entry);
  assert.deepEqual(unknownGrantedPrograms(entries, PROGRAMS), []);
  assert.deepEqual(
    unknownGrantedPrograms(['Bash(kubectl get:*)'].map(entry), PROGRAMS),
    ['kubectl'],
  );
});

test('a script shape expands to every script it names', () => {
  const scripts = new Set(['openapi:check', 'nx:tags:check', 'release:cut']);
  const [found] = commandsFrom('*:check', scripts);
  assert.equal(found.shape, true);
  assert.deepEqual(found.names, ['nx:tags:check', 'openapi:check']);
  assert.equal(found.command, 'corepack yarn *:check');
});

test('a shape is refused only when no script it names is permitted', () => {
  const scripts = new Set(['openapi:check', 'nx:tags:check']);
  const [shape] = commandsFrom('*:check', scripts);
  const site = { file: 'skill.md', line: 31, sectionId: null, ...shape };

  const refused = assertToolAllowlist({
    entries: ['Bash(corepack yarn nx test:*)'].map(entry),
    sites: [site],
    exemptions: [],
  });
  assert.equal(refused.findings.length, 1);
  assert.match(formatFinding(refused.findings[0]), /a shape: 2 script\(s\)/);

  const permitted = assertToolAllowlist({
    entries: ['Bash(corepack yarn openapi:check:*)'].map(entry),
    sites: [site],
    exemptions: [],
  });
  assert.deepEqual(permitted.findings, []);
});

test('a written suppression never covers a shape', () => {
  // A suppression names one command somebody decided is not the reviewer's to
  // run; a shape is a class, and no such decision was made about a class.
  const scripts = new Set(['review:render', 'openapi:check']);
  const [shape] = commandsFrom('*:*', scripts);
  const result = assertToolAllowlist({
    entries: [],
    sites: [{ file: 'skill.md', line: 31, sectionId: null, ...shape }],
    exemptions: [
      { command: 'yarn review:render', reason: 'a later job publishes' },
    ],
  });
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.exempted, []);
});

test('a shape naming no script is not a claim about anything', () => {
  assert.deepEqual(commandsFrom('*:check', new Set(['release:cut'])), []);
});

test('a site carries the id of the checklist entry it sits in', () => {
  const md = [
    '## 1. Run the gate that covers this change',
    '',
    '**id** `run-the-gate-that-covers-this-change`',
    '',
    '| `gate` | The checker, e.g. `openapi:check`. |',
    '',
    '---',
    '',
    'Afterwards, `yarn nx lint <project>` belongs to nobody.',
  ].join('\n');
  const sites = extractInstructions(md, {
    file: 'checklist.md',
    scripts: new Set(['openapi:check']),
  });
  assert.deepEqual(
    sites.map((s) => [s.command, s.sectionId]),
    [
      ['corepack yarn openapi:check', 'run-the-gate-that-covers-this-change'],
      ['yarn nx lint <project>', null],
    ],
  );
});

test('an incident paragraph is history, not instruction', () => {
  const md = [
    '**Defect** — a non-zero exit is a finding.',
    '',
    '**Why this exists** — a release moved the version without `openapi:sync`,',
    'so `openapi:check` failed on `main` from that merge onward.',
  ].join('\n');
  assert.deepEqual(
    extractInstructions(md, {
      file: 'checklist.md',
      scripts: new Set(['openapi:sync', 'openapi:check']),
    }),
    [],
  );
});

test('an instructed command no entry permits is a finding', () => {
  const result = assertToolAllowlist({
    entries: ['Bash(yarn nx test:*)'].map(entry),
    sites: [
      {
        file: 'skill.md',
        line: 31,
        sectionId: null,
        command: 'yarn typecheck:check',
        alternatives: [['yarn', 'typecheck:check']],
      },
    ],
    exemptions: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 1);
  assert.match(formatFinding(result.findings[0]), /skill\.md:31/);
  assert.match(formatFinding(result.findings[0]), /then requires `nx`/);
});

test('a site is permitted when any documented spelling is', () => {
  const site = {
    file: 'checklist.md',
    line: 94,
    sectionId: null,
    command: 'corepack yarn openapi:check',
    alternatives: [
      ['corepack', 'yarn', 'openapi:check'],
      ['yarn', 'openapi:check'],
    ],
  };
  const refused = assertToolAllowlist({
    entries: ['Bash(corepack yarn nx test:*)'].map(entry),
    sites: [site],
    exemptions: [],
  });
  assert.equal(refused.findings.length, 1);

  const permitted = assertToolAllowlist({
    entries: ['Bash(yarn openapi:check:*)'].map(entry),
    sites: [site],
    exemptions: [],
  });
  assert.deepEqual(permitted.findings, []);
  assert.equal(permitted.permitted.length, 1);
});

test('a suppression covers a command in either spelling', () => {
  const result = assertToolAllowlist({
    entries: [],
    sites: [
      {
        file: 'skill.md',
        line: 264,
        sectionId: null,
        command: 'corepack yarn review:render out.json',
        alternatives: [tokenize('corepack yarn review:render out.json')],
      },
    ],
    exemptions: [
      { command: 'yarn review:render', reason: 'a later job publishes' },
    ],
  });
  assert.deepEqual(result.findings, []);
  assert.equal(result.exempted.length, 1);
  assert.equal(result.ok, true);
});

test('a suppression that matches nothing is not ok', () => {
  const result = assertToolAllowlist({
    entries: ['Bash(yarn nx test:*)'].map(entry),
    sites: [
      {
        file: 'skill.md',
        line: 30,
        sectionId: null,
        command: 'yarn nx test <project>',
        alternatives: [tokenize('yarn nx test <project>')],
      },
    ],
    exemptions: [{ command: 'yarn review:render', reason: 'stale' }],
  });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(
    result.staleExemptions.map((e) => e.command),
    ['yarn review:render'],
  );
  assert.equal(result.ok, false);
});

test('every suppression carries a written reason', () => {
  for (const exemption of NOT_THE_REVIEWERS_TO_RUN) {
    assert.ok(exemption.command.trim(), 'a suppression must name a command');
    assert.ok(
      exemption.reason.trim().length > 40,
      `\`${exemption.command}\` is suppressed without saying why`,
    );
  }
});

// --- direction 2: an interposed ask/deny rule outranks the grant -------------

const asked = (raw: string) =>
  parseInterposedRules(JSON.stringify({ permissions: { ask: [raw] } }));

test('an ask rule is read as a matchable rule, and PowerShell entries are inert', () => {
  const rules = parseInterposedRules(
    JSON.stringify({
      permissions: {
        deny: ['Bash(rm -rf:*)'],
        ask: [
          'Bash(git worktree remove:*)',
          'PowerShell(git worktree remove:*)',
        ],
      },
    }),
  );
  assert.deepEqual(
    rules.map((rule) => [rule.list, rule.kind]),
    [
      ['deny', 'prefix'],
      ['ask', 'prefix'],
      ['ask', 'tool'],
    ],
    'the list a rule came from must survive parsing — it is what the report names',
  );
  // A PowerShell entry parses, but the reviewer runs bash: it must catch nothing.
  assert.equal(
    matchesEntry(rules[2], tokenize('git worktree remove x')),
    false,
  );
});

test('missing project settings interpose nothing rather than failing', () => {
  assert.deepEqual(parseInterposedRules(JSON.stringify({})), []);
});

test('an instructed command an ask rule catches is a finding even when granted', () => {
  // The defect itself: one grant, one prefix, two subcommands, opposite
  // outcomes. `add` runs; `remove` is refused eleven times.
  const site = (command: string) => ({
    file: '.agents/skills/code-review/SKILL.md',
    line: 37,
    sectionId: null,
    command,
    alternatives: [tokenize(command)],
  });
  const shared = {
    entries: ['Bash(git worktree:*)'].map(entry),
    interposed: asked('Bash(git worktree remove:*)'),
    exemptions: [],
  };

  const added = assertToolAllowlist({
    ...shared,
    sites: [site('git worktree add tmp/code-review/worktree HEAD')],
  });
  assert.equal(added.ok, true);
  assert.deepEqual(added.intercepted, []);

  const removed = assertToolAllowlist({
    ...shared,
    sites: [site('git worktree remove --force tmp/code-review/worktree')],
  });
  assert.equal(
    removed.ok,
    false,
    'a granted command an ask rule catches is still refused',
  );
  assert.deepEqual(
    removed.findings,
    [],
    'it is an interception, not a missing grant',
  );
  assert.equal(removed.intercepted.length, 1);
  assert.equal(removed.intercepted[0].rule?.list, 'ask');

  const report = formatInterception(removed.intercepted[0]);
  assert.match(report, /permissions\.ask/);
  assert.match(report, /\.claude\/settings\.json/);
  assert.match(report, /git worktree remove/);
});

test('the same mechanism on an unrelated command', () => {
  // `node -e` was refused in the same run under `Bash(node:*)`. It is the
  // second instance that makes the cause a mechanism rather than a story about
  // git.
  const result = assertToolAllowlist({
    entries: ['Bash(node:*)'].map(entry),
    interposed: asked('Bash(node -e:*)'),
    exemptions: [],
    sites: [
      {
        file: 'skill.md',
        line: 1,
        sectionId: null,
        command: 'node -e "require(\'fs\')"',
        alternatives: [tokenize('node -e x')],
      },
    ],
  });
  assert.equal(result.intercepted.length, 1);
});

test('a placeholder cannot invent an interception', () => {
  // `node tools/scripts/check-<name>.mjs` is not `node -e` for any value of
  // <name>. Reading an unfixed token as matching anything is the generous
  // reading direction 1 needs and direction 2 must not have: it reported this
  // instruction as refused the first time the two shared a matcher.
  const result = assertToolAllowlist({
    entries: ['Bash(node:*)'].map(entry),
    interposed: asked('Bash(node -e:*)'),
    exemptions: [],
    sites: [
      {
        file: 'docs/review/REVIEW_CHECKLIST.md',
        line: 140,
        sectionId: 'run-the-gate-that-covers-this-change',
        command: 'node tools/scripts/check-<name>.mjs',
        alternatives: [tokenize('node tools/scripts/check-<name>.mjs')],
      },
    ],
  });
  assert.deepEqual(result.intercepted, []);
  assert.equal(result.ok, true);
});

const interceptedBy = (rule: string, command: string) =>
  assertToolAllowlist({
    entries: ['Bash(git:*)', 'Bash(gh:*)'].map(entry),
    interposed: asked(rule),
    exemptions: [],
    sites: [
      {
        file: 'skill.md',
        line: 1,
        sectionId: null,
        command,
        alternatives: [tokenize(command)],
      },
    ],
  }).intercepted.length === 1;

test('a trailing ` *` is the same prefix rule as `:*`', () => {
  // `.claude/settings.json` moved to Claude Code's space form. Read as a
  // literal last token, `Bash(git worktree remove *)` caught only three-word
  // commands, and the gate printed OK over the exact refusal ADR 0099 records.
  assert.equal(entry('Bash(git worktree remove *)').kind, 'prefix');
  assert.equal(
    interceptedBy(
      'Bash(git worktree remove *)',
      'git worktree remove --force tmp/code-review/worktree',
    ),
    true,
  );
  assert.equal(
    interceptedBy('Bash(git worktree remove *)', 'git worktree remove'),
    true,
    'a trailing ` *` also matches the bare command',
  );
});

test('a `*` inside a rule spans tokens, as Claude Code reads it', () => {
  const rule = 'Bash(git push *--force*)';
  assert.equal(entry(rule).kind, 'glob');
  assert.equal(interceptedBy(rule, 'git push origin main --force'), true);
  assert.equal(
    interceptedBy(rule, 'git push --force-with-lease origin feat/x'),
    true,
  );
  assert.equal(interceptedBy(rule, 'git push origin feat/x'), false);
});

test('a placeholder under a glob still cannot invent an interception', () => {
  // The `*` may absorb `<endpoint>`, but only a literal the document wrote
  // can be what the rule catches.
  assert.equal(interceptedBy('Bash(gh api *-X*)', 'gh api <endpoint>'), false);
  assert.equal(
    interceptedBy('Bash(gh api *-X*)', 'gh api <endpoint> -X POST'),
    true,
  );
});

test('an alternative spelling no rule catches is a way through', () => {
  // A script name has two documented spellings. If one is intercepted and the
  // other is granted, the reviewer is not refused, and reporting it would send
  // someone to fix a command that works.
  const result = assertToolAllowlist({
    entries: ['Bash(yarn openapi:check)'].map(entry),
    interposed: asked('Bash(corepack:*)'),
    exemptions: [],
    sites: [
      {
        file: 'skill.md',
        line: 9,
        sectionId: null,
        command: 'corepack yarn openapi:check',
        alternatives: [
          tokenize('corepack yarn openapi:check'),
          tokenize('yarn openapi:check'),
        ],
      },
    ],
  });
  assert.deepEqual(result.intercepted, []);
  assert.equal(result.ok, true);
});

test('a suppressed command is not reported as intercepted', () => {
  // The skill names `git worktree remove` for the human who cleans up. The
  // reviewer is told not to run it, so an ask rule catching it is the design.
  const result = assertToolAllowlist({
    entries: ['Bash(git worktree:*)'].map(entry),
    interposed: asked('Bash(git worktree remove:*)'),
    exemptions: [
      { command: 'git worktree remove', reason: 'the human cleans up' },
    ],
    sites: [
      {
        file: 'skill.md',
        line: 37,
        sectionId: null,
        command: 'git worktree remove --force tmp/code-review/worktree',
        alternatives: [
          tokenize('git worktree remove --force tmp/code-review/worktree'),
        ],
      },
    ],
  });
  assert.deepEqual(result.intercepted, []);
  assert.equal(result.ok, true);
});

// --- direction 3: a grant a project rule retracts, instructed or not ---------

const retractionsBetween = (
  grants: string[],
  askRules: string[],
  exemptions: GrantRetractionExemption[] = [],
) =>
  assertGrantRetractions({
    entries: grants.map(entry),
    interposed: parseInterposedRules(
      JSON.stringify({ permissions: { ask: askRules } }),
    ),
    exemptions,
  });

test('a grant an ask rule repeats is wholly retracted', () => {
  // `Bash(find:*)` in both files: the grant permits nothing the rule does not
  // take back. Direction 2 cannot see it, because no document instructs `find`.
  const result = retractionsBetween(['Bash(find:*)'], ['Bash(find:*)']);
  assert.equal(result.ok, false);
  assert.equal(result.retractions.length, 1);
  assert.equal(result.retractions[0].extent, 'wholly');
  const report = formatRetraction(result.retractions[0]);
  assert.match(report, /wholly/);
  assert.match(report, /Bash\(find:\*\)/);
  assert.match(report, /permissions\.ask/);
  assert.match(report, /\.claude\/settings\.json/);
});

test('a grant an ask rule narrows is partly retracted', () => {
  // The damaging case. `Bash(node:*)` still looks granted, and `node -e` is
  // the form taken out from under it. Both narrowings are reported.
  const result = retractionsBetween(
    ['Bash(node:*)'],
    ['Bash(node -e:*)', 'Bash(node --eval:*)'],
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.retractions.map((retraction) => retraction.extent),
    ['partly', 'partly'],
  );
  assert.deepEqual(
    result.retractions.map((retraction) => retraction.rule.raw),
    ['Bash(node -e:*)', 'Bash(node --eval:*)'],
  );
});

test('a broader ask rule retracts a narrower grant wholly', () => {
  const result = retractionsBetween(['Bash(node -e:*)'], ['Bash(node:*)']);
  assert.equal(result.retractions[0].extent, 'wholly');
});

test('git merge-base is not retracted by a git merge rule', () => {
  // Token-wise, `merge-base` is not `merge`. A character prefix would flag
  // this pair, and the grant is a real one.
  const result = retractionsBetween(
    ['Bash(git merge-base:*)'],
    ['Bash(git merge *)'],
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.retractions, []);
});

test('the scratch rm grant is not retracted by the rm -rf deny rule', () => {
  const result = assertGrantRetractions({
    entries: ['Bash(rm -f tmp/code-review/*)'].map(entry),
    interposed: parseInterposedRules(
      JSON.stringify({ permissions: { deny: ['Bash(rm -rf *)'] } }),
    ),
    exemptions: [],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.retractions, []);
});

test('a glob rule retracts only the part of a prefix grant it matches', () => {
  const result = assertGrantRetractions({
    entries: ['Bash(git push:*)'].map(entry),
    interposed: parseInterposedRules(
      JSON.stringify({
        permissions: { deny: ['Bash(git push *--force*)'] },
      }),
    ),
    exemptions: [],
  });
  assert.equal(result.retractions.length, 1);
  assert.equal(result.retractions[0].extent, 'partly');
  assert.equal(result.retractions[0].rule.list, 'deny');
  assert.match(formatRetraction(result.retractions[0]), /permissions\.deny/);
});

test('a rule whose first token is a glob still retracts a prefix grant it can match', () => {
  const result = retractionsBetween(['Bash(git push:*)'], ['Bash(*--force*)']);
  assert.equal(result.ok, false);
  assert.equal(result.retractions[0].extent, 'partly');
});

test('a worktree grant is partly retracted by the remove rule, and add and list are not', () => {
  const whole = retractionsBetween(
    ['Bash(git worktree:*)'],
    ['Bash(git worktree remove *)'],
  );
  assert.equal(whole.retractions[0].extent, 'partly');

  const narrowed = retractionsBetween(
    ['Bash(git worktree add:*)', 'Bash(git worktree list:*)'],
    ['Bash(git worktree remove *)'],
  );
  assert.equal(narrowed.ok, true);
  assert.deepEqual(narrowed.retractions, []);
});

test('an exempted pair is kept, and an exemption that names nothing is stale', () => {
  const exemptions = [
    {
      grant: 'Bash(node:*)',
      rule: 'Bash(node -e:*)',
      reason:
        'The ask stays for a developer at a keyboard. The reviewer is told to run a file under tmp/code-review instead of node -e.',
    },
  ];
  const kept = retractionsBetween(
    ['Bash(node:*)'],
    ['Bash(node -e:*)'],
    exemptions,
  );
  assert.equal(kept.ok, true);
  assert.deepEqual(kept.retractions, []);
  assert.equal(kept.exempted.length, 1);
  assert.equal(kept.staleExemptions.length, 0);

  const stale = retractionsBetween(['Bash(node:*)'], [], exemptions);
  assert.equal(stale.ok, false);
  assert.equal(stale.staleExemptions.length, 1);
  assert.deepEqual(stale.retractions, []);
});

test('a PowerShell ask rule retracts no Bash grant', () => {
  const result = assertGrantRetractions({
    entries: ['Bash(find:*)'].map(entry),
    interposed: parseInterposedRules(
      JSON.stringify({ permissions: { ask: ['PowerShell(find *)'] } }),
    ),
    exemptions: [],
  });
  assert.equal(result.ok, true);
});

test('a non-Bash grant cannot be retracted', () => {
  const result = retractionsBetween(['Read', 'Glob'], ['Bash(find:*)']);
  assert.equal(result.ok, true);
});

// ─── Direction 4: file grants are anchored and consulted ───────────────────

const fileGrants = (list: string) =>
  assertFileGrants(splitToolList(list).map(entry));

test('a file grant anchored at the working directory holds', () => {
  const result = fileGrants(
    'Read,Glob,Edit(/tmp/code-review/**),Read(~/notes/**),Edit(//var/x/**),Agent,Bash(rm -f tmp/code-review/*)',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

test('a cwd-relative Edit grant fails: a `cd` moves what it covers (issue #880)', () => {
  const result = fileGrants('Read,Edit(tmp/code-review/**),Bash(git log:*)');
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.findings.map((f) => [f.grant.raw, f.problem]),
    [['Edit(tmp/code-review/**)', 'cwd-relative']],
  );
  assert.match(formatFileGrant(result.findings[0]), /current directory/);
  assert.equal(fileGrants('Edit(./tmp/code-review/**)').ok, false);
  assert.equal(fileGrants('Read(src/**)').ok, false);
});

test('a Write path rule fails however it is anchored: Claude Code never consults it', () => {
  for (const list of [
    'Write(tmp/code-review/**)',
    'Write(/tmp/code-review/**)',
    'NotebookEdit(/docs/**)',
  ]) {
    const result = fileGrants(list);
    assert.equal(result.ok, false, list);
    assert.equal(result.findings[0].problem, 'unconsulted');
    assert.match(formatFileGrant(result.findings[0]), /never consulted/);
  }
});

test('the grant main shipped before issue #880 fails on both counts', () => {
  const result = fileGrants(
    'Read,Glob,Grep,Write(tmp/code-review/**),Edit(tmp/code-review/**),Agent',
  );
  assert.deepEqual(
    result.findings.map((f) => f.problem),
    ['unconsulted', 'cwd-relative'],
  );
});

test('a tool granted with no path, and a Bash grant, are not file grants', () => {
  assert.equal(fileGrants('Read,Edit,Write,Agent,Bash(cat:*)').ok, true);
});
