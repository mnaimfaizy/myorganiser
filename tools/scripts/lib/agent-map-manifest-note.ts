/** Canonical `#agent-map-manifest` note for agent map House Explainer Pages.
 *
 * Imported by `build-agent-map.mjs` (when it generates a manifest) and asserted
 * by `check-agent-map.mjs` against both live pages, so the three copies cannot
 * drift (ADR 0046 / ADR 0052 / #709).
 */
export const AGENT_MAP_MANIFEST_NOTE =
  'Asserted by tools/scripts/check-agent-map.mjs: on orchestration-map.html — agents (name→tier), policyReviewedAt, and diagram presence; on agent-journey.html — policyReviewedAt and station tiers in the page script. Edit in place via design-brief → Designer (ADR 0046). Do not rebuild — build-agent-map.mjs is a one-time importer and cannot reproduce these pages.';
