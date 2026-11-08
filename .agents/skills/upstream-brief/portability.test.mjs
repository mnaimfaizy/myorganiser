/**
 * The skill is portable (DESIGN.md, Boundary): this folder, copied alone into
 * any repository, is the whole skill. This suite proves it, and it is the
 * suite that fails first when a change ties the skill to the repository it
 * happens to live in.
 *
 *   1. STATIC. No script imports anything but a Node built-in or a file in
 *      this folder. No document links outside this folder. No shipped file
 *      (fixtures and tests aside) names a host's decision log, script tree,
 *      or package scripts.
 *   2. COPIED. The folder is copied, alone, into an empty temporary
 *      repository at `.claude/skills/upstream-brief/` — a different layout
 *      from the one it lives in here — and its own suites run there.
 *   3. SMOKE. Every command runs in that repository, with a minimal adapter
 *      and install tree, and prints what it should.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = 'portability.test.mjs';

const shipped = readdirSync(HERE, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name);
const scripts = shipped.filter((name) => name.endsWith('.mjs'));
const documents = shipped.filter((name) => name.endsWith('.md'));
const read = (name) => readFileSync(join(HERE, name), 'utf8');

// ── 1. Static ───────────────────────────────────────────────────────────────

const IMPORT =
  /^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;

test('every import is a Node built-in or a file in this folder', () => {
  const builtins = new Set(builtinModules);
  for (const name of scripts)
    for (const match of read(name).matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2];
      const local = /^\.\/[^/]+\.mjs$/.test(specifier);
      const builtin =
        specifier.startsWith('node:') || builtins.has(specifier.split('/')[0]);
      assert.ok(
        local || builtin,
        `${name} imports ${specifier}, which a copy of this folder does not carry`,
      );
    }
});

test('no document links outside this folder', () => {
  for (const name of documents)
    for (const [, target] of read(name).matchAll(
      /\]\(([^)#]+)(?:#[^)]*)?\)/g,
    )) {
      if (/^[a-z]+:\/\//.test(target)) continue;
      assert.ok(
        !target.includes('/') && shipped.includes(target),
        `${name} links ${target}, which a copy of this folder does not carry`,
      );
    }
});

/** What only the repository this folder came from would understand. */
const HOST_ONLY = [
  [/\bADR \d{4}\b/, "a host's decision record (cite DESIGN.md instead)"],
  [/docs\/adr\//, "a host's decision-record directory"],
  [/tools\/scripts\//, "a host's script tree"],
  [/\byarn [a-z]+:[a-z:]+/, "a host's package script"],
];

test('no shipped file names something only its current host has', () => {
  for (const name of shipped) {
    if (name.endsWith('.test.mjs')) continue;
    const text = read(name);
    for (const [pattern, what] of HOST_ONLY)
      assert.doesNotMatch(text, pattern, `${name} names ${what}`);
  }
});

// ── 2 and 3. Copied, and run ────────────────────────────────────────────────

let repo;
let skill;

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'upstream-brief-portable-'));
  skill = join(repo, '.claude', 'skills', 'upstream-brief');
  mkdirSync(dirname(skill), { recursive: true });
  cpSync(HERE, skill, { recursive: true });

  writeFileSync(
    join(repo, 'upstream-brief.config.yml'),
    ['ecosystems:', '  - lead: nx', 'brief_dir: docs/briefs', ''].join('\n'),
  );
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ devDependencies: { nx: '22.7.7' } }),
  );
  for (const [name, version] of [
    ['nx', '22.7.7'],
    ['@nx/js', '22.7.7'],
  ]) {
    const dir = join(repo, 'node_modules', ...name.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
  }
  spawnSync('git', ['init', '--quiet'], { cwd: repo });
});

after(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

const run = (file, args = []) =>
  spawnSync(process.execPath, [join(skill, file), ...args], {
    cwd: repo,
    encoding: 'utf8',
  });

test('the copied folder passes its own suites', () => {
  const suites = readdirSync(skill).filter(
    (name) => name.endsWith('.test.mjs') && name !== SELF,
  );
  const result = spawnSync(
    process.execPath,
    ['--test', ...suites.map((name) => join(skill, name))],
    { cwd: repo, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stdout.slice(-2000) + result.stderr);
});

test('resolve-baseline reads the adapter and the install tree of its new home', () => {
  const result = run('resolve-baseline.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /nx — Baseline 22\.7\.7, 2 member\(s\): @nx\/js, nx/,
  );
});

test('resolve-ledger, check-reports, and suggest-run run with no brief yet', () => {
  const ledger = run('resolve-ledger.mjs');
  assert.equal(ledger.status, 0, ledger.stderr);
  assert.match(
    ledger.stdout,
    /first run at Baseline 22\.7\.7 researches everything/,
  );

  const gate = run('check-reports.mjs', ['--print']);
  assert.equal(gate.status, 0, gate.stderr);
  assert.match(gate.stdout, /brief directory is docs\/briefs/);
  assert.match(gate.stdout, /docs\/briefs does not exist/);

  const suggest = run('suggest-run.mjs');
  assert.equal(suggest.status, 0, suggest.stderr);
  assert.equal(suggest.stdout, '');
});

test('validate-report runs, and refuses no input with its usage', () => {
  const result = run('validate-report.mjs');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: validate-report\.mjs/);
});
