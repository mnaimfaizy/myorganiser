// Asserts that every CI validation of the reviewer's report is handed the
// run facts file and the obligation worklist (issue #1031, ADR 0123).
//
// The validator overwrites the report's own claims about its run only when it
// is given `--facts`. A validation without it writes a normalized report
// marked self-reported, carrying whatever the reviewer wrote. The first
// version of this change added `--facts` to the action's validation and
// missed the workflow step that validates the report a second time to carry
// finding ids forward, which then moved its output over the first: every
// review after the first on a branch would have published the reviewer's
// claims. Nothing failed, because each validation is correct on its own.
//
// `--worklist` rides with it since the facts are enforced: the validator
// fails a reported finding no sub-agent returned, and the worklist is how it
// knows an obligation finding is the main agent's to write. A validation
// without it would fail every such finding as authored.
//
// Direction: workflows → `--facts` and `--worklist`, one way. A validation the reviewer runs
// inside its own session is not matched: it has no transcript to read yet,
// and the action validates again after it exits.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const WORKFLOW_FILES = [
  '.github/actions/code-reviewer/action.yml',
  ...readdirSync('.github/workflows')
    .filter((name) => name.endsWith('.yml'))
    .map((name) => join('.github/workflows', name)),
];

/** A shell step invoking the validator on the report the reviewer wrote. */
const VALIDATION =
  /(?:node "\$VALIDATOR"|corepack yarn review:validate) tmp\/code-review\/report\.json/;

/** Each validation as one command: its line and every continuation of it. */
export const validationsIn = (text) => {
  const lines = text.split('\n');
  const commands = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!VALIDATION.test(lines[i])) continue;
    let command = lines[i];
    let end = i;
    while (lines[end].trimEnd().endsWith('\\') && end + 1 < lines.length) {
      end += 1;
      command += `\n${lines[end]}`;
    }
    commands.push({ line: i + 1, command });
  }
  return commands;
};

test('the scan finds a validation and reads its continuation lines', () => {
  const found = validationsIn(
    [
      'run: |',
      '  if corepack yarn review:validate tmp/code-review/report.json \\',
      "    --tier 'review:human' \\",
      '    --out x.json; then',
      '  fi',
    ].join('\n'),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
  assert.match(found[0].command, /--out x\.json/);
  // A sentence that mentions the validator is not an invocation of it.
  assert.deepEqual(validationsIn('# run review:validate on the report'), []);
});

test('every CI validation of the report passes --facts and --worklist', () => {
  const all = WORKFLOW_FILES.flatMap((file) =>
    validationsIn(readFileSync(file, 'utf8')).map((v) => ({ file, ...v })),
  );
  // The action validates twice (with and without a tier) and the workflow
  // once more to carry ids. Fewer means the scan stopped matching, and a
  // scan that matches nothing passes everything.
  assert.ok(
    all.length >= 3,
    `expected at least 3 validations of the report across the workflows, found ${all.length}`,
  );
  for (const { file, line, command } of all) {
    assert.match(
      command,
      /--facts /,
      `${file}:${line} validates the report without --facts, so its output carries the reviewer's own claims about its run`,
    );
    assert.match(
      command,
      /--worklist tmp\/code-review\/obligations\.json\b/,
      `${file}:${line} validates the report without --worklist, so an obligation finding fails as one the main agent authored`,
    );
  }
});

// The validator records a run failure and exits 0, so the report is still
// published. Something has to read the record and fail the check, and in
// production that is one branch of one step. The golden replay's copy of the
// read is asserted by `replayRunFactsFindings`; without this, deleting the
// production branch would leave every suite green while the validator went
// on recording failures nobody acts on.
const stepNamed = (text, name) => {
  const lines = text.split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^\\s*- name: ${name}\\s*$`).test(line),
  );
  if (start === -1) return null;
  const indent = lines[start].search(/\S/);
  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end].trim() === '' || lines[end].search(/\S/) > indent)
  )
    end += 1;
  return lines.slice(start, end).join('\n');
};

export const runFailureBranchFindings = (workflowText) => {
  const step = stepNamed(workflowText, 'Agent review ran');
  if (!step) return ['no "Agent review ran" step'];
  // The validated branch: from its test to the `fi` at the same indent.
  const validated =
    /^( *)if \[ '\$\{\{ steps\.reviewer\.outputs\.validated \}\}' = 'true' \]; then\n([\s\S]*?)\n\1fi$/m.exec(
      step,
    );
  if (!validated) return ['the step has no validated branch'];
  const branch = validated[2];
  const read = branch.indexOf('.runFacts.failures');
  if (read === -1)
    return [
      'the validated branch does not read .runFacts.failures, so a review that did not run as built passes the check',
    ];
  if (!/\bexit 1\b/.test(branch.slice(read)))
    return [
      'the validated branch reads the run failures and never exits non-zero on them',
    ];
  return [];
};

const CODE_REVIEW = '.github/workflows/code-review.yml';

test('Agent Review Ran fails on a run failure the validator recorded', () => {
  assert.deepEqual(
    runFailureBranchFindings(readFileSync(CODE_REVIEW, 'utf8')),
    [],
  );
});

test('the assertion fails when the branch, the read, or the exit is gone', () => {
  const workflow = readFileSync(CODE_REVIEW, 'utf8');
  assert.match(
    runFailureBranchFindings(
      workflow.replaceAll('.runFacts.failures', '.runFacts.nothing'),
    )[0],
    /does not read \.runFacts\.failures/,
  );
  const step = stepNamed(workflow, 'Agent review ran');
  const read = step.indexOf('.runFacts.failures');
  const exit = step.indexOf('exit 1', read);
  assert.match(
    runFailureBranchFindings(
      workflow.replace(
        step,
        `${step.slice(0, exit)}exit 0${step.slice(exit + 'exit 1'.length)}`,
      ),
    )[0],
    /never exits non-zero/,
  );
  assert.match(
    runFailureBranchFindings(
      workflow.replace('- name: Agent review ran', '- name: Something else'),
    )[0],
    /no "Agent review ran" step/,
  );
});
