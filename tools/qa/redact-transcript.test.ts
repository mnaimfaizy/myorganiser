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

/** A transcript holding one After call with the given request and a 200 response. */
function transcriptWithRequest(request: object) {
  return {
    scenarios: [
      {
        id: 'S1',
        calls: [{ side: 'after', request, response: { status: 200 } }],
      },
    ],
  };
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

test('a credential parameter inside a path is withheld in stdout, the safe parameter beside it is kept, and its value never appears', () => {
  const input = {
    scenarios: [
      {
        id: 'S1',
        calls: [
          {
            side: 'after',
            request: { method: 'GET', path: '/api/x?page=2&token=synth-001' },
            response: { status: 200 },
          },
        ],
      },
    ],
  };
  const result = runWithStdin(input);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('"path": "/api/x?page=2&token=[withheld]"'));
  assert.ok(!result.stdout.includes('synth-001'));
});

test('a credential parameter in a query string is withheld in stdout, the safe parameter beside it is kept, and its value never appears', () => {
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
              query: 'page=2&token=synth-005',
            },
            response: { status: 200 },
          },
        ],
      },
    ],
  };
  const result = runWithStdin(input);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('"query": "page=2&token=[withheld]"'));
  assert.ok(!result.stdout.includes('synth-005'));
});

for (const { form, query, expected, sentinel } of [
  {
    form: '%3B',
    query: 'page=2%3Btoken=SYNTH-E03',
    expected: 'page=2;token=[withheld]',
    sentinel: 'SYNTH-E03',
  },
  {
    form: '%3D',
    query: 'page=2&token%3DSYNTH-E04',
    expected: 'page=2&token=[withheld]',
    sentinel: 'SYNTH-E04',
  },
  {
    form: '%2526',
    query: 'page=2%2526token=SYNTH-E05',
    expected: 'page=2&token=[withheld]',
    sentinel: 'SYNTH-E05',
  },
]) {
  test(`exit 0 with the encoded credential parameter (${form}) withheld in stdout, and its value absent`, () => {
    const result = runWithStdin(
      transcriptWithRequest({ method: 'GET', path: '/api/x', query }),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes(`"query": "${expected}"`));
    assert.ok(!result.stdout.includes(sentinel));
  });
}

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
  assert.match(
    result.stderr,
    /qa:redact: refused - 1 problem\(s\), each named by position \(a field or parameter not recognised as safe, an @ in a URL, or a URL that will not finish decoding\):/,
  );
  assert.ok(
    result.stderr.includes(
      '  - scenarios[0].calls[0].response.body.items[0] key #2',
    ),
  );
  assert.ok(!result.stderr.includes(MYSTERY));
});

test('exit 1 with nothing on stdout when an encoded parameter name is unknown, and stderr names its position but not the name or value', () => {
  const result = runWithStdin(
    transcriptWithRequest({
      method: 'GET',
      path: '/api/x?page=2%26zzz%3DSYNTH-E06',
    }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(
    result.stderr.includes(
      '  - scenarios[0].calls[0].request.path parameter #2',
    ),
  );
  assert.ok(!result.stderr.includes('SYNTH-E06'));
});

test('exit 1 with nothing on stdout when a string does not finish decoding, and stderr holds no part of its value', () => {
  let layered = 'token=SYNTH-E07';
  for (let level = 0; level < 7; level++) {
    layered = encodeURIComponent(layered);
  }
  const result = runWithStdin(
    transcriptWithRequest({ method: 'GET', path: `/api/x?${layered}` }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(
    result.stderr.includes(
      'scenarios[0].calls[0].request.path (does not finish decoding)',
    ),
  );
  assert.ok(!result.stderr.includes('SYNTH-E07'));
});

test('exit 1 and stderr print key #n for an opaque JSON key, never the key', () => {
  const result = runWithStdin(
    transcriptWithRequest({
      method: 'GET',
      path: '/api/x',
      body: { 'Xk9+Opaque': 1 },
    }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(
    result.stderr.includes('  - scenarios[0].calls[0].request.body key #1'),
  );
  assert.ok(!result.stderr.includes('Xk9'));
  assert.ok(!result.stderr.includes('Opaque'));
});

test('exit 0 with a raw second = withheld in stdout, and its value absent', () => {
  const result = runWithStdin(
    transcriptWithRequest({ method: 'GET', path: '/x?page=token=SYNTH-E08' }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('"path": "/x?[withheld]"'));
  assert.ok(!result.stdout.includes('SYNTH-E08'));
});

test('exit 0 with an encoded second = (%3D) withheld in stdout, and its value absent', () => {
  const result = runWithStdin(
    transcriptWithRequest({ method: 'GET', path: '/x?page%3Dtoken=SYNTH-E09' }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('"path": "/x?[withheld]"'));
  assert.ok(!result.stdout.includes('SYNTH-E09'));
});

test('exit 1 with nothing on stdout when a second = leaves an unknown name, and stderr holds no name or value', () => {
  const result = runWithStdin(
    transcriptWithRequest({ method: 'GET', path: '/x?q=abc==SYNTH-E10' }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(
    result.stderr.includes(
      '  - scenarios[0].calls[0].request.path parameter #1',
    ),
  );
  assert.ok(!result.stderr.includes('SYNTH-E10'));
});

test('exit 1 and stderr print parameter #n for a hex token as a parameter name, never the token', () => {
  const hex = 'a3f9c2d8e1b74f6a9c0d2e5f8a1b3c4d';
  const result = runWithStdin(
    transcriptWithRequest({ method: 'GET', path: `/x?${hex}` }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(
    result.stderr.includes(
      '  - scenarios[0].calls[0].request.path parameter #1',
    ),
  );
  assert.ok(!result.stderr.includes(hex));
});

test('exit 1 and stderr print key #n for a hex token as a JSON key, never the token', () => {
  const hex = 'a3f9c2d8e1b74f6a9c0d2e5f8a1b3c4d';
  const result = runWithStdin(
    transcriptWithRequest({ method: 'GET', path: '/x', body: { [hex]: 1 } }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(
    result.stderr.includes('  - scenarios[0].calls[0].request.body key #1'),
  );
  assert.ok(!result.stderr.includes(hex));
});

test('exit 1 and stderr do not print a 25-letter parameter name, and print parameter #1', () => {
  const name = 'abcdefghijklmnopqrstuvwxy';
  const result = runWithStdin(
    transcriptWithRequest({ method: 'GET', path: `/x?${name}` }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(
    result.stderr.includes(
      '  - scenarios[0].calls[0].request.path parameter #1',
    ),
  );
  assert.ok(!result.stderr.includes(name));
});

test('exit 1 and stderr do not print a name with three digits, and print parameter #1', () => {
  const result = runWithStdin(
    transcriptWithRequest({ method: 'GET', path: '/x?ab123c' }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(
    result.stderr.includes(
      '  - scenarios[0].calls[0].request.path parameter #1',
    ),
  );
  assert.ok(!result.stderr.includes('ab123c'));
});

test('exit 0 with a Bearer value in a path withheld in stdout, and the value absent from stdout and stderr', () => {
  const result = runWithStdin(
    transcriptWithRequest({ method: 'GET', path: '/x/Bearer%20SYNTH-AU2' }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('"path": "[withheld]"'));
  assert.ok(!result.stdout.includes('SYNTH-AU2'));
});

test('exit 1 with nothing on stdout when a parameter name is empty, naming parameter #1 and never the value', () => {
  const result = runWithStdin(
    transcriptWithRequest({ method: 'GET', path: '/x?=SYNTH-EN3' }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(
    result.stderr.includes(
      '  - scenarios[0].calls[0].request.path parameter #1',
    ),
  );
  assert.ok(!result.stderr.includes('SYNTH-EN3'));
});

test('exit 1 with nothing on stdout for an @ or a look-alike of it in a URL, each named by its position, and no value on stderr', () => {
  const forms: [object, string][] = [
    [{ method: 'GET', path: 'https://user:SYNTH-UI1@host/x' }, 'request.path'],
    [{ method: 'GET', path: 'https:///user:SYNTH-UI1@host/x' }, 'request.path'],
    [
      { method: 'GET', path: 'https:////user:SYNTH-UI1@host/x' },
      'request.path',
    ],
    [{ method: 'GET', path: 'http:/user:SYNTH-UI1@host/x' }, 'request.path'],
    [
      { method: 'GET', path: 'https:\\\\user:SYNTH-UI1@host/x' },
      'request.path',
    ],
    [{ method: 'GET', path: '\\\\user:SYNTH-UI1@host/x' }, 'request.path'],
    [{ method: 'GET', path: '/\\user:SYNTH-UI1@host/x' }, 'request.path'],
    [{ method: 'GET', path: 'https:/\\user:SYNTH-UI1@h/x' }, 'request.path'],
    [
      { method: 'GET', path: 'https:%5C%5Cuser:SYNTH-UI1@host/x' },
      'request.path',
    ],
    [
      { method: 'GET', path: 'https:%2F%2F%2Fuser:SYNTH-UI1@host/x' },
      'request.path',
    ],
    [
      { method: 'GET', path: 'https://user:A%2FSYNTH-UI1@host/x' },
      'request.path',
    ],
    [
      { method: 'GET', path: 'https://user:A%20SYNTH-UI1@host/x' },
      'request.path',
    ],
    [
      { method: 'GET', path: 'https://user:A%09SYNTH-UI1@host/x' },
      'request.path',
    ],
    [
      { method: 'GET', path: 'https://user:A SYNTH-UI1@host/x' },
      'request.path',
    ],
    [
      { method: 'GET', path: 'https://user:A\tSYNTH-UI1@host/x' },
      'request.path',
    ],
    [
      { method: 'GET', path: 'https://user:SYNTH-UI1%40host/x' },
      'request.path',
    ],
    [{ method: 'GET', path: 'https://user:SYNTH-UI1＠host/x' }, 'request.path'],
    [
      { method: 'GET', path: 'https%3A%2F%2Fu%3ASYNTH-UI1%40h/x' },
      'request.path',
    ],
    [
      { method: 'GET', path: 'https%253A%252F%252Fu%253ASYNTH-UI1%2540h/x' },
      'request.path',
    ],
    [{ method: 'GET', path: '//user:SYNTH-UI1@host/x' }, 'request.path'],
    [
      { method: 'GET', path: '/x', query: 'q=1https://u:SYNTH-UI1@h/x' },
      'request.query',
    ],
    [{ method: 'GET', path: '/users/SYNTH-UI1@b.example' }, 'request.path'],
    [
      { method: 'GET', path: '/x', query: 'page=2&q=SYNTH-UI1@b' },
      'request.query',
    ],
    [{ method: 'GET', path: '/x#SYNTH-UI1@b' }, 'request.path'],
    [{ method: 'GET', path: 'https://user:SYNTH-UI1﹫host/x' }, 'request.path'],
    [
      { method: 'GET', path: 'https://user:SYNTH-UI1%EF%B9%ABhost/x' },
      'request.path',
    ],
    [
      { method: 'GET', path: 'https://user:SYNTH-UI1％４０host/x' },
      'request.path',
    ],
  ];
  for (const [request, field] of forms) {
    const result = runWithStdin(transcriptWithRequest(request));
    assert.equal(result.status, 1, JSON.stringify(request));
    assert.equal(result.stdout, '', JSON.stringify(request));
    assert.ok(
      result.stderr.includes(
        `  - scenarios[0].calls[0].${field} (an @ in a URL)\n`,
      ),
      JSON.stringify(request),
    );
    assert.ok(!result.stderr.includes('SYNTH-UI1'), JSON.stringify(request));
  }
});

test('exit 0 with a withheld key outside the clean list printed as <field #1>, and its text absent from stdout', () => {
  const result = runWithStdin(
    transcriptWithRequest({
      method: 'GET',
      path: '/x',
      body: { 'token=SYNTH-UI2': 1 },
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('"<field #1>": "[withheld]"'));
  assert.ok(!result.stdout.includes('SYNTH-UI2'));
});

test('exit 0 with a zero-width space inside a JWT withheld in stdout, and the value absent', () => {
  const result = runWithStdin(
    transcriptWithRequest({
      method: 'GET',
      path: '/x',
      query: 'q=eyJhbGci​Oi.abc.SYNTH-ZW1',
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('"query": "[withheld]"'));
  assert.ok(!result.stdout.includes('SYNTH-ZW1'));
});

test('exit 1 with nothing on stdout for a zero-width spelling of the path key holding an @, named as <field #2>, and no value on stderr', () => {
  const result = runWithStdin(
    transcriptWithRequest({
      method: 'GET',
      ['pa​th']: 'user:SYNTH-YZ1@host/x',
    }),
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(
    result.stderr.includes(
      '  - scenarios[0].calls[0].request.<field #2> (an @ in a URL)\n',
    ),
  );
  assert.ok(!result.stderr.includes('SYNTH-YZ1'));
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
