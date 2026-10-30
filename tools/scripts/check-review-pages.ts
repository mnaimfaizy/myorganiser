#!/usr/bin/env node
// Asserts that docs/review/finding-lifecycle.html still describes the review
// pipeline the code implements (ADR 0070, ADR 0071).
//
//   node tools/scripts/check-review-pages.ts
//
// The page embeds a manifest of the vocabularies it asserts. This diffs each
// entry against its source: the finding contract's exported constants and its
// report schema version, the CI job names the main-branch ruleset requires,
// the Agent Verdict job name in the code-review workflow, and the gate tier
// labels in the label catalog. A rename in any of those fails here instead of
// leaving a confidently wrong explainer in docs/.
//
// Exit 0 = in sync. Exit 1 = drift (fix the page or the source). Exit 2 = the
// check could not run.
import { existsSync, readFileSync } from 'node:fs';

import { errorMessage } from './lib/error-message.ts';
import { RULE_FAMILIES } from './review/rules.ts';
import {
  FINDING_AXES,
  FINDING_EVIDENCE_KINDS,
  FINDING_IDENTITY_FIELDS,
  FINDING_SEVERITIES,
  GATE_TIER_LABELS,
  REPORT_SCHEMA_VERSION,
  REVIEW_TIER_LABELS,
  VERDICT_VALUES,
} from './review/schema.ts';

const PAGE = 'docs/review/finding-lifecycle.html';
const MANIFEST_ID = 'review-lifecycle-manifest';
const CI_WORKFLOW = '.github/workflows/ci.yml';
const REVIEW_WORKFLOW = '.github/workflows/code-review.yml';
const LABELS = 'tools/config/github-labels.json';

/**
 * The reviewer's judgment. Advisory, and staying that way: ADR 0073 rejects
 * requiring it on principle rather than on a recall threshold, so this is not
 * a context waiting for a number to improve. The page describes it, so the
 * page must name the job that actually exists.
 */
export const AGENT_VERDICT_CHECK = 'Agent Verdict';

/**
 * The other half of the same split (ADR 0073 item 1): whether the reviewer ran
 * at all, as opposed to what it concluded. This one is *eligible* to be
 * required and is not required today — adding it means editing the ruleset,
 * REQUIRED_CHECK_CONTEXTS below, and the job-name lookup that resolves those
 * contexts from ci.yml only. Tracked here so a rename is caught before it
 * silently removes the check a ruleset may come to depend on.
 */
export const AGENT_REVIEW_RAN_CHECK = 'Agent Review Ran';

/**
 * The status-check contexts the `*main*` ruleset requires. The ruleset lives
 * in GitHub, not in a file, so this list is the repo-side statement of it; the
 * page asserts the same set, and each must still be a job name in ci.yml.
 *
 * `Prepare Dependency Cache` dropped out when issue #1396 merged it into
 * `Setup Affected Context`: that job no longer exists, so a context named
 * for it can never report and would wedge every pull request. The live
 * ruleset still has to be edited to match — that is issue #1397, blocked on
 * this list changing first (ADR 0073 item 4: the ruleset and this statement
 * of it change together, and this file's own sanity check is what forces
 * this list to move first).
 */
export const REQUIRED_CHECK_CONTEXTS = [
  'Authoritative Lockfile Policy',
  'Secure Install Review',
  'Setup Affected Context',
  'Lint',
  'Test',
];

const fail: (msg: string) => never = (msg) => {
  console.error(`review-pages: ${msg}`);
  process.exit(2);
};

if (!existsSync(PAGE)) fail(`${PAGE} not found`);
if (!existsSync(CI_WORKFLOW)) fail(`${CI_WORKFLOW} not found`);
if (!existsSync(REVIEW_WORKFLOW)) fail(`${REVIEW_WORKFLOW} not found`);
if (!existsSync(LABELS)) fail(`${LABELS} not found`);

const page = readFileSync(PAGE, 'utf8');
const raw = page.match(
  new RegExp(
    `<script type="application/json" id="${MANIFEST_ID}">([\\s\\S]*?)</script>`,
  ),
);
if (!raw) fail(`no #${MANIFEST_ID} block in ${PAGE}`);

let manifest;
try {
  manifest = JSON.parse(raw[1]);
} catch (err) {
  fail(`#${MANIFEST_ID} is not valid JSON: ${errorMessage(err)}`);
}

const jobNames = (workflow: string) =>
  new Set(
    [...readFileSync(workflow, 'utf8').matchAll(/^\s{4}name: (.+)$/gm)].map(
      (m) => m[1].trim(),
    ),
  );
const ciJobNames = jobNames(CI_WORKFLOW);
const reviewJobNames = jobNames(REVIEW_WORKFLOW);
const gateTierLabelsInCatalog = JSON.parse(readFileSync(LABELS, 'utf8'))
  .orchestration.map((l: { name: string }) => l.name)
  .filter((n: string) => n.startsWith('gate:'));

const findings: string[] = [];
const eqList = (key: string, expected: Iterable<string>, actual: unknown) => {
  const want = JSON.stringify([...expected]);
  const got = JSON.stringify(actual ?? null);
  if (want !== got)
    findings.push(`${key}: source says ${want}, page says ${got}`);
};

eqList('reviewTierLabels', REVIEW_TIER_LABELS, manifest.reviewTierLabels);
eqList('findingSeverities', FINDING_SEVERITIES, manifest.findingSeverities);
eqList(
  'findingEvidenceKinds',
  FINDING_EVIDENCE_KINDS,
  manifest.findingEvidenceKinds,
);
eqList('findingAxes', FINDING_AXES, manifest.findingAxes);
eqList('verdictValues', VERDICT_VALUES, manifest.verdictValues);
eqList(
  'findingIdentityFields',
  FINDING_IDENTITY_FIELDS,
  manifest.findingIdentityFields,
);
// The identity tuple now names a bounded vocabulary rather than a free-form
// source (issue #724), so the page has to show which vocabulary. A page that
// pictures `ruleId` without its families describes an enum with no members.
eqList('ruleFamilies', RULE_FAMILIES, manifest.ruleFamilies);
eqList(
  'requiredCheckContexts',
  REQUIRED_CHECK_CONTEXTS,
  manifest.requiredCheckContexts,
);
// The identity fields and the version that scopes them move together: an id
// only means anything within a schema version, so a page that names one and
// not the other describes a diff nobody can reproduce (issue #718).
if (manifest.reportSchemaVersion !== REPORT_SCHEMA_VERSION)
  findings.push(
    `reportSchemaVersion: source says ${REPORT_SCHEMA_VERSION}, page says ${JSON.stringify(manifest.reportSchemaVersion ?? null)}`,
  );
eqList('gateTierLabels', GATE_TIER_LABELS, manifest.gateTierLabels);

for (const context of REQUIRED_CHECK_CONTEXTS) {
  if (!ciJobNames.has(context))
    findings.push(
      `requiredCheckContexts: "${context}" is not a job name in ${CI_WORKFLOW}`,
    );
}
eqList('gateTierLabels (catalog)', GATE_TIER_LABELS, gateTierLabelsInCatalog);

// Both checks get the same three guards, because either name going stale
// leaves the page confidently wrong: the manifest must agree with the source
// constant, the name must still be a job, and the word must appear in the
// prose below. `Agent Review Ran` had only the middle one for a while, which
// is the asymmetry this loop removes.
for (const [key, check] of [
  ['agentVerdictCheck', AGENT_VERDICT_CHECK],
  ['agentReviewRanCheck', AGENT_REVIEW_RAN_CHECK],
]) {
  if (manifest[key] !== check)
    findings.push(
      `${key}: source says ${JSON.stringify(check)}, page says ${JSON.stringify(manifest[key] ?? null)}`,
    );
  if (!reviewJobNames.has(check))
    findings.push(`${key}: "${check}" is not a job name in ${REVIEW_WORKFLOW}`);
}

// Every vocabulary word the manifest asserts must also be visible in the page
// body, or the manifest is decoration rather than a description of the picture.
const body = page.replace(raw[0], '');
for (const word of [
  ...REVIEW_TIER_LABELS,
  ...FINDING_SEVERITIES,
  ...FINDING_EVIDENCE_KINDS,
  ...VERDICT_VALUES,
  ...FINDING_IDENTITY_FIELDS,
  ...RULE_FAMILIES,
  AGENT_VERDICT_CHECK,
  AGENT_REVIEW_RAN_CHECK,
]) {
  if (!body.includes(word))
    findings.push(`"${word}" is in the manifest but nowhere in the page body`);
}

// The version is a number the page states in prose, so asserting the word
// `schemaVersion` appears would be satisfied by editing the file — the shape
// ADR 0043 rejects. The page writes its current-version claims as
// `currently <code>N</code>`; every one of them is compared to the constant,
// and there must be at least one, or the manifest pins a version the picture
// never states.
const versionClaims = [...body.matchAll(/currently <code>(\d+)<\/code>/g)].map(
  (m) => Number(m[1]),
);
if (versionClaims.length === 0)
  findings.push(
    'reportSchemaVersion: the page body states no current version — write it as `currently <code>N</code>`',
  );
for (const claimed of versionClaims) {
  if (claimed !== REPORT_SCHEMA_VERSION)
    findings.push(
      `reportSchemaVersion: the page body says the current version is ${claimed}, source says ${REPORT_SCHEMA_VERSION}`,
    );
}

if (findings.length) {
  console.error(
    `review-pages: ${findings.length} finding(s) — ${PAGE} is out of date`,
  );
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `review-pages: OK — ${PAGE} matches the finding contract, ${RULE_FAMILIES.length} rule families, ${REQUIRED_CHECK_CONTEXTS.length} required checks, the ${AGENT_VERDICT_CHECK} and ${AGENT_REVIEW_RAN_CHECK} jobs, and ${GATE_TIER_LABELS.length} gate tier labels`,
);
