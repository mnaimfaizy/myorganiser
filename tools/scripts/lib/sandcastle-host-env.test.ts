import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertNoForwardedEnvFile,
  credentialSources,
  loadHostEnv,
  opBinary,
  parseDotenv,
  readOpEnvironment,
  resolveOpEnvironmentId,
} from './sandcastle-host-env.ts';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const read = (path: string): string =>
  readFileSync(join(REPO_ROOT, path), 'utf8');

// ── parseDotenv ───────────────────────────────────────────────────────────────

test('parseDotenv reads KEY=value lines, skipping comments and blanks', () => {
  assert.deepEqual(
    parseDotenv(
      '# note\n\nA=1\n  B = two \nC="quoted"\nD=\'single\'\nnonsense\n',
    ),
    { A: '1', B: 'two', C: 'quoted', D: 'single' },
  );
});

test('parseDotenv drops a leading `export`, so a refusal names the real key', () => {
  assert.deepEqual(parseDotenv('export CURSOR_API_KEY=x\n'), {
    CURSOR_API_KEY: 'x',
  });
});

test('parseDotenv keeps an empty value as an empty string', () => {
  assert.deepEqual(parseDotenv('A=\n'), { A: '' });
});

// ── refusal of a forwarded env file ───────────────────────────────────────────

test('an absent forwarded env file is fine', () => {
  assert.doesNotThrow(() => assertNoForwardedEnvFile(null));
});

test('a forwarded env file with only comments and blanks is fine', () => {
  assert.doesNotThrow(() => assertNoForwardedEnvFile('# nothing\n\n'));
});

test('a forwarded env file holding a key refuses, naming the keys but never a value', () => {
  assert.throws(
    () =>
      assertNoForwardedEnvFile('CURSOR_API_KEY=super-secret\nGH_TOKEN=also\n'),
    (error: Error) => {
      assert.match(error.message, /CURSOR_API_KEY/);
      assert.match(error.message, /GH_TOKEN/);
      assert.match(error.message, /secrets\.env/);
      assert.ok(!error.message.includes('super-secret'));
      assert.ok(!error.message.includes('also'));
      return true;
    },
  );
});

test('a forwarded env file with an empty value still refuses: Sandcastle falls back to the shell', () => {
  assert.throws(
    () => assertNoForwardedEnvFile('GITHUB_TOKEN=\n'),
    /GITHUB_TOKEN/,
  );
});

// ── 1Password Environment id ──────────────────────────────────────────────────

test('the Environment id comes from the secrets file when the shell has none', () => {
  assert.equal(
    resolveOpEnvironmentId({}, { OP_ENVIRONMENT_ID: 'from-file' }),
    'from-file',
  );
});

test('the shell value of the Environment id wins over the file', () => {
  assert.equal(
    resolveOpEnvironmentId(
      { OP_ENVIRONMENT_ID: 'from-shell' },
      { OP_ENVIRONMENT_ID: 'from-file' },
    ),
    'from-shell',
  );
});

test('an empty or blank Environment id means none', () => {
  assert.equal(
    resolveOpEnvironmentId({ OP_ENVIRONMENT_ID: '  ' }, {}),
    undefined,
  );
});

// ── op binary and reading the Environment ─────────────────────────────────────

test('OP_CLI overrides the binary; WSL uses op.exe unless a service account is set', () => {
  assert.equal(opBinary({ OP_CLI: '/x/op' }, true), '/x/op');
  assert.equal(opBinary({}, true), 'op.exe');
  assert.equal(opBinary({ OP_SERVICE_ACCOUNT_TOKEN: 't' }, true), 'op');
  assert.equal(opBinary({}, false), 'op');
});

test('readOpEnvironment parses the dotenv text `op environment read` prints', () => {
  const calls: string[][] = [];
  const result = readOpEnvironment('env-id', {}, (bin, args) => {
    calls.push([bin, ...args]);
    return 'CURSOR_API_KEY=abc\n# c\nSANDCASTLE_AGENT="cursor"\n';
  });
  assert.deepEqual(result, {
    CURSOR_API_KEY: 'abc',
    SANDCASTLE_AGENT: 'cursor',
  });
  assert.deepEqual(calls, [['op', 'environment', 'read', 'env-id']]);
});

test('readOpEnvironment falls back to `secret list` on a CLI without `read`', () => {
  const calls: string[][] = [];
  const result = readOpEnvironment('env-id', {}, (bin, args) => {
    calls.push(args);
    if (args[1] === 'read') {
      throw Object.assign(new Error('x'), { stderr: 'unknown command "read"' });
    }
    return 'A=1\n';
  });
  assert.deepEqual(result, { A: '1' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], [
    'environment',
    'secret',
    'list',
    'env-id',
    '--reveal',
    '--format=dotenv',
  ]);
});

test('readOpEnvironment fails loudly, naming the id and never leaking output', () => {
  assert.throws(
    () =>
      readOpEnvironment('env-id', {}, () => {
        throw Object.assign(new Error('boom'), {
          stderr: 'could not connect to the 1Password desktop app',
        });
      }),
    (error: Error) => {
      assert.match(error.message, /env-id/);
      assert.match(error.message, /1Password/);
      return true;
    },
  );
});

test('an Environment id that could read as a flag is refused before op runs', () => {
  for (const id of ['--help', '-x', 'a b', 'a;b', '']) {
    let ran = false;
    assert.throws(
      () =>
        readOpEnvironment(id, {}, () => {
          ran = true;
          return '';
        }),
      /OP_ENVIRONMENT_ID/,
    );
    assert.equal(ran, false, id);
  }
});

test('a missing op binary says so and names OP_CLI', () => {
  assert.throws(
    () =>
      readOpEnvironment('env-id', {}, () => {
        throw Object.assign(new Error('spawn op ENOENT'), { code: 'ENOENT' });
      }),
    /OP_CLI/,
  );
});

// ── source order ──────────────────────────────────────────────────────────────

function load({
  secrets = null,
  shell = {},
  op = {},
  forwarded = null,
}: {
  secrets?: string | null;
  shell?: Record<string, string | undefined>;
  op?: Record<string, string>;
  forwarded?: string | null;
}) {
  return loadHostEnv({
    sandcastleDir: '/repo/.sandcastle',
    shell,
    readText: (path) =>
      path.endsWith('secrets.env')
        ? secrets
        : path.endsWith('.env')
          ? forwarded
          : null,
    readEnvironment: () => op,
  });
}

test('with no Environment, the shell beats the secrets file', () => {
  const { env } = load({
    secrets: 'CURSOR_API_KEY=file\nSANDCASTLE_AGENT=file\n',
    shell: { CURSOR_API_KEY: 'shell' },
  });
  assert.equal(env.CURSOR_API_KEY, 'shell');
  assert.equal(env.SANDCASTLE_AGENT, 'file');
});

test('the Environment beats the shell and the file', () => {
  const { env } = load({
    secrets: 'OP_ENVIRONMENT_ID=id\nCURSOR_API_KEY=file\n',
    shell: { CURSOR_API_KEY: 'shell' },
    op: { CURSOR_API_KEY: 'op' },
  });
  assert.equal(env.CURSOR_API_KEY, 'op');
});

test('the Environment is read when its id is only in the secrets file', () => {
  const { env, sources } = load({
    secrets: 'OP_ENVIRONMENT_ID=id-from-file\n',
    op: { CURSOR_API_KEY: 'op' },
  });
  assert.equal(env.CURSOR_API_KEY, 'op');
  assert.match(sources, /1Password Environment id-from-file/);
});

test('the Environment is not read, and nothing is run, without an id', () => {
  let called = false;
  const { env } = loadHostEnv({
    sandcastleDir: '/repo/.sandcastle',
    shell: { CURSOR_API_KEY: 'shell' },
    readText: () => null,
    readEnvironment: () => {
      called = true;
      return {};
    },
  });
  assert.equal(called, false);
  assert.equal(env.CURSOR_API_KEY, 'shell');
});

test('an empty Environment value does not shadow a lower source', () => {
  const { env } = load({
    secrets: 'OP_ENVIRONMENT_ID=id\n',
    shell: { CURSOR_API_KEY: 'shell' },
    op: { CURSOR_API_KEY: '' },
  });
  assert.equal(env.CURSOR_API_KEY, 'shell');
});

test('loading refuses before reading any Environment when the forwarded file holds a key', () => {
  let called = false;
  assert.throws(
    () =>
      loadHostEnv({
        sandcastleDir: '/repo/.sandcastle',
        shell: { OP_ENVIRONMENT_ID: 'id' },
        readText: (path) => (path.endsWith('secrets.env') ? null : 'A=1\n'),
        readEnvironment: () => {
          called = true;
          return {};
        },
      }),
    /secrets\.env/,
  );
  assert.equal(called, false);
});

test('an Environment failure propagates instead of falling through to the shell', () => {
  assert.throws(
    () =>
      loadHostEnv({
        sandcastleDir: '/repo/.sandcastle',
        shell: { OP_ENVIRONMENT_ID: 'id', CURSOR_API_KEY: 'shell' },
        readText: () => null,
        readEnvironment: () => {
          throw new Error('Could not read 1Password Environment id');
        },
      }),
    /Could not read 1Password Environment/,
  );
});

test('the run header lists the sources without any value', () => {
  assert.equal(
    credentialSources({
      environmentId: 'abc',
      opBin: 'op',
      secretsFile: true,
    }),
    '1Password Environment abc via op > shell > .sandcastle/secrets.env',
  );
  assert.equal(
    credentialSources({
      environmentId: undefined,
      opBin: 'op',
      secretsFile: false,
    }),
    'shell',
  );
});

// ── wiring (the facts the behaviour depends on) ───────────────────────────────

for (const entry of [
  '.sandcastle/main.mts',
  '.sandcastle/dispatch-waves.mts',
]) {
  test(`${entry} loads host credentials through the host-env module and never through dotenv`, () => {
    const source = read(entry);
    assert.match(source, /sandcastle-host-env\.ts/);
    assert.match(source, /loadHostEnv\(/);
    assert.doesNotMatch(source, /from 'dotenv'/);
    assert.doesNotMatch(source, /dotenv\.config/);
  });
}

test('the 1Password wrapper scripts are gone: one route reads the Environment', () => {
  const scripts = JSON.parse(read('package.json')).scripts as Record<
    string,
    string
  >;
  assert.equal(scripts['dispatch-agents:1password'], undefined);
  assert.equal(scripts['dispatch-waves:1password'], undefined);
});

test('the committed example is secrets.env.example, with no GitHub token and no forwarded-file advice', () => {
  const example = read('.sandcastle/secrets.env.example');
  assert.doesNotMatch(example, /^\s*#?\s*GH_TOKEN=/m);
  assert.doesNotMatch(example, /^\s*#?\s*GITHUB_TOKEN=/m);
  assert.match(example, /OP_ENVIRONMENT_ID=/);
  assert.match(example, /COPILOT_GITHUB_TOKEN=/);
  assert.match(example, /Copilot Requests/);
});

test('secrets.env is gitignored', () => {
  assert.match(read('.gitignore'), /^\.sandcastle\/secrets\.env$/m);
});
