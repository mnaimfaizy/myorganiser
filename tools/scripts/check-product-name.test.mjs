import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isolateGitEnvironment } from './lib/git-environment.mjs';

// Husky runs this suite with the hook's GIT_DIR; see git-environment.mjs.
isolateGitEnvironment();

// Each fixture repository is built and checked in isolation. The old spelling is assembled
// from parts so that this file does not match the check it tests.
const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-product-name.mjs');
const ALLOWLIST = 'tools/config/product-name-allowlist.json';
const OLD = ['MyOrgani', 'zer'].join('');
const OLD_LOWER = ['myorgani', 'zer'].join('');
const OLD_UPPER = ['MYORGANI', 'ZER'].join('');
const NEW = 'MyOrganiser';
const REASON = 'Fixture reason.';

/**
 * A throwaway repository. Files are staged, so `git ls-files` lists them, and the allowlist is
 * written only when given. Untracked files are written after staging and must be ignored.
 */
function createRepo(
  t,
  { files = {}, allowlist, allowlistText, untracked = {} } = {},
) {
  const workspace = mkdtempSync(join(tmpdir(), 'product-name-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const write = (relative, contents) => {
    const path = join(workspace, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  const git = (...args) =>
    execFileSync('git', args, { cwd: workspace, stdio: 'ignore' });

  git('init', '-q');
  for (const [relative, contents] of Object.entries(files)) {
    write(relative, contents);
  }
  if (allowlistText !== undefined) {
    write(ALLOWLIST, allowlistText);
  } else if (allowlist !== undefined) {
    write(ALLOWLIST, JSON.stringify({ schemaVersion: 1, allowlist }));
  }
  git('add', '-A');
  for (const [relative, contents] of Object.entries(untracked)) {
    write(relative, contents);
  }
  return workspace;
}

const run = (cwd) =>
  spawnSync(process.execPath, [CHECKER], { cwd, encoding: 'utf8' });

test('fails a planted occurrence and names its file and line', (t) => {
  const cwd = createRepo(t, {
    files: { 'docs/notes.md': `# Notes\n\nShips as ${OLD}.\n` },
    allowlist: [],
  });

  const result = run(cwd);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(
    result.stderr.includes(`docs/notes.md:3: Ships as ${OLD}.`),
    result.stderr,
  );
});

test('matches the lower-case identifier and the upper-case constant', (t) => {
  const cwd = createRepo(t, {
    files: {
      'docs/lower.md': `const id = '${OLD_LOWER}-app';\n`,
      'docs/upper.md': `const NAME = '${OLD_UPPER}';\n`,
    },
    allowlist: [],
  });

  const result = run(cwd);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(result.stderr.includes('docs/lower.md:1:'), result.stderr);
  assert.ok(result.stderr.includes('docs/upper.md:1:'), result.stderr);
});

test('excuses an occurrence under an allowlisted directory', (t) => {
  const cwd = createRepo(t, {
    files: { 'docs/research/brief.md': `Quoted as ${OLD}.\n` },
    allowlist: [{ path: 'docs/research/', reason: REASON }],
  });

  const result = run(cwd);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /product-name: OK — 2 tracked file\(s\) checked, 1 allowlisted path\(s\)/,
  );
});

test('an exact-file entry excuses only that file', (t) => {
  const cwd = createRepo(t, {
    files: {
      'docs/legacy.md': `Old name ${OLD}.\n`,
      'docs/sibling.md': `Old name ${OLD}.\n`,
    },
    allowlist: [{ path: 'docs/legacy.md', reason: REASON }],
  });

  const result = run(cwd);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(result.stderr.includes('docs/sibling.md:1:'), result.stderr);
  assert.ok(!result.stderr.includes('docs/legacy.md:'), result.stderr);
  assert.doesNotMatch(result.stderr, /stale entries/);
});

// frozenFrom excuses a file only from the first matching line downward. Text above the
// first released-version heading must use the new spelling.
test('a frozenFrom entry fails an occurrence above the frozen line', (t) => {
  const cwd = createRepo(t, {
    files: {
      'CHANGELOG.md': [
        '# Changelog',
        '',
        `- Shipped as ${OLD}.`,
        '## v1.0.0',
        `- Original entry ${OLD}.`,
        '',
      ].join('\n'),
    },
    allowlist: [
      { path: 'CHANGELOG.md', frozenFrom: '^## v\\d', reason: REASON },
    ],
  });

  const result = run(cwd);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(
    result.stderr.includes(`CHANGELOG.md:3: - Shipped as ${OLD}.`),
    result.stderr,
  );
  assert.ok(!result.stderr.includes('CHANGELOG.md:5:'), result.stderr);
});

test('a frozenFrom entry passes an occurrence only below the frozen line', (t) => {
  const cwd = createRepo(t, {
    files: {
      'CHANGELOG.md': [
        '# Changelog',
        '',
        `## Unreleased\n- Now ${NEW}.`,
        '## v1.0.0',
        `- Original entry ${OLD}.`,
        '',
      ].join('\n'),
    },
    allowlist: [
      { path: 'CHANGELOG.md', frozenFrom: '^## v\\d', reason: REASON },
    ],
  });

  const result = run(cwd);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /product-name: OK/);
});

test('fails a file whose own path contains the old spelling', (t) => {
  const path = `docs/${OLD}-notes.md`;
  const cwd = createRepo(t, {
    files: { [path]: `Clean text with ${NEW}.\n` },
    allowlist: [],
  });

  const result = run(cwd);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(result.stderr.includes(`${path}: the path itself`), result.stderr);
});

// Each stale kind is reported on its own line; the check fails without any content finding.
test('fails each stale allowlist entry', (t) => {
  const cwd = createRepo(t, {
    files: {
      'docs/clean.md': `Uses ${NEW}.\n`,
      'CHANGELOG.md': `# Changelog\n\n- Uses ${NEW}.\n`,
    },
    allowlist: [
      { path: 'docs/missing.md', reason: REASON },
      { path: 'docs/clean.md', reason: REASON },
      { path: 'CHANGELOG.md', frozenFrom: '^## v\\d', reason: REASON },
    ],
  });

  const result = run(cwd);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(
    result.stderr.includes('docs/missing.md: names no tracked file'),
    result.stderr,
  );
  assert.ok(
    result.stderr.includes('docs/clean.md: excuses no occurrence'),
    result.stderr,
  );
  assert.ok(
    result.stderr.includes('CHANGELOG.md: "frozenFrom" matches no line'),
    result.stderr,
  );
  assert.doesNotMatch(result.stderr, /still use the old product spelling/);
});

test('exits 2 when an allowlist entry carries no reason', (t) => {
  const cwd = createRepo(t, {
    files: { 'docs/clean.md': `Uses ${NEW}.\n` },
    allowlist: [{ path: 'docs/clean.md' }],
  });

  const result = run(cwd);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /docs\/clean\.md\) has no written "reason"/);
});

test('exits 2 when the allowlist file is missing', (t) => {
  const cwd = createRepo(t, {
    files: { 'docs/clean.md': `Uses ${NEW}.\n` },
  });

  const result = run(cwd);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /tools\/config\/product-name-allowlist\.json not found/,
  );
});

// Each allowlist fault is read before any file is scanned, so the check exits 2 with the
// named message and reports no finding.
const ALLOWLIST_FAULTS = [
  {
    name: 'puts frozenFrom on a directory entry',
    allowlist: [
      { path: 'docs/research/', frozenFrom: '^## v\\d', reason: REASON },
    ],
    stderr: /entry 0 \(docs\/research\/\) puts "frozenFrom" on a directory/,
  },
  {
    name: 'carries an invalid frozenFrom regex',
    allowlist: [{ path: 'CHANGELOG.md', frozenFrom: '(', reason: REASON }],
    stderr: /entry 0 \(CHANGELOG\.md\) has an invalid "frozenFrom"/,
  },
  {
    name: 'is not valid JSON',
    allowlistText: '{ "allowlist": [',
    stderr: /is not valid JSON/,
  },
  {
    name: 'has no allowlist array',
    allowlistText: JSON.stringify({ schemaVersion: 1 }),
    stderr: /has no "allowlist" array/,
  },
  {
    name: 'has an entry with no path',
    allowlist: [{ reason: REASON }],
    stderr: /entry 0 has no "path"/,
  },
];

for (const fault of ALLOWLIST_FAULTS) {
  test(`exits 2 when the allowlist ${fault.name}`, (t) => {
    const cwd = createRepo(t, {
      files: { 'docs/clean.md': `Uses ${NEW}.\n` },
      allowlist: fault.allowlist,
      allowlistText: fault.allowlistText,
    });

    const result = run(cwd);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, fault.stderr);
    assert.doesNotMatch(result.stdout, /product-name: OK/);
  });
}

test('passes a clean tree and reports the counts', (t) => {
  const cwd = createRepo(t, {
    files: {
      'docs/clean.md': `Uses ${NEW}.\n`,
      'docs/research/brief.md': `Quoted as ${OLD}.\n`,
    },
    allowlist: [{ path: 'docs/research/', reason: REASON }],
  });

  const result = run(cwd);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /product-name: OK — 3 tracked file\(s\) checked, 1 allowlisted path\(s\)/,
  );
});

test('exits 2 when the directory is not a git repository', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'product-name-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'notes.md'), `Uses ${NEW}.\n`);

  const result = run(cwd);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /git ls-files failed/);
  assert.doesNotMatch(result.stdout, /product-name: OK/);
});

// A tracked file with a NUL byte is binary and is skipped, even when the old spelling is in it.
test('skips a tracked binary file that contains the old spelling', (t) => {
  const cwd = createRepo(t, {
    files: { 'assets/logo.bin': `\0${OLD}\0` },
    allowlist: [],
  });

  const result = run(cwd);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /product-name: OK/);
});

test('an allowlisted directory excuses a file whose own path contains the old spelling', (t) => {
  const path = `docs/research/${OLD}-brief.md`;
  const cwd = createRepo(t, {
    files: { [path]: `Quoted as ${OLD}.\n` },
    allowlist: [{ path: 'docs/research/', reason: REASON }],
  });

  const result = run(cwd);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /the path itself/);
});

test('ignores an untracked file that contains the old spelling', (t) => {
  const cwd = createRepo(t, {
    files: { 'docs/clean.md': `Uses ${NEW}.\n` },
    allowlist: [],
    untracked: { 'docs/stray.md': `Stray ${OLD}.\n` },
  });

  const result = run(cwd);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /product-name: OK — 2 tracked file\(s\) checked, 0 allowlisted path\(s\)/,
  );
});
