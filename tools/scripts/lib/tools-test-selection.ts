/**
 * The decision behind Husky's pre-commit selection of tools/scripts Contract
 * Suites: which `*.test.ts` / `*.test.mjs` files a commit's staged files
 * select (ADR 0135 slice 2).
 *
 * The full set under tools/scripts takes about 34s in one `node --test` run,
 * so a commit outside tooling should pay nothing, and a commit touching one
 * checker should pay for that checker's suite, not every suite under
 * tools/scripts. `tools:test` runs the full glob in CI on every push and
 * pull request, so this selection trades completeness for speed on purpose —
 * it is a fast local check backed by a complete CI gate, not the only line
 * of defense.
 *
 * Two kinds of staged file select a suite:
 *   - the suite itself, staged directly;
 *   - a script staged alongside it — paired by name, `check-x.mjs` ->
 *     `check-x.test.mjs` or `check-x.test.ts`, in the same directory.
 *
 * A pairing is only reported when the candidate suite actually exists in the
 * `suites` list this function is handed: staging a new `check-x.mjs` before
 * its suite exists selects nothing, rather than asking Husky to run a file
 * that is not there yet.
 *
 * Pure: every input is passed in, so the Contract Suite exercises fixtures,
 * never the real git index or disk.
 */

export const SCRIPTS_DIR = 'tools/scripts';

const normalize = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Every suite a commit's staged tools/scripts files select.
 *
 * @returns suite paths, sorted and de-duplicated
 */
export function selectStagedSuites({
  stagedFiles,
  suites,
}: {
  stagedFiles: string[];
  suites: string[];
}): string[] {
  const suiteSet = new Set(suites.map(normalize));
  const selected = new Set<string>();

  for (const raw of stagedFiles) {
    const file = normalize(raw);
    if (!file.startsWith(`${SCRIPTS_DIR}/`)) continue;

    if (suiteSet.has(file)) {
      selected.add(file);
      continue;
    }

    const withoutExt = file.replace(/\.(mjs|ts)$/, '');
    if (withoutExt === file) continue;

    for (const ext of ['ts', 'mjs']) {
      const candidate = `${withoutExt}.test.${ext}`;
      if (suiteSet.has(candidate)) selected.add(candidate);
    }
  }

  return [...selected].sort();
}
