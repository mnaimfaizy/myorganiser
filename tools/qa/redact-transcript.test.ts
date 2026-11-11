// Contracts for redact-transcript.ts's command-line surface (ADR 0147 decision 7).
// The redaction rules are covered in ./lib/redact-transcript.test.ts; these tests
// run the real script as a subprocess and pin its exit codes and its streams:
// 0 = rendered, 1 = refused (an unknown field), 2 = could not render (bad
// invocation, unreadable or malformed input).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'redact-transcript.ts');
const USAGE =
  'usage: node tools/qa/redact-transcript.ts --input <file.json | ->';

// Synthetic sentinels, kept at 15 characters or fewer (see the lib suite).
const CREDENTIAL = 'synth-cred-001';
const MYSTERY = 'mystery-val-01';

const RENDERABLE = {
  scenarios: [
    {
      id: 'S1',
      calls: [
        {
          side: 'after',
          request: { method: 'GET', path: '/api/tasks' },
          response: {
            status: 200,
            body: { items: [{ id: 't1', title: 'Pay rent' }], total: 1 },
          },
        },
      ],
    },
  ],
};

const SECRETS_AND_CIPHERTEXT = {
  scenarios: [
    {
      id: 'S1',
      calls: [
        {
          side: 'after',
          request: {
            method: 'POST',
            path: '/api/login',
            headers: { Authorization: CREDENTIAL },
            body: { password: CREDENTIAL, ciphertext: 'abcdefghijklmnop' },
          },
          response: { status: 200, body: { accessToken: CREDENTIAL } },
        },
      ],
    },
  ],
};

const REFUSED = {
  scenarios: [
    {
      id: 'S1',
      calls: [
        {
          side: 'after',
          request: { method: 'GET', path: '/api/tasks' },
          response: {
            status: 200,
            body: { items: [{ id: 't1', mystery: MYSTERY }] },
          },
        },
      ],
    },
  ],
};

function runCli(args: string[], stdin?: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    input: stdin,
  });
}

function runWithStdin(input: unknown) {
  return runCli(['--input', '-'], JSON.stringify(input));
}

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'redact-transcript-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('exit 0 with a collapsed Request Transcript on stdin', () => {
  const result = runWithStdin(RENDERABLE);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(
    result.stdout,
    /^<details>\n<summary>Request Transcript<\/summary>\n\n#### S1\n\n\*\*After\*\*\n/,
  );
  assert.ok(result.stdout.endsWith('</details>\n'));
});

test('--input <file> renders the same as stdin', (t) => {
  const path = join(tempDir(t), 'transcript.json');
  writeFileSync(path, JSON.stringify(RENDERABLE));
  const fromFile = runCli(['--input', path]);
  const fromStdin = runWithStdin(RENDERABLE);
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.equal(fromFile.stdout, fromStdin.stdout);
});

test('withheld and ciphertext values are redacted in stdout, and the raw credential never appears', () => {
  const result = runWithStdin(SECRETS_AND_CIPHERTEXT);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[withheld\]/);
  assert.ok(result.stdout.includes('abcd…[ciphertext, 16 chars]'));
  assert.ok(!result.stdout.includes(CREDENTIAL));
  assert.ok(!result.stdout.includes('ijklmnop'));
});

test('a credential parameter inside a path is withheld in stdout, and its value never appears', () => {
  const input = {
    scenarios: [
      {
        id: 'S1',
        calls: [
          {
            side: 'after',
            request: { method: 'GET', path: '/api/x?token=synth-001' },
            response: { status: 200 },
          },
        ],
      },
    ],
  };
  const result = runWithStdin(input);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('"path": "[withheld]"'));
  assert.ok(!result.stdout.includes('synth-001'));
});

test('a bare credential parameter in a query string is withheld in stdout, and its value never appears', () => {
  const input = {
    scenarios: [
      {
        id: 'S1',
        calls: [
          {
            side: 'after',
            request: {
              method: 'GET',
              path: '/api/x',
              query: 'token=synth-005',
            },
            response: { status: 200 },
          },
        ],
      },
    ],
  };
  const result = runWithStdin(input);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('"query": "[withheld]"'));
  assert.ok(!result.stdout.includes('synth-005'));
});

test('a transcript whose output is larger than a pipe buffer is written in full', () => {
  const big = {
    scenarios: [
      {
        id: 'S1',
        calls: [
          {
            side: 'after',
            request: {
              method: 'POST',
              path: '/api/tasks',
              body: { description: 'x'.repeat(300_000) },
            },
            response: { status: 201 },
          },
        ],
      },
    ],
  };
  const result = runWithStdin(big);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.length > 300_000);
  assert.ok(result.stdout.endsWith('</details>\n'));
});

test('exit 1 with nothing on stdout when a field is unknown, and stderr names the path but not the value', () => {
  const result = runWithStdin(REFUSED);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /qa:redact: refused - 1 field\(s\)/);
  assert.ok(
    result.stderr.includes(
      '  - scenarios[0].calls[0].response.body.items[0].mystery',
    ),
  );
  assert.ok(!result.stderr.includes(MYSTERY));
});

test('exit 2 with usage when --input is missing', () => {
  const result = runCli([]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), `qa:redact: ${USAGE}`);
});

test('exit 2 with usage when --input has no value', () => {
  const result = runCli(['--input']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), `qa:redact: ${USAGE}`);
});

test('exit 2 with usage for an unknown extra argument', () => {
  const result = runCli(
    ['--input', '-', '--verbose'],
    JSON.stringify(RENDERABLE),
  );
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), `qa:redact: ${USAGE}`);
});

test('exit 2 when the input file cannot be read', (t) => {
  const path = join(tempDir(t), 'missing.json');
  const result = runCli(['--input', path]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), `qa:redact: cannot read input "${path}"`);
});

test('exit 2 when stdin is not valid JSON', () => {
  const result = runCli(['--input', '-'], '{not json');
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'qa:redact: input is not valid JSON');
});

test('exit 2 and names the call when the input has a bad shape', () => {
  const result = runWithStdin({
    scenarios: [
      { id: 'S1', calls: [{ side: 'during', request: {}, response: {} }] },
    ],
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr.trim(),
    'qa:redact: scenarios[0].calls[0] needs a "side" of before or after, a "request" and a "response"',
  );
});

test('exit 2 when the input has no scenarios array', () => {
  const result = runWithStdin({ calls: [] });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr.trim(),
    'qa:redact: input needs a "scenarios" array',
  );
});

test('--help exits 0 and prints the usage line on stdout', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), USAGE);
});

test('-h behaves like --help', () => {
  const result = runCli(['-h']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), USAGE);
});
