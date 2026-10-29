/**
 * The decision behind `covering-gates:check`: a path-gated Covering Gate
 * still runs on every change it covers (ADR 0140, ADR 0074).
 *
 * ADR 0074 settles that a gate suppresses a finding only when something runs
 * it, and the reviewer answers that by reading the hooks, the workflows, and
 * the `yarn gates:run` manifest for the gate's script name. Path-gating adds
 * a second way for a gate to run nowhere that reading a name cannot see: the
 * step exists, the workflow invokes it, and its `if:` was false for this pull
 * request. A reviewer greps `openapi:check`, finds the step, records
 * `wiredBy: .github/workflows/ci.yml`, and suppresses the one finding that
 * mattered — which is exactly the `release-bump-leaves-generated-client-stale`
 * incident ADR 0074 was written for, reintroduced through a gate-trigger
 * glob instead of a missing hook line.
 *
 * So the trigger globs of a path-gated gate have to be a **superset** of the
 * trigger paths of every review obligation that names it as its
 * `coveringGate` (ADR 0098). This module is that comparison.
 *
 * Which direction(s) this asserts, and why the others are omitted:
 *
 *   - **Asserted:** every obligation trigger path whose `coveringGate` is a
 *     suite in `tools/config/gate-triggers.json` is covered by that suite's
 *     own triggers or by a shared input. A gate narrower than its obligation
 *     fails, naming the gate, the obligation, and the uncovered glob.
 *   - **Asserted:** a Covering Gate reached only through a non-path trigger
 *     (`guardedEnums`, which fires on an enum rather than on a path) is not
 *     path-gated at all. There is no trigger path to compare against, so the
 *     only safe state is for the gate to run on every pull request.
 *   - **Omitted:** a suite in the gate-trigger config that no obligation
 *     names. A heavy suite does not have to be anyone's Covering Gate, and
 *     failing on that would make adding one to the config impossible.
 *   - **Omitted:** whether the gate is invoked by any pipeline at all. That
 *     is the Meta-Gate's assertion (`gates:coverage:check`, ADR 0043), and
 *     repeating it here would report one defect twice.
 *   - **Omitted:** whether a `coveringGate` names a real npm script. The
 *     obligation catalogue's own validation asserts that
 *     (`tools/scripts/review/obligations.ts`).
 *
 * Pure: every input is passed in, so the Contract Suite exercises fixtures.
 */

import type { GateTriggerConfig } from './gate-triggers.ts';

/** One place a review obligation names a Covering Gate. */
export interface CoveringGateSite {
  obligationId: string;
  coveringGate: string;
  /**
   * The obligation's trigger glob, or `null` when the obligation reaches the
   * gate through a non-path trigger and there is no path to compare.
   */
  glob: string | null;
}

interface RawTriggerPath {
  glob?: unknown;
  coveringGate?: unknown;
}

interface RawObligation {
  id?: unknown;
  trigger?: {
    paths?: unknown;
    guardedEnums?: { coveringGate?: unknown };
  };
}

/**
 * Every `coveringGate` the catalogue names, with the trigger it was named
 * against. Tolerant by design: the catalogue's own validator owns its shape,
 * and a checker that threw on an unexpected field would turn a catalogue
 * change into two failures reported in two places.
 */
export function collectCoveringGateSites(
  obligations: readonly unknown[],
): CoveringGateSite[] {
  const sites: CoveringGateSite[] = [];
  for (const raw of obligations) {
    const obligation = raw as RawObligation | null;
    if (!obligation || typeof obligation !== 'object') continue;
    const obligationId =
      typeof obligation.id === 'string'
        ? obligation.id
        : '(unnamed obligation)';
    const trigger = obligation.trigger;
    if (!trigger || typeof trigger !== 'object') continue;

    if (Array.isArray(trigger.paths)) {
      for (const entry of trigger.paths) {
        if (!entry || typeof entry !== 'object') continue;
        const path = entry as RawTriggerPath;
        if (typeof path.coveringGate !== 'string' || !path.coveringGate)
          continue;
        if (typeof path.glob !== 'string' || !path.glob) continue;
        sites.push({
          obligationId,
          coveringGate: path.coveringGate,
          glob: path.glob,
        });
      }
    }

    const guarded = trigger.guardedEnums?.coveringGate;
    if (typeof guarded === 'string' && guarded) {
      sites.push({ obligationId, coveringGate: guarded, glob: null });
    }
  }
  return sites;
}

/**
 * Does `outer` match every path `inner` matches?
 *
 * Deliberately narrow, and sound rather than complete: a glob pair it cannot
 * prove covering is reported as uncovered, never passed. Three forms cover
 * the catalogues in this repository —
 *
 *   - the same glob, written identically;
 *   - `**`, which matches the whole tree;
 *   - a directory prefix, `dir/**` over anything under `dir/`.
 *
 * Anything else — an interior `**`, a `*` or `?` inside a segment — fails,
 * because deciding containment for those needs a pattern-inclusion algorithm
 * whose wrong answers would be silent passes. `dir/*` deliberately does not
 * cover `dir/**`: the single-segment form matches one level and the pair
 * matches every level, which is the one near-miss a substring comparison
 * would have got backwards.
 */
export function coversGlob(outer: string, inner: string): boolean {
  if (outer === inner) return true;
  if (outer === '**') return true;
  if (!outer.endsWith('/**')) return false;
  const prefix = outer.slice(0, -2); // keep the trailing slash
  if (/[*?]/.test(prefix)) return false;
  return inner.startsWith(prefix);
}

export interface AssertCoveringGatesResult {
  ok: boolean;
  findings: string[];
  /** The gates compared, for `--print`. */
  checked: Array<{ gate: string; obligationId: string; glob: string }>;
}

/**
 * Compares every Covering Gate the catalogue names against the gate-trigger
 * config. Returns findings rather than throwing, so one run reports every
 * narrow gate instead of stopping at the first.
 */
export function assertCoveringGates({
  sites,
  config,
}: {
  sites: readonly CoveringGateSite[];
  config: GateTriggerConfig;
}): AssertCoveringGatesResult {
  const gated = new Map(config.suites.map((suite) => [suite.id, suite]));
  const findings: string[] = [];
  const checked: AssertCoveringGatesResult['checked'] = [];

  for (const site of sites) {
    const suite = gated.get(site.coveringGate);
    if (!suite) continue; // not path-gated: it runs on every pull request

    if (site.glob === null) {
      findings.push(
        `${site.coveringGate}: obligation ${site.obligationId} names it as a Covering Gate through a non-path trigger, ` +
          `so there is no trigger path its gate triggers could be checked against — such a gate must not be path-gated ` +
          `in ${'tools/config/gate-triggers.json'} (ADR 0074).`,
      );
      continue;
    }

    checked.push({
      gate: site.coveringGate,
      obligationId: site.obligationId,
      glob: site.glob,
    });

    const covering = [...suite.triggers, ...config.sharedInputs].find((outer) =>
      coversGlob(outer, site.glob as string),
    );
    if (covering) continue;

    findings.push(
      `${site.coveringGate}: its gate triggers do not cover ${site.glob}, a trigger path of review obligation ` +
        `${site.obligationId} that names it as the Covering Gate. A pull request changing only that path would skip ` +
        `the gate while the reviewer still finds its step in the workflow, so a finding could be suppressed on a gate ` +
        `that never ran (ADR 0074). Widen the suite's triggers in tools/config/gate-triggers.json, or stop path-gating it.`,
    );
  }

  return { ok: findings.length === 0, findings, checked };
}
