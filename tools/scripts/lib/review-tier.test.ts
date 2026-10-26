import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REVIEW_TIER_LABELS,
  type ReviewTier,
  type ReviewTierResult,
  type SignalKind,
  ReviewTierConfigError,
  classifyReviewTier,
  errorResult,
  globToRegExp,
  loadPathMap,
  maxTier,
  parseNumstat,
  planRelabel,
  renderReviewTierSummary,
} from './review-tier.ts';

const node = (name: string, root: string, tier?: ReviewTier) => ({
  name,
  data: { root, tags: tier ? [`tier:${tier}`] : [] },
});
const edge = (source: string, target: string) => ({
  source,
  target,
  type: 'static',
});

/** web-app → web-pages-tasks → core; vault-ui (human) → core; untagged → core. */
const graph = {
  nodes: {
    'web-app': node('web-app', 'apps/web', 'agent'),
    'web-pages-tasks': node('web-pages-tasks', 'libs/web/pages/tasks', 'agent'),
    'web-pages': node('web-pages', 'libs/web/pages', 'agent'),
    core: node('core', 'libs/core', 'agent'),
    'vault-ui': node('vault-ui', 'libs/vault-ui', 'human'),
    docs: node('docs', 'libs/docs', 'auto'),
    untagged: node('untagged', 'libs/untagged'),
  },
  dependencies: {
    'web-app': [
      edge('web-app', 'web-pages-tasks'),
      edge('web-app', 'npm:react'),
    ],
    'web-pages-tasks': [edge('web-pages-tasks', 'core')],
    'vault-ui': [edge('vault-ui', 'core')],
    untagged: [edge('untagged', 'docs')],
  },
};

const pathMap = {
  schemaVersion: 1,
  rules: [
    {
      id: 'workflows',
      tier: 'human',
      reason: 'ci',
      patterns: ['.github/workflows/**'],
    },
    {
      id: 'adr',
      tier: 'agent',
      reason: 'decisions',
      patterns: ['docs/adr/**'],
    },
    { id: 'prose', tier: 'auto', reason: 'docs', patterns: ['**/*.md'] },
  ],
  size: {
    auto: { maxFiles: 5, maxLines: 100 },
    agent: { maxFiles: 20, maxLines: 1000 },
  },
  blastRadius: { auto: { maxProjects: 2 }, agent: { maxProjects: 4 } },
  reach: { exclude: ['**/*.stories.tsx', '**/*.spec.ts'] },
  authors: { trusted: ['owner'] },
};

const f = (path: string, additions = 1, deletions = 0) => ({
  path,
  additions,
  deletions,
});
const classify = (
  files: { path: string; additions?: number; deletions?: number }[],
  overrides: Record<string, unknown> = {},
) =>
  classifyReviewTier({ files, graph, pathMap, author: 'owner', ...overrides });
// `!`: every test below names a signal the classifier always emits for its
// fixture, so a miss should read as the property access failing, exactly as it
// did before this file carried types.
const signal = (result: ReviewTierResult, kind: SignalKind) =>
  result.signals.find((s) => s.kind === kind)!;

test('a classifier error is human, not a missing tier', () => {
  const result = errorResult('nx graph failed', 'owner');
  assert.equal(result.tier, 'human');
  assert.equal(result.label, 'review:human');
  assert.equal(result.signals[0].kind, 'error');
  assert.equal(result.signals[0].detail, 'nx graph failed');
});

test('classifier labels match the finding-contract tuple in schema.mjs', async () => {
  // Two declarations on purpose: schema.mjs is the finding contract (zod
  // `z.enum` needs a const tuple) and this module must not import it, because
  // apply-review-tier-label.mjs runs without zod. Changing schema.mjs also
  // retriggers guard golden replay (ADR 0072). The values still have to be
  // the same three labels or planRelabel would accept a label the validator
  // rejects.
  const { REVIEW_TIER_LABELS: schemaLabels } =
    await import('../review/schema.mjs');
  assert.deepEqual([...REVIEW_TIER_LABELS], [...schemaLabels]);
});

test('tiers are ordered and the labels derive from them', () => {
  assert.deepEqual(REVIEW_TIER_LABELS, [
    'review:auto',
    'review:agent',
    'review:human',
  ]);
  assert.equal(maxTier('auto', 'agent'), 'agent');
  assert.equal(maxTier('human', 'auto'), 'human');
  assert.equal(maxTier(), 'auto');
});

test('planRelabel adds the target and removes the other review labels, or does nothing', () => {
  assert.deepEqual(planRelabel(['tooling', 'review:agent'], 'review:human'), {
    add: ['review:human'],
    remove: ['review:agent'],
  });
  assert.equal(planRelabel(['tooling', 'review:human'], 'review:human'), null);
  assert.equal(planRelabel(['tooling'], null), null);
  assert.deepEqual(planRelabel([], 'review:auto'), {
    add: ['review:auto'],
    remove: [],
  });
  assert.throws(() => planRelabel([], 'review:ship'), /unknown tier label/);
});

test('globs: ** spans directories, * stays inside a segment', () => {
  assert.ok(
    globToRegExp('.github/workflows/**').test('.github/workflows/a/b.yml'),
  );
  assert.ok(globToRegExp('**/package.json').test('package.json'));
  assert.ok(globToRegExp('**/package.json').test('apps/x/package.json'));
  assert.ok(
    !globToRegExp('tools/scripts/check-*.mjs').test(
      'tools/scripts/lib/check-a.mjs',
    ),
  );
  assert.ok(
    globToRegExp('apps/backend/src/**/*auth*').test(
      'apps/backend/src/services/auth.service.ts',
    ),
  );
  assert.ok(!globToRegExp('docs/**/*.md').test('docs/page.html'));
  assert.ok(globToRegExp('README.md').test('README.md'));
  assert.ok(!globToRegExp('README.md').test('libs/x/README.md'));
});

test('a prose-only diff by a trusted author is auto', () => {
  const result = classify([f('docs/features/tasks.md', 10, 2)]);
  assert.equal(result.tier, 'auto');
  assert.equal(result.label, 'review:auto');
  assert.equal(result.files[0].source, 'path');
  assert.equal(result.files[0].rule, 'prose');
  assert.deepEqual(result.projects.changed, []);
});

test('a file resolves to the longest project root that contains it', () => {
  const result = classify([f('libs/web/pages/tasks/src/index.ts')]);
  assert.equal(result.files[0].project, 'web-pages-tasks');
  assert.deepEqual(result.projects.changed, ['web-pages-tasks']);
  assert.equal(result.tier, 'agent');
});

test('the first matching rule wins and beats the owning project tag', () => {
  // A README inside a human project is prose: the map, not the tag, decides.
  const result = classify([f('libs/vault-ui/README.md')]);
  assert.equal(result.files[0].tier, 'auto');
  assert.equal(result.files[0].project, 'vault-ui');
  assert.equal(result.tier, 'auto');
});

test('a human path anywhere in the diff makes the whole diff human', () => {
  const result = classify([
    f('docs/features/tasks.md'),
    f('.github/workflows/ci.yml'),
  ]);
  assert.equal(result.tier, 'human');
  assert.equal(signal(result, 'path').id, 'workflows');
});

test('a change reaches a human project through the graph', () => {
  // core is agent, but vault-ui (human) imports it.
  const result = classify([f('libs/core/src/index.ts')]);
  assert.equal(result.tier, 'human');
  const reach = signal(result, 'reach');
  assert.equal(reach.tier, 'human');
  assert.match(reach.detail, /vault-ui \(imports core\)/);
  assert.deepEqual(
    result.projects.reached.map((r) => r.name),
    ['vault-ui', 'web-app', 'web-pages-tasks'],
  );
});

test('a story or a test counts for its project but never seeds reach', () => {
  // core is imported by vault-ui (human); a core story cannot change vault-ui.
  const storyOnly = classify([f('libs/core/src/Button.stories.tsx')]);
  assert.equal(storyOnly.tier, 'agent');
  assert.deepEqual(storyOnly.projects.changed, ['core']);
  assert.deepEqual(storyOnly.projects.reached, []);
  assert.equal(signal(storyOnly, 'reach'), undefined);

  // One runtime file alongside the story seeds the walk again.
  const mixed = classify([
    f('libs/core/src/Button.stories.tsx'),
    f('libs/core/src/index.ts'),
  ]);
  assert.equal(mixed.tier, 'human');
  assert.equal(signal(mixed, 'reach').tier, 'human');

  // The exclusion never lowers the project's own tier.
  const humanTest = classify([f('libs/vault-ui/src/a.spec.ts')]);
  assert.equal(humanTest.tier, 'human');
});

test('an untagged project, whether changed or reached, is human', () => {
  const changed = classify([f('libs/untagged/src/a.ts')]);
  assert.equal(changed.files[0].source, 'untagged');
  assert.equal(signal(changed, 'project').tier, 'human');

  const reached = classify([f('libs/docs/src/a.ts')]);
  assert.equal(signal(reached, 'reach').tier, 'human');
  assert.equal(reached.tier, 'human');
});

test('a path outside every project and every rule is human', () => {
  const result = classify([f('random.config.js')]);
  assert.equal(result.tier, 'human');
  assert.equal(signal(result, 'unmatched').files![0], 'random.config.js');
});

test('an empty diff is human', () => {
  assert.equal(classify([]).tier, 'human');
  assert.equal(signal(classify([]), 'empty').tier, 'human');
});

test('size thresholds raise auto to agent and agent to human', () => {
  const small = classify([f('docs/a.md', 50, 50)]);
  assert.equal(signal(small, 'size').tier, 'auto');

  const medium = classify([f('docs/a.md', 101, 0)]);
  assert.equal(signal(medium, 'size').tier, 'agent');
  assert.equal(medium.tier, 'agent');

  const manyFiles = classify(
    Array.from({ length: 6 }, (_, i) => f(`docs/${i}.md`)),
  );
  assert.equal(signal(manyFiles, 'size').tier, 'agent');

  const huge = classify([f('docs/a.md', 1001, 0)]);
  assert.equal(signal(huge, 'size').tier, 'human');
  assert.equal(huge.tier, 'human');
});

test('blast radius counts changed plus reached projects', () => {
  // web-pages-tasks → web-app: 2 projects, within auto.
  const narrow = classify([f('libs/web/pages/tasks/src/a.ts')]);
  assert.equal(signal(narrow, 'blast-radius').tier, 'auto');
  // core reaches 3 more: 4 projects, over auto, within agent.
  const wide = classify([f('libs/core/src/a.ts')]);
  assert.equal(signal(wide, 'blast-radius').tier, 'agent');
});

test('the author signal: missing, bot, and untrusted are human', () => {
  const file = [f('docs/a.md')];
  assert.equal(classify(file, { author: undefined }).tier, 'human');
  assert.equal(classify(file, { author: 'dependabot[bot]' }).tier, 'human');
  assert.equal(classify(file, { author: 'stranger' }).tier, 'human');
  assert.equal(classify(file, { author: 'owner' }).tier, 'auto');
});

test('the tier is the maximum over every signal, and every signal is reported', () => {
  const result = classify([f('docs/adr/0001-x.md')]);
  assert.equal(result.tier, 'agent');
  assert.deepEqual(
    result.signals.map((s) => s.kind),
    ['path', 'size', 'blast-radius', 'author'],
  );
});

test('a malformed path map is a config error, not a classification', () => {
  const bad = {
    ...pathMap,
    rules: [{ id: 'x', tier: 'ship-it', reason: 'r', patterns: ['a'] }],
  };
  assert.throws(
    () => classifyReviewTier({ files: [], graph, pathMap: bad }),
    ReviewTierConfigError,
  );
  assert.throws(
    () =>
      classifyReviewTier({
        files: [],
        graph,
        pathMap: { ...pathMap, size: {} },
      }),
    /size\.auto\.maxFiles/,
  );
});

test('the committed path map loads and keeps human rules ahead of auto rules', () => {
  const map = loadPathMap();
  const tiers = map.rules.map((r) => r.tier);
  const lastHuman = tiers.lastIndexOf('human');
  const firstAuto = tiers.indexOf('auto');
  assert.ok(lastHuman < firstAuto, 'a human rule follows an auto rule');
  // The map protects itself and the tags the classifier reads (ADR 0070 item 3).
  const gates = map.rules.find((r) => r.id === 'gates-and-their-config');
  assert.ok(gates!.patterns.includes('tools/config/**'));
  assert.ok(gates!.patterns.includes('**/project.json'));
  // The lockfile is human and package.json alone is not: a dependency change
  // always moves yarn.lock under an immutable install.
  assert.equal(
    map.rules.find((r) => r.id === 'dependency-lockfiles')!.tier,
    'human',
  );
  assert.equal(
    map.rules.find((r) => r.id === 'package-manifests')!.tier,
    'agent',
  );
  assert.ok(map.reach!.exclude!.includes('**/*.stories.tsx'));
});

test('numstat parsing handles binaries and renames', () => {
  const files = parseNumstat(
    [
      '3\t1\tdocs/a.md',
      '-\t-\tassets/logo.png',
      '0\t0\tlibs/{old => new}/index.ts',
      '2\t2\told.md => new.md',
      '',
    ].join('\n'),
  );
  assert.deepEqual(files, [
    { path: 'docs/a.md', additions: 3, deletions: 1 },
    { path: 'assets/logo.png', additions: 0, deletions: 0 },
    { path: 'libs/new/index.ts', additions: 0, deletions: 0 },
    { path: 'new.md', additions: 2, deletions: 2 },
  ]);
});

test('the summary names the tier, lists every signal, and points at the checker', () => {
  const result = classify([f('libs/core/src/index.ts')]);
  const md = renderReviewTierSummary(result, {
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
  });
  assert.match(md, /^## Review Tier: `review:human`/);
  assert.match(md, /check-review-tier\.ts/);
  assert.match(md, /\| reach \| `human` \|/);
  assert.match(md, /Range: `aaaaaaa\.\.bbbbbbb`/);
  for (const s of result.signals)
    assert.ok(md.includes(`| ${s.id ? `${s.kind} · ${s.id}` : s.kind} |`));
});
