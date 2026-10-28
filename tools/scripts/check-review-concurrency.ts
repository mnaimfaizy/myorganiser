#!/usr/bin/env node
// Asserts that the code review workflow's concurrency group and its `context`
// job's `if:` agree about which triggers are inert.
//
//   node tools/scripts/check-review-concurrency.ts [--print]
//
// The two are written in the same language about the same event payload, and
// they cannot be shared: `concurrency` is evaluated when the run is created,
// before any job `if:` is read. That gap is the whole reason this check
// exists. A run whose jobs all skip is not a harmless run — it still joins the
// concurrency group, and with `cancel-in-progress` it takes the in-flight
// review with it.
//
// It happened three times in one morning. `ai:create-pr` adds labels a second
// after opening a pull request, and those `labeled` runs cancelled the review
// on #687 and #690. The fix sent them to a group of their own, and a
// GitGuardian comment on #693 did the same thing an hour later through the
// `issue_comment` trigger, which had been left in the shared group — invisible
// where anyone would look, because `issue_comment` runs are attributed to the
// default branch and never appear when listing runs for the pull request's
// branch. Then the shared inert group cancelled itself on #694.
//
// So the invariant is: every trigger the `context` job refuses must also be
// steered out of the review's concurrency group. This cannot be checked by
// evaluating the expressions — that would mean implementing GitHub's
// expression language — so it is checked structurally, on the literals that
// decide it: the trigger label, the command, and the commenter associations
// allowed to use it. Rename or widen any of them in one place and this fails
// until the other follows.
//
// Exit 0 = the two agree. Exit 1 = they have drifted. Exit 2 = could not run.
import { readFileSync } from 'node:fs';

import { errorMessage } from './lib/error-message.ts';

const WORKFLOW = '.github/workflows/code-review.yml';
const printOnly = process.argv.includes('--print');

const fail: (msg: string) => never = (msg) => {
  console.error(`review-concurrency: ${msg}`);
  process.exit(2);
};

let source: string;
try {
  source = readFileSync(WORKFLOW, 'utf8');
} catch (err) {
  fail(`cannot read ${WORKFLOW}: ${errorMessage(err)}`);
}

/**
 * Both extractions are bounded, and both must be unique. An unbounded search
 * walks past an empty `concurrency:` block and reads a `group:` belonging to a
 * job, then asserts against the wrong string and passes — this check's own
 * version of the failure it exists to prevent.
 */
const exactlyOne = (matches: string[], what: string): string => {
  if (matches.length === 0) fail(`no ${what} found in ${WORKFLOW}`);
  if (matches.length > 1)
    fail(
      `${matches.length} ${what}s found in ${WORKFLOW}; this check assumes exactly one`,
    );
  return matches[0];
};

/** The top-level `concurrency:` block: its own line and the indented lines under it. */
const concurrencyBlock = exactlyOne(
  [...source.matchAll(/^concurrency:\n((?:[ \t]+.*\n|\n)*)/gm)].map(
    (m) => m[1],
  ),
  'top-level `concurrency:` block',
);
const group = exactlyOne(
  [...concurrencyBlock.matchAll(/^\s+group:\s*(.+)$/gm)].map((m) =>
    m[1].trim(),
  ),
  '`group:` line inside the concurrency block',
);

/** The `context` job's `if:`, a `>-` block of lines indented six spaces. */
const contextIf = exactlyOne(
  [
    ...source.matchAll(
      /^ {2}context:\n(?:(?! {2}\S).*\n)*?^ {4}if: >-\n((?:^ {6}.*\n)+)/gm,
    ),
  ].map((m) => m[1].replace(/\s+/g, ' ').trim()),
  '`context` job `if:` block',
);

// Each gate is one trigger the context job refuses. `admits` is what the `if:`
// must say to let the deliberate case through; `steers` is what the group must
// say to keep the refused case out of the review's group.
const GATES: {
  what: string;
  admits: RegExp;
  steers: (value: string) => string;
}[] = [
  {
    what: 'the re-review label',
    admits: /github\.event\.label\.name == '([^']+)'/,
    steers: (name) => `github.event.label.name != '${name}'`,
  },
  {
    what: 'the re-review command',
    admits: /startsWith\(github\.event\.comment\.body, '([^']+)'\)/,
    // The group negates the whole admitting clause rather than each half, so
    // require the clause itself to be present and check the negation once
    // below.
    steers: (cmd) => `startsWith(github.event.comment.body, '${cmd}')`,
  },
  // Authorization belongs to the routing decision, not to a step inside the
  // run. Refusing an unauthorized `/code-review` in the `Decide` step happens
  // after the run has joined the group and cancelled the review, so on a public
  // repository any commenter could stop a review by typing the command.
  {
    what: 'the commenter associations allowed to request a review',
    admits:
      /contains\(fromJSON\('(\[[^']+\])'\), github\.event\.comment\.author_association\)/,
    steers: (list) =>
      `contains(fromJSON('${list}'), github.event.comment.author_association)`,
  },
];

const findings: string[] = [];
const resolved: { what: string; literal: string; needle: string }[] = [];
for (const gate of GATES) {
  const literal = contextIf.match(gate.admits)?.[1];
  if (!literal) {
    findings.push(
      `the context job's \`if:\` no longer names ${gate.what}; this check cannot tell what the group should steer`,
    );
    continue;
  }
  const needle = gate.steers(literal);
  resolved.push({ what: gate.what, literal, needle });
  if (!group.includes(needle))
    findings.push(
      `${gate.what} is '${literal}' in the context job's \`if:\`, but the concurrency group does not contain \`${needle}\` — a run that skips would still cancel the review`,
    );
}

// Naming the comment clause is not enough: the group must *negate* it, or the
// group would steer the deliberate `/code-review` away instead of the drive-by
// one — the invariant inverted.
if (!/!\(\s*startsWith\(github\.event\.comment\.body/.test(group))
  findings.push(
    'the concurrency group names the comment trigger but does not negate it, so it would steer the deliberate `/code-review` out of the review group rather than the runs that skip',
  );

// The group must actually route somewhere else, not merely mention the guards,
// and the elsewhere must be one group per run. A shared inert group is not
// harmless: `ai:create-pr` adds two labels, the second run cancels the first,
// and the cancelled run's check runs overwrite the passing review's in the
// pull request's rollup — a green review reported as cancelled.
if (!/-inert/.test(group))
  findings.push(
    'the concurrency group has no distinct suffix for inert runs, so every trigger shares one group',
  );
else if (!/github\.run_id/.test(group))
  findings.push(
    'the inert suffix is not unique per run, so two inert runs cancel each other and the cancelled one overwrites the review in the checks rollup',
  );

if (printOnly) {
  console.log(`group:  ${group}`);
  console.log(`if:     ${contextIf}`);
  for (const r of resolved)
    console.log(`gate:   ${r.what} = '${r.literal}' -> requires ${r.needle}`);
}

if (findings.length) {
  console.error(
    `review-concurrency: ${findings.length} finding(s) — ${WORKFLOW} can cancel its own review`,
  );
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `review-concurrency: OK — ${resolved.length} trigger(s) the context job refuses are steered out of the review's concurrency group`,
);
