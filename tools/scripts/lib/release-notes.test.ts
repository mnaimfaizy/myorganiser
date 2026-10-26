import assert from 'node:assert/strict';
import test from 'node:test';

import {
  abandonedCutSteps,
  classifyCommit,
  DEFAULT_NOTES_FILE,
  OPENAPI_SYNC_OUTPUTS,
  releaseCommitPaths,
  resolveNotesPlan,
  unstagedPaths,
  upsertChangelogSection,
} from './release-notes.ts';

/**
 * A generated entry body carries its own `## Changes since ...` sub-heading at
 * the same heading level as the version heading. That collision is the source
 * of the v0.4.0 duplication, so every fixture here reproduces it.
 */
function entryFor(
  versionTag: string,
  previousTag: string,
  featureLine: string,
): string {
  return [
    `## ${versionTag} - 2026-08-18`,
    '',
    'Date: 2026-08-18',
    '',
    `## Changes since ${previousTag}`,
    '',
    '### Features',
    `- ${featureLine}`,
  ].join('\n');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('inserts a new section above the newest existing version', () => {
  const existing = [
    '# Changelog',
    '',
    '## v0.3.0 - 2026-08-03',
    '',
    'old body',
    '',
  ].join('\n');

  const result = upsertChangelogSection(existing, {
    versionTag: 'v0.4.0',
    entry: entryFor('v0.4.0', 'v0.3.0', 'new feature'),
  });

  assert.match(result, /^# Changelog/);
  assert.ok(
    result.indexOf('## v0.4.0') < result.indexOf('## v0.3.0'),
    'newest version must come first',
  );
  assert.ok(result.includes('old body'), 'existing sections are preserved');
});

test('replaces an existing section instead of duplicating its body', () => {
  const existing = [
    '# Changelog',
    '',
    entryFor('v0.4.0', 'v0.3.0', 'OLD feature'),
    '',
    '## v0.3.0 - 2026-08-03',
    '',
    'older body',
    '',
  ].join('\n');

  const result = upsertChangelogSection(existing, {
    versionTag: 'v0.4.0',
    entry: entryFor('v0.4.0', 'v0.3.0', 'NEW feature'),
  });

  // Regression: the old boundary regex stopped at `## Changes since`, so the
  // previous body survived and the entry appeared twice.
  assert.equal(countOccurrences(result, '## Changes since v0.3.0'), 1);
  assert.equal(countOccurrences(result, '## v0.4.0'), 1);
  assert.ok(!result.includes('OLD feature'), 'stale body must be removed');
  assert.ok(result.includes('NEW feature'));
  assert.ok(result.includes('older body'), 'later versions are untouched');
});

test('replaces a section that is the last one in the file', () => {
  // Regression: the old boundary stopped at the entry's own `## Changes since`
  // sub-heading, so the stale body survived even with nothing after it. The
  // intended end-of-input fallback could not save it either -- that alternative
  // was written `\Z`, which in JavaScript matches a literal "Z".
  const existing = [
    '# Changelog',
    '',
    entryFor('v0.1.0', 'v0.0.1', 'OLD feature'),
    '',
  ].join('\n');

  const result = upsertChangelogSection(existing, {
    versionTag: 'v0.1.0',
    entry: entryFor('v0.1.0', 'v0.0.1', 'NEW feature'),
  });

  assert.equal(countOccurrences(result, '## v0.1.0'), 1);
  assert.equal(countOccurrences(result, '## Changes since v0.0.1'), 1);
  assert.ok(!result.includes('OLD feature'));
});

test('is idempotent when applied twice', () => {
  const existing = [
    '# Changelog',
    '',
    '## v0.3.0 - 2026-08-03',
    '',
    'old body',
    '',
  ].join('\n');
  const entry = entryFor('v0.4.0', 'v0.3.0', 'new feature');

  const once = upsertChangelogSection(existing, {
    versionTag: 'v0.4.0',
    entry,
  });
  const twice = upsertChangelogSection(once, { versionTag: 'v0.4.0', entry });

  assert.equal(twice, once);
});

test('does not confuse a version with a longer prefix match', () => {
  const existing = [
    '# Changelog',
    '',
    '## v0.4.10 - 2026-09-01',
    '',
    'ten body',
    '',
    '## v0.4.1 - 2026-08-20',
    '',
    'one body',
    '',
  ].join('\n');

  const result = upsertChangelogSection(existing, {
    versionTag: 'v0.4.1',
    entry: entryFor('v0.4.1', 'v0.4.0', 'patched'),
  });

  assert.ok(result.includes('ten body'), 'v0.4.10 must not be overwritten');
  assert.ok(!result.includes('one body'), 'v0.4.1 body is replaced');
  assert.equal(countOccurrences(result, '## v0.4.10'), 1);
});

test('seeds the title when the changelog is empty', () => {
  const result = upsertChangelogSection('', {
    versionTag: 'v0.1.0',
    entry: entryFor('v0.1.0', 'v0.0.1', 'first'),
  });

  assert.match(result, /^# Changelog\n/);
  assert.ok(result.includes('## v0.1.0'));
  assert.ok(result.endsWith('\n'));
});

test('notes plan defaults to generated notes', () => {
  assert.deepEqual(resolveNotesPlan({}), {
    mode: 'generated',
    notesFile: null,
    notesFrom: null,
  });

  assert.deepEqual(resolveNotesPlan({ notesFile: 'RELEASE_NOTES.md' }), {
    mode: 'generated',
    notesFile: 'RELEASE_NOTES.md',
    notesFrom: null,
  });
});

test('notes plan gives authored prose a destination by default', () => {
  const plan = resolveNotesPlan({ notesFrom: '/tmp/draft.md' });

  assert.equal(plan.mode, 'authored');
  assert.equal(plan.notesFrom, '/tmp/draft.md');
  assert.equal(
    plan.notesFile,
    DEFAULT_NOTES_FILE,
    'authored notes must not be read and then discarded',
  );
});

test('notes plan honours an explicit destination for authored prose', () => {
  const plan = resolveNotesPlan({
    notesFrom: '/tmp/draft.md',
    notesFile: 'docs/NOTES.md',
  });

  assert.equal(plan.mode, 'authored');
  assert.equal(plan.notesFile, 'docs/NOTES.md');
});

test('notes plan rejects --no-notes combined with --notes-from', () => {
  const plan = resolveNotesPlan({
    notesFrom: '/tmp/draft.md',
    skipNotes: true,
  });

  assert.ok(plan.error, 'contradictory flags must not silently pick a winner');
  assert.match(plan.error, /--no-notes/);
  assert.match(plan.error, /--notes-from/);
  assert.equal(plan.mode, undefined);
});

test('notes plan skips notes entirely with --no-notes', () => {
  assert.deepEqual(resolveNotesPlan({ skipNotes: true }), {
    mode: 'none',
    notesFile: null,
    notesFrom: null,
  });

  // --notes-file alone is not enough to re-enable notes.
  assert.equal(
    resolveNotesPlan({ skipNotes: true, notesFile: 'RELEASE_NOTES.md' }).mode,
    'none',
  );
});

test('release commit carries every file the v1.1.0 cut had to add by hand', () => {
  // The version-stamped outputs of `yarn openapi:sync`; omitting them made the
  // pre-commit `openapi:artifacts` gate refuse the release commit.
  const handAdded = [
    'apps/backend/src/swagger/swagger.json',
    'apps/backend/src/swagger/swagger.yaml',
    'libs/api-specs/src/api-specs.openapi.yaml',
    'libs/app-api-client/src/api.ts',
    'libs/app-api-client/src/base.ts',
    'libs/app-api-client/src/common.ts',
    'libs/app-api-client/src/configuration.ts',
    'libs/app-api-client/src/index.ts',
  ];
  const paths = releaseCommitPaths({ notesFile: DEFAULT_NOTES_FILE });

  for (const file of handAdded) {
    assert.ok(
      paths.some((p) => file === p || file.startsWith(`${p}/`)),
      `${file} is not staged by the release commit`,
    );
  }
});

test('release commit paths include the notes file only when there is one', () => {
  assert.deepEqual(releaseCommitPaths({ notesFile: 'RELEASE_NOTES.md' }), [
    'package.json',
    'CHANGELOG.md',
    'RELEASE_NOTES.md',
    ...OPENAPI_SYNC_OUTPUTS,
  ]);
  assert.deepEqual(releaseCommitPaths({ notesFile: null }), [
    'package.json',
    'CHANGELOG.md',
    ...OPENAPI_SYNC_OUTPUTS,
  ]);
});

test('an abandoned cut names the way back to a clean main', () => {
  const steps = abandonedCutSteps('release/v1.2.3');

  assert.match(steps, /Nothing was committed or pushed/);
  assert.match(steps, /^ {2}git checkout -f main$/m);
  assert.match(steps, /^ {2}git branch -D release\/v1\.2\.3$/m);
  // A bare retry fails assertCleanTree() until the leftovers are gone.
  assert.match(steps, /git status/);
});

test('unstaged paths ignore staged changes and report everything else', () => {
  const porcelain = [
    'M  package.json',
    'A  RELEASE_NOTES.md',
    ' M apps/backend/src/routes/routes.ts',
    'MM CHANGELOG.md',
    '?? stray.txt',
    '',
  ].join('\n');

  assert.deepEqual(unstagedPaths(porcelain), [
    'apps/backend/src/routes/routes.ts',
    'CHANGELOG.md',
    'stray.txt',
  ]);
});

test('unstaged paths are empty for a fully staged or clean tree', () => {
  assert.deepEqual(unstagedPaths('M  package.json\nM  CHANGELOG.md\n'), []);
  assert.deepEqual(unstagedPaths(''), []);
});

test('unstaged paths read the first line only if it keeps its status column', () => {
  // `run()` trims its output; a trimmed ' M x' reads as staged 'M x'. This is
  // why release.mjs passes the raw `git status --porcelain` output.
  assert.deepEqual(unstagedPaths(' M apps/backend/src/routes/routes.ts'), [
    'apps/backend/src/routes/routes.ts',
  ]);
  assert.deepEqual(unstagedPaths('M apps/backend/src/routes/routes.ts'), []);
});

test('classifies conventional commit types', () => {
  assert.deepEqual(classifyCommit('feat(youtube): add queue rail', ''), {
    type: 'feat',
    scope: 'youtube',
    description: 'add queue rail',
    breaking: false,
  });

  assert.equal(classifyCommit('fix(deps): pin nanoid', '').type, 'fix');
  assert.equal(classifyCommit('feat!: drop legacy api', '').breaking, true);
  assert.equal(
    classifyCommit('refactor: reshape', 'BREAKING CHANGE: removed x').breaking,
    true,
  );
  assert.equal(classifyCommit('not a conventional subject', '').type, 'other');
});
