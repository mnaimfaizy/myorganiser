/**
 * Contract suite for check-adr-status.ts (ADR 0085: the header is the
 * specification, this is what makes it true).
 *
 * The header claims one direction — no ADR's status slot reads `proposed`, in
 * either the `## Status` section form or the YAML frontmatter form — and
 * explicitly omits two others. Both halves are proved here: the claimed
 * direction fails on drift, and the omitted directions pass, so a later reader
 * can tell a deliberate omission from a bug.
 *
 * Every assertion below was mutation-checked: blinding the frontmatter reader,
 * dropping case folding, and removing the section heading guard were each
 * applied to the checker and each turned a test red.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { statusFromSection } from './check-adr-status.ts';

const CHECKER = resolve('tools/scripts/check-adr-status.ts');

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'adr-status-'));
  mkdirSync(join(dir, 'docs/adr'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, 'docs/adr', name), body);
  }
  return dir;
}

function run(dir: string) {
  return spawnSync(process.execPath, [CHECKER], { cwd: dir, encoding: 'utf8' });
}

function withWorkspace<T>(
  files: Record<string, string>,
  fn: (dir: string) => T,
): T {
  const dir = workspace(files);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- asserted

test('fails on a ## Status section reading proposed', () => {
  withWorkspace(
    { '0001-a.md': '# A\n\n## Status\n\nproposed\n\n## Context\n\nx\n' },
    (dir) => {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /0001-a\.md/);
      assert.match(r.stderr, /## Status section/);
    },
  );
});

test('fails on frontmatter status: proposed', () => {
  // Load-bearing: 6 ADRs use this form. A checker that knew only the section
  // form would pass this file by not looking at it. Mutation-checked.
  withWorkspace(
    { '0002-b.md': '---\nstatus: proposed\n---\n\n# B\n\nbody\n' },
    (dir) => {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /0002-b\.md/);
      assert.match(r.stderr, /frontmatter status:/);
    },
  );
});

test('fails regardless of case', () => {
  withWorkspace({ '0003-c.md': '# C\n\n## Status\n\nProposed\n' }, (dir) => {
    assert.equal(run(dir).status, 1);
  });
});

test('reports every offender, not just the first', () => {
  withWorkspace(
    {
      '0004-d.md': '# D\n\n## Status\n\nproposed\n',
      '0005-e.md': '# E\n\n## Status\n\nproposed\n',
      '0006-f.md': '# F\n\n## Status\n\naccepted\n',
    },
    (dir) => {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /0004-d\.md/);
      assert.match(r.stderr, /0005-e\.md/);
      assert.doesNotMatch(r.stderr, /0006-f\.md/);
    },
  );
});

test('passes on accepted and on superseded', () => {
  withWorkspace(
    {
      '0007-g.md': '# G\n\n## Status\n\naccepted\n',
      '0008-h.md': '# H\n\n## Status\n\nsuperseded by [ADR 0009](0009-i.md)\n',
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
});

// ---------------------------------------------- deliberately not asserted

test('an ADR carrying no status at all passes', () => {
  // 13 ADRs in the corpus carry none; the header omits this direction on
  // purpose. If this starts failing, the omission has been broken.
  withWorkspace({ '0010-j.md': '# J\n\nA one paragraph decision.\n' }, (dir) =>
    assert.equal(run(dir).status, 0),
  );
});

test('an unrecognised status value passes', () => {
  withWorkspace({ '0011-k.md': '# K\n\n## Status\n\ndraft\n' }, (dir) =>
    assert.equal(run(dir).status, 0),
  );
});

// ------------------------------------------------------- slot, not substring

test('the word proposed in prose is not a status', () => {
  // The reason this reads the status slot instead of grepping the file: every
  // ADR with a Considered Options section discusses proposals.
  withWorkspace(
    {
      '0012-l.md':
        '# L\n\n## Status\n\naccepted\n\n## Considered Options\n\n' +
        'The coupling gate as proposed - rejected. proposed\n',
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
});

test('an empty Status section parses as no status, not as the next heading', () => {
  // Asserted against the parser rather than the exit code on purpose. Through
  // the exit code this is unobservable: dropping the heading guard makes the
  // parser return '## Context', which is wrong but still is not 'proposed', so
  // a spawn-and-check-status test stays green against a broken parser. That was
  // proved by mutation, and is why this one test reaches past the process
  // boundary the others use.
  assert.equal(
    statusFromSection('# M\n\n## Status\n\n## Context\n\nproposed\n'),
    null,
  );
  assert.equal(statusFromSection('# M\n\n## Status\n\naccepted\n'), 'accepted');
});

test('a status: line in a prose table is not the ADR status', () => {
  // ADR 0002 carries a `status:in-progress` label glossary.
  withWorkspace(
    {
      '0014-n.md':
        '# N\n\n| Label | Meaning |\n| --- | --- |\n' +
        '| `status: proposed` | not this ADR |\n',
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
});

test('non-ADR files in the directory are ignored', () => {
  withWorkspace(
    {
      'README.md': '## Status\n\nproposed\n',
      '0015-o.md': '# O\n\n## Status\n\naccepted\n',
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
});

// ------------------------------------------------------------- cannot run

test('exits 2 when docs/adr is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adr-status-'));
  try {
    const r = run(dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /does not exist/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------- replay

test('the real corpus passes', () => {
  const r = spawnSync(process.execPath, [CHECKER], {
    cwd: resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
});
