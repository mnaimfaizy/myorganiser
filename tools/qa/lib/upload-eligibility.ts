/**
 * Which QA Artifacts the Maintainer may choose to upload (ADR 0147
 * decisions 5 and 6).
 *
 * Eligible is not uploaded: the default is none, the choice is the
 * Maintainer's, and only QA Accounts may appear in what is uploaded. This
 * rule only says what may be offered.
 *
 *   - Only a combined file (decision 5) is eligible; a lone Before or After
 *     never is, whatever the result.
 *   - A FAIL: regression's file stays local (decision 6).
 *   - Every other result's combined file may be offered: a Before that shows
 *     the defect is not a failed run, and a FAIL: pre-existing's documents the
 *     filed issue.
 *
 * Pure. The change kind is not an input: a fix and a feature are offered the
 * same way once the result is known, because the result already carries
 * whether Before showed the defect.
 */
import type { ScenarioResult } from './grade-scenarios.ts';

export const ARTIFACT_SIDES = ['before', 'after', 'combined'] as const;
export type ArtifactSide = (typeof ARTIFACT_SIDES)[number];

/**
 * Whether a scenario's file may be offered, by result and side. Only the
 * combined column is ever true (decision 5), and only a FAIL: regression's
 * combined file is withheld (decision 6).
 *
 * Not proven and Left for a person stay eligible: ADR 0142 decision 3 makes
 * every QA Artifact eligible for the Maintainer's choice, default none, and
 * keeps local only a failed run's. ADR 0147 decision 6 replaces just that
 * rule: a regression stays local, a pre-existing failure and a Before that
 * shows the defect may be uploaded. Neither of these two results is a failed
 * run, so no ADR restricts them.
 */
const ELIGIBLE = {
  PASS: { before: false, after: false, combined: true },
  'FAIL: regression': { before: false, after: false, combined: false },
  'FAIL: pre-existing': { before: false, after: false, combined: true },
  'Not proven': { before: false, after: false, combined: true },
  'Left for a person': { before: false, after: false, combined: true },
} as const satisfies Record<ScenarioResult, Record<ArtifactSide, boolean>>;

export function isUploadEligible(
  result: ScenarioResult,
  side: ArtifactSide,
): boolean {
  return ELIGIBLE[result][side];
}
