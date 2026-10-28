// Covers the comparison the rule-catalogue gate performs.
//
// The comparison carries the risk. It decides whether the bounded vocabulary
// the validator enforces is the same vocabulary the reviewer is offered, and
// every way it can be wrong is a way this gate passes while a real report is
// rejected whole: a scan that matches nothing reports OK for an empty prompt,
// and a one-directional obligation check leaves an id in the catalogue that no
// obligation backs.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OBLIGATION_RULE_PREFIX,
  SHARED_BLOCK_END,
  SHARED_BLOCK_START,
  compareRuleCatalogue,
  idsOfferedBy,
  type CatalogueRule,
} from './check-review-rules.ts';
import { DISPATCH_TEMPLATES, RETRY_LINE } from './review/briefs.ts';
import { RULE_CATALOGUE_SCHEMA_VERSION } from './review/rules.ts';

const rule = (over: Partial<CatalogueRule> = {}): CatalogueRule => ({
  id: 'standard-example',
  family: 'standard',
  title: 'An example rule',
  axes: ['standards'],
  cites: 'AGENTS.md',
  ...over,
});

const SHARED = `${SHARED_BLOCK_START}\nthe contract\n${SHARED_BLOCK_END}`;

/** Every rule id offered, so a case only has to state what it leaves out. */
const idsListed = (ids: string[]) =>
  `prose about \`ruleId\`\n${ids.map((id) => `- \`${id}\` — a rule`).join('\n')}\n`;

/**
 * A brief: the ids it lists, then the shared block. Pass `shared: ''` for a
 * brief that lost its block.
 */
const briefListing = (ids: string[], shared = SHARED) =>
  `${idsListed(ids)}\n${shared}\n`;

/** The skill is the main agent's process; by default it names no rule id. */
const TEMPLATE = [...Object.values(DISPATCH_TEMPLATES).flat(), RETRY_LINE].join(
  '\n',
);
const SKILL_NAMING_NO_IDS = `the process, naming no ids\n${TEMPLATE}\n`;

/**
 * Runs the comparison. Every rule goes to the Standards brief unless a case
 * says otherwise, so a case states only what it changes: `standards` and
 * `spec` are the two briefs' text, `skill` is SKILL.md's.
 */
const compare = ({
  rules = [rule()],
  obligations = [],
  standards,
  spec = briefListing([]),
  skill = SKILL_NAMING_NO_IDS,
  exists = () => true,
}: {
  rules?: CatalogueRule[];
  obligations?: { id: string }[];
  standards?: string;
  spec?: string;
  skill?: string;
  exists?: (path: string) => boolean;
} = {}) =>
  compareRuleCatalogue({
    catalogue: { schemaVersion: RULE_CATALOGUE_SCHEMA_VERSION, rules },
    obligations,
    skill,
    briefs: {
      standards:
        standards ??
        briefListing(
          rules.filter((r) => r.axes.includes('standards')).map((r) => r.id),
        ),
      spec,
    },
    exists,
  });

test('a catalogue in step with all three sources reports nothing', () => {
  assert.deepEqual(compare(), []);
});

test('an axis or a severity cap the finding contract does not know is named', () => {
  assert.match(
    compare({ rules: [rule({ axes: ['vibes'] })] })[0],
    /axis "vibes" is not a finding axis/,
  );
  // The silent no-op: a cap nothing can compare against passes every severity.
  assert.match(
    compare({ rules: [rule({ maxSeverity: 'smallish' })] })[0],
    /maxSeverity "smallish" is not a severity, so the cap can never fire/,
  );
});

test('a severity floor the finding contract does not know, or one above its cap, is named', () => {
  // ADR 0131 item 2: the floor mirrors the cap, and fails silent the same way.
  assert.match(
    compare({ rules: [rule({ minSeverity: 'serious' })] })[0],
    /minSeverity "serious" is not a severity, so the floor can never fire/,
  );
  // A floor more severe than the cap leaves no severity a finding can carry.
  assert.match(
    compare({
      rules: [rule({ minSeverity: 'blocking', maxSeverity: 'should-fix' })],
    })[0],
    /minSeverity "blocking" is above maxSeverity "should-fix", so no finding can satisfy both/,
  );
  assert.deepEqual(
    compare({
      rules: [rule({ minSeverity: 'should-fix', maxSeverity: 'should-fix' })],
    }),
    [],
  );
});

test('a cited document that is gone is a finding, not a shrug', () => {
  assert.match(
    compare({ exists: () => false })[0],
    /cites AGENTS\.md, which does not exist/,
  );
});

test('the obligation family is compared in both directions', () => {
  const mirrored = rule({
    id: `${OBLIGATION_RULE_PREFIX}check-the-thing`,
    family: 'obligation',
    cites: 'docs/review/REVIEW_CHECKLIST.md',
  });
  assert.deepEqual(
    compare({ rules: [mirrored], obligations: [{ id: 'check-the-thing' }] }),
    [],
  );
  // An obligation with no rule: its answer exposes a defect the reviewer then
  // has no id to file under.
  assert.match(
    compare({ rules: [rule()], obligations: [{ id: 'check-the-thing' }] })[0],
    /has obligation "check-the-thing" with no "obligation-check-the-thing" rule/,
  );
  // A rule with no obligation: the reviewer is offered an id for a question
  // nobody is asked any more.
  assert.match(
    compare({ rules: [mirrored], obligations: [] })[0],
    /has "obligation-check-the-thing", which is no longer an obligation/,
  );
});

test('the Standards brief is compared in both directions', () => {
  // In the catalogue, never offered: unreachable, because the sub-agent sees
  // only what the prompt carries.
  assert.match(
    compare({ standards: briefListing([]) })[0],
    /in tools\/config\/review-rules\.json but not offered by .*STANDARDS_BRIEF\.md/,
  );
  // Offered, not in the catalogue: a report naming it is rejected whole.
  assert.match(
    compare({
      standards: briefListing(['standard-example', 'smell-invented']),
    })[0],
    /offers "smell-invented", which is not in tools\/config\/review-rules\.json/,
  );
});

test('the id scan reads backticked ids and leaves ordinary prose alone', () => {
  const offered = idsOfferedBy(
    'pick `standard-other`, write `source`, run `yarn review:test`, and note ' +
      'that standard-other unquoted is prose. The `smell-baseline` source is ' +
      'not a rule id.',
  );
  assert.ok(offered.has('standard-other'));
  assert.ok(offered.has('source'));
  // `smell-baseline` is shaped like an id and is a source string, so scanning
  // it would report a catalogue entry that must never exist.
  assert.ok(!offered.has('smell-baseline'));
  assert.ok(!offered.has('yarn review:test'));
});

test('a word shaped like a rule id is judged; anything else is not', () => {
  // `source` is offered prose, not a rule id, so it is not reported missing
  // from the catalogue — that is what keeps this scan usable on a real skill.
  const findings = compare({
    standards: `also \`source\` and \`rule\`.\n${briefListing(['standard-example'])}`,
  });
  assert.deepEqual(findings, []);
});

// --- The briefs (issue #1031, ADR 0123) ------------------------------------
//
// The catalogue reaches a sub-agent through its axis's brief file, which the
// sub-agent reads itself. A main agent that pasted the catalogue dispatched 22
// of 37 ids (CI run 37576528356), so the briefs are now what the gate reads.

const standardsRule = rule();
const specRule = rule({
  id: 'spec-example',
  family: 'spec',
  axes: ['spec'],
  cites: undefined,
});

const compareBriefs = (over = {}) =>
  compare({
    rules: [standardsRule, specRule],
    spec: briefListing(['spec-example']),
    ...over,
  });

test('briefs that each offer their own axis and share one block report nothing', () => {
  assert.deepEqual(compareBriefs(), []);
});

test('an id missing from its axis brief is unreachable, whatever the skill says', () => {
  const findings = compareBriefs({
    standards: briefListing([]),
    skill: `${SKILL_NAMING_NO_IDS}${idsListed(['standard-example'])}`,
  });
  assert.equal(findings.length, 1);
  assert.match(
    findings[0],
    /standard-example: in tools\/config\/review-rules\.json but not offered by .*STANDARDS_BRIEF\.md/,
  );
});

test('a brief offering an id of the other axis is named', () => {
  assert.match(
    compareBriefs({
      spec: briefListing(['spec-example', 'standard-example']),
    })[0],
    /SPEC_BRIEF\.md offers "standard-example", which the catalogue does not allow on the spec axis/,
  );
});

test('a brief offering an id the catalogue does not carry is named', () => {
  assert.match(
    compareBriefs({
      standards: briefListing(['standard-example', 'smell-invented']),
    })[0],
    /STANDARDS_BRIEF\.md offers "smell-invented", which is not in tools\/config\/review-rules\.json/,
  );
});

test('the shared block must be identical in both briefs', () => {
  const drifted = `${SHARED_BLOCK_START}\nthe contract, reworded\n${SHARED_BLOCK_END}`;
  assert.match(
    compareBriefs({ spec: briefListing(['spec-example'], drifted) })[0],
    /the shared block differs between .*STANDARDS_BRIEF\.md and .*SPEC_BRIEF\.md/,
  );
});

test('a brief with no shared block is a finding, not an empty match', () => {
  // Two briefs that both lost their markers would otherwise compare equal.
  const findings = compareBriefs({
    standards: briefListing(['standard-example'], ''),
    spec: briefListing(['spec-example'], ''),
  });
  assert.equal(findings.length, 2);
  assert.match(findings[0], /STANDARDS_BRIEF\.md has no shared block/);
  assert.match(findings[1], /SPEC_BRIEF\.md has no shared block/);
});

test('the shared block may offer no rule id, because both axes read it', () => {
  const leaking = `${SHARED_BLOCK_START}\nuse \`spec-example\`\n${SHARED_BLOCK_END}`;
  const findings = compareBriefs({
    standards: briefListing(['standard-example'], leaking),
    spec: briefListing(['spec-example'], leaking),
  });
  assert.ok(
    findings.some((f) =>
      /the shared block offers "spec-example"; a rule id belongs in one axis's catalogue/.test(
        f,
      ),
    ),
  );
});

test('with briefs, the skill is no longer where an id has to be offered', () => {
  // The skill may still mention an id in prose, and an invented one is still
  // a finding: a main agent reading it could write it into a report.
  assert.match(
    compareBriefs({
      skill: `${SKILL_NAMING_NO_IDS}${idsListed(['standard-invented'])}`,
    })[0],
    /SKILL\.md offers "standard-invented", which is not in tools\/config\/review-rules\.json/,
  );
});

test('the skill must print every line of the dispatch template', () => {
  // The transcript reader compares a dispatch to these lines. A skill that
  // rewords one sends dispatches the reader then reports as steered.
  const reworded = SKILL_NAMING_NO_IDS.replaceAll(
    '- head: <head>',
    '- head sha: <head>',
  );
  const findings = compareBriefs({ skill: reworded });
  assert.equal(findings.length, 1);
  assert.match(
    findings[0],
    /does not print the dispatch template line "- head: <head>"/,
  );
  // The retry line is part of the template too.
  assert.match(
    compareBriefs({ skill: SKILL_NAMING_NO_IDS.replace(RETRY_LINE, '') })[0],
    /does not print the dispatch template line "- retry:/,
  );
});
