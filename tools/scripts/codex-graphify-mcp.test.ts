import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { graphifyIndexPath } from './codex-graphify-mcp.ts';
import { isolateGitEnvironment } from './lib/git-environment.ts';

isolateGitEnvironment();

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

test('Graphify resolves the primary checkout from a linked worktree', (t) => {
  const primary = mkdtempSync(join(tmpdir(), 'codex graphify '));
  t.after(() => rmSync(primary, { recursive: true, force: true }));

  git(primary, 'init', '--quiet');
  git(
    primary,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.com',
    '-c',
    'core.hooksPath=.git/hooks',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'base',
  );
  const linked = join(primary, 'linked checkout');
  git(primary, 'worktree', 'add', '--quiet', '--detach', linked);

  const expected = join(primary, 'graphify-out', 'graph.json');
  const fromLinked = graphifyIndexPath(linked);
  assert.equal(existsSync(fromLinked), false);
  mkdirSync(dirname(expected));
  writeFileSync(expected, 'fixture index');
  assert.equal(readFileSync(fromLinked, 'utf8'), 'fixture index');
  assert.equal(graphifyIndexPath(primary), fromLinked);
});

test('explicit-only shared Skills carry Codex invocation policy', () => {
  const skillsRoot = new URL('../../.agents/skills/', import.meta.url);
  const explicitSkills = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((skill) => skill.isDirectory())
    .map((skill) => skill.name)
    .filter((name) => {
      const source = new URL(`${name}/SKILL.md`, skillsRoot);
      return (
        existsSync(source) &&
        /^disable-model-invocation: true\r?$/m.test(
          readFileSync(source, 'utf8').split('---', 2)[1] ?? '',
        )
      );
    });

  for (const name of ['implement', 'orchestrate']) {
    assert.ok(
      explicitSkills.includes(name),
      `${name} must require explicit invocation`,
    );
  }
  for (const name of explicitSkills) {
    const metadata = readFileSync(
      new URL(`${name}/agents/openai.yaml`, skillsRoot),
      'utf8',
    );
    assert.match(
      metadata,
      /^policy:\r?\n {2}allow_implicit_invocation: false\r?$/m,
      name,
    );
  }
});

test('Windows setup installs the locked dependencies and actions call the repo scripts', () => {
  const environment = readFileSync(
    new URL('../../.codex/environments/environment.toml', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  const { scripts } = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  const [setup, ...actions] = environment.split('[[actions]]');

  assert.match(
    setup,
    /\[setup\.win32\]\nscript = '''\ncorepack yarn install --immutable\nexit \$LASTEXITCODE\n'''/,
  );
  assert.equal(actions.length, 2);
  for (const [index, script] of ['start:backend', 'start:web'].entries()) {
    assert.equal(typeof scripts[script], 'string');
    assert.ok(
      actions[index]
        .split('\n')
        .includes(`command = "corepack yarn ${script}"`),
    );
    assert.ok(actions[index].split('\n').includes('platform = "win32"'));
  }
});
