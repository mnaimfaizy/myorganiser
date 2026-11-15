#!/usr/bin/env node
// The production gate: holds a production deploy while the Cut's Sign-off
// Issue has a `staging` Person Check that the Maintainer has neither ticked
// nor waived (ADR 0151 decisions 8 and 9).
//
//   node tools/scripts/ci/signoff-gate.ts --release-branch release/vX.Y.Z \
//     [--repository <owner/name>]
//
// Runs in `dispatch-production-deploy.yml` before the deploy is dispatched,
// so Deploy Approval is never asked for a held deploy. A waiver is a comment
// on the Sign-off Issue by the Maintainer, one line per check:
//
//   waive: <pr>:<key> — <reason>
//
// and a held run prints the exact line to paste for each open check.
//
// This is the IO half: read-only `gh api graphql` calls. Every decision is
// pure in tools/scripts/lib/signoff-gate.ts, and its tests cover it; the
// calls here are untested, like the Merge Train's.
//
// Exit 0 = allowed. Exit 1 = held, naming each open check. Exit 2 = it cannot
// decide (an unreadable or truncated read, a deleted revision, two issues
// frozen for the Cut) or a bad invocation; the deploy is held then too.
import { appendFileSync } from 'node:fs';

import {
  decideProductionGate,
  releaseVersion,
  renderGateDecision,
} from '../lib/signoff-gate.ts';
import { readSignOffIssues } from '../lib/signoff-github.ts';

const die = (message: string): never => {
  console.error(`signoff-gate: ${message}`);
  process.exit(2);
};

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const branch =
  flag('--release-branch') ??
  die('--release-branch release/vX.Y.Z is required');
const version =
  releaseVersion(branch) ?? die(`not a release branch: ${branch}`);
const repository =
  flag('--repository') ??
  process.env.GITHUB_REPOSITORY ??
  die('--repository <owner/name> is required outside Actions');
const [owner, name] = repository.split('/');
if (!owner || !name) die(`not <owner/name>: ${repository}`);

const { owner: repoOwner, issues } = readSignOffIssues(owner, name);

const decision = decideProductionGate({ owner: repoOwner, version, issues });
const lines = renderGateDecision(decision);
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Production gate',
      '',
      `Release: \`${version}\``,
      '',
      ...lines,
      '',
    ].join('\n'),
  );
process.exit(
  decision.status === 'allow' ? 0 : decision.status === 'held' ? 1 : 2,
);
