// Contracts for the Request Transcript redactor (ADR 0147 decision 7), exercised
// through its public entry: redactTranscript, parseTranscriptInput,
// renderTranscript, and TranscriptInputError. Pure functions, so no fixtures and
// no subprocess; the command-line surface is in ../redact-transcript.test.ts.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  TranscriptInputError,
  parseTranscriptInput,
  redactTranscript,
  renderTranscript,
  type RedactionOutcome,
} from './redact-transcript.ts';

// Synthetic sentinels, kept at 15 characters or fewer so that no quoted literal
// after a credential keyword reaches the secret-scan hook's 16-character window.
const CREDENTIAL = 'synth-cred-001';
const MYSTERY = 'mystery-val-01';

// Every alternative in the implementation's CREDENTIAL_KEY pattern, one key each.
const CREDENTIAL_KEYS = [
  'authorization',
  'cookie',
  'token',
  'secret',
  'password',
  'passwd',
  'api-key',
  'api_key',
  'apikey',
  'credential',
  'session',
  'jwt',
  'csrf',
  'xsrf',
  'bearer',
  'signature',
];

// Every entry in the implementation's CIPHERTEXT_KEYS set.
const CIPHERTEXT_KEYS = [
  'ciphertext',
  'encryptedBlob',
  'encryptedData',
  'encryptedVault',
  'wrappedMasterKey',
  'iv',
  'nonce',
];

function call(side: 'before' | 'after', request: object, response: object) {
  return { side, request, response };
}

function transcriptOf(...calls: object[]) {
  return { scenarios: [{ id: 'S1', calls }] };
}

function redactOk(input: unknown): RedactionOutcome {
  const result = redactTranscript(input);
  if (!result.ok) {
    throw new Error(`unexpected refusal: ${result.refusedPaths.join(', ')}`);
  }
  return result;
}

interface Transcript {
  scenarios: { calls: { request: unknown; response: unknown }[] }[];
}

/** The single call of a one-scenario, one-call transcript. */
function onlyCall(transcript: unknown) {
  return (transcript as Transcript).scenarios[0].calls[0];
}

function assertNoLeak(text: string, sentinel: string) {
  assert.ok(!text.includes(sentinel), `output leaked the sentinel ${sentinel}`);
}

function assertTranscriptInputError(fn: () => void, message: RegExp) {
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof TranscriptInputError && message.test(error.message),
  );
}

describe('allow-listed fields', () => {
  test('safe fields pass through unchanged, including the content-type header and items', () => {
    const input = transcriptOf(
      call(
        'after',
        {
          method: 'GET',
          path: '/api/tasks',
          headers: { 'content-type': 'application/json' },
        },
        {
          status: 200,
          body: {
            items: [{ id: 't1', title: 'Pay rent', completed: false }],
            total: 1,
          },
        },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(result.transcript, input);
    assert.deepEqual(result.withheld, []);
    assert.deepEqual(result.shortened, []);
  });

  test('a null under a safe key passes through unchanged', () => {
    const input = transcriptOf(
      call(
        'after',
        { method: 'PATCH', path: '/api/tasks/t1', body: { title: null } },
        { status: 200, body: { items: [], total: null } },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(result.transcript, input);
    assert.deepEqual(result.withheld, []);
    assert.deepEqual(result.shortened, []);
  });
});

describe('withheld fields', () => {
  test('Authorization, Cookie, Set-Cookie, accessToken, refreshToken, password and x-api-key are replaced and their paths listed', () => {
    const input = transcriptOf(
      call(
        'before',
        {
          method: 'POST',
          path: '/api/login',
          headers: {
            Authorization: CREDENTIAL,
            Cookie: CREDENTIAL,
            'x-api-key': CREDENTIAL,
          },
          body: {
            password: CREDENTIAL,
            accessToken: CREDENTIAL,
            refreshToken: CREDENTIAL,
          },
        },
        {
          status: 200,
          headers: { 'Set-Cookie': CREDENTIAL },
          body: {},
        },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(result.transcript, {
      scenarios: [
        {
          id: 'S1',
          calls: [
            {
              side: 'before',
              request: {
                method: 'POST',
                path: '/api/login',
                headers: {
                  Authorization: '[withheld]',
                  Cookie: '[withheld]',
                  'x-api-key': '[withheld]',
                },
                body: {
                  password: '[withheld]',
                  accessToken: '[withheld]',
                  refreshToken: '[withheld]',
                },
              },
              response: {
                status: 200,
                headers: { 'Set-Cookie': '[withheld]' },
                body: {},
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(result.withheld, [
      'scenarios[0].calls[0].request.headers.Authorization',
      'scenarios[0].calls[0].request.headers.Cookie',
      'scenarios[0].calls[0].request.headers.x-api-key',
      'scenarios[0].calls[0].request.body.password',
      'scenarios[0].calls[0].request.body.accessToken',
      'scenarios[0].calls[0].request.body.refreshToken',
      'scenarios[0].calls[0].response.headers.Set-Cookie',
    ]);
    assert.deepEqual(result.shortened, []);
  });

  for (const key of CREDENTIAL_KEYS) {
    test(`the key "${key}" withholds its value`, () => {
      const input = transcriptOf(
        call(
          'after',
          { method: 'POST', path: '/api/x', body: { [key]: CREDENTIAL } },
          { status: 200 },
        ),
      );
      const result = redactOk(input);
      assert.deepEqual(onlyCall(result.transcript).request, {
        method: 'POST',
        path: '/api/x',
        body: { [key]: '[withheld]' },
      });
      assert.deepEqual(result.withheld, [
        `scenarios[0].calls[0].request.body.${key}`,
      ]);
      assert.deepEqual(result.shortened, []);
      assertNoLeak(JSON.stringify(result), CREDENTIAL);
    });
  }

  test('a withheld subtree is not walked, so unknown fields inside it do not refuse', () => {
    const input = transcriptOf(
      call(
        'before',
        {
          method: 'GET',
          path: '/api/tasks',
          headers: {
            Cookie: {
              session: { mystery: MYSTERY, deep: [{ mystery: MYSTERY }] },
            },
          },
        },
        { status: 200 },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(onlyCall(result.transcript).request, {
      method: 'GET',
      path: '/api/tasks',
      headers: { Cookie: '[withheld]' },
    });
    assert.deepEqual(result.withheld, [
      'scenarios[0].calls[0].request.headers.Cookie',
    ]);
    assertNoLeak(JSON.stringify(result), MYSTERY);
  });

  test('a safe key holding a Bearer, Basic or JWT-shaped string is withheld anyway', () => {
    const input = transcriptOf(
      call(
        'after',
        {
          method: 'POST',
          path: '/api/tasks',
          body: {
            message: 'Bearer synth-cred-001',
            title: 'eyJsynth.abc-01.sig',
          },
        },
        { status: 200, body: { data: 'Basic synth-cred-001' } },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(result.transcript, {
      scenarios: [
        {
          id: 'S1',
          calls: [
            {
              side: 'after',
              request: {
                method: 'POST',
                path: '/api/tasks',
                body: { message: '[withheld]', title: '[withheld]' },
              },
              response: { status: 200, body: { data: '[withheld]' } },
            },
          ],
        },
      ],
    });
    assert.deepEqual(result.withheld, [
      'scenarios[0].calls[0].request.body.message',
      'scenarios[0].calls[0].request.body.title',
      'scenarios[0].calls[0].response.body.data',
    ]);
    assertNoLeak(JSON.stringify(result), CREDENTIAL);
  });
});

describe('credential parameters inside string values', () => {
  test('a path or query carrying a credential parameter is withheld, and its value never renders', () => {
    const input = transcriptOf(
      call(
        'after',
        { method: 'GET', path: '/api/x?token=synth-001' },
        {
          status: 200,
          body: {
            query: '?a=1&session=synth-002',
            message: 'x;api_key=synth-003',
          },
        },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(result.transcript, {
      scenarios: [
        {
          id: 'S1',
          calls: [
            {
              side: 'after',
              request: { method: 'GET', path: '[withheld]' },
              response: {
                status: 200,
                body: { query: '[withheld]', message: '[withheld]' },
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(result.withheld, [
      'scenarios[0].calls[0].request.path',
      'scenarios[0].calls[0].response.body.query',
      'scenarios[0].calls[0].response.body.message',
    ]);
    const out = renderTranscript(result.transcript);
    assertNoLeak(JSON.stringify(result), 'synth-001');
    assertNoLeak(out, 'synth-002');
    assertNoLeak(out, 'synth-003');
  });

  test('a benign query string passes through unchanged', () => {
    const input = transcriptOf(
      call(
        'after',
        { method: 'GET', path: '/api/tasks?page=2&limit=10' },
        { status: 200 },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(result.transcript, input);
    assert.deepEqual(result.withheld, []);
  });
});

describe('ciphertext', () => {
  test('Ciphertext is shortened to a prefix no longer than a quarter of its length, and each path is listed', () => {
    const input = transcriptOf(
      call(
        'after',
        { method: 'PUT', path: '/api/vault' },
        {
          status: 200,
          body: {
            ciphertext: 'abcdefghijklmnop',
            iv: 'iv-0123',
            wrappedMasterKey: 'WRAPPEDKEYWRAPPEDKEY',
          },
        },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(result.transcript, {
      scenarios: [
        {
          id: 'S1',
          calls: [
            {
              side: 'after',
              request: { method: 'PUT', path: '/api/vault' },
              response: {
                status: 200,
                body: {
                  ciphertext: 'abcd…[ciphertext, 16 chars]',
                  iv: 'i…[ciphertext, 7 chars]',
                  wrappedMasterKey: 'WRAPP…[ciphertext, 20 chars]',
                },
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(result.shortened, [
      'scenarios[0].calls[0].response.body.ciphertext',
      'scenarios[0].calls[0].response.body.iv',
      'scenarios[0].calls[0].response.body.wrappedMasterKey',
    ]);
    assert.deepEqual(result.withheld, []);
  });

  test('a Ciphertext of 32 or more characters shows the 8-character prefix', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz012345';
    const input = transcriptOf(
      call(
        'after',
        { method: 'PUT', path: '/api/vault' },
        { status: 200, body: { ciphertext: value } },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(onlyCall(result.transcript).response, {
      status: 200,
      body: { ciphertext: 'abcdefgh…[ciphertext, 32 chars]' },
    });
    assertNoLeak(JSON.stringify(result), 'ijklmnopqrstuvwxyz');
  });

  for (const key of CIPHERTEXT_KEYS) {
    test(`the key "${key}" shortens its value`, () => {
      const input = transcriptOf(
        call(
          'after',
          { method: 'PUT', path: '/api/vault' },
          { status: 200, body: { [key]: 'abcdefghijklmnop' } },
        ),
      );
      const result = redactOk(input);
      assert.deepEqual(onlyCall(result.transcript).response, {
        status: 200,
        body: { [key]: 'abcd…[ciphertext, 16 chars]' },
      });
      assert.deepEqual(result.shortened, [
        `scenarios[0].calls[0].response.body.${key}`,
      ]);
      assert.deepEqual(result.withheld, []);
      assertNoLeak(JSON.stringify(result), 'efghijklmnop');
    });
  }

  test('a non-string Ciphertext becomes [ciphertext] and its children are not walked', () => {
    const input = transcriptOf(
      call(
        'after',
        { method: 'PUT', path: '/api/vault' },
        {
          status: 200,
          body: {
            ciphertext: 42,
            encryptedBlob: { bytes: MYSTERY },
          },
        },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(onlyCall(result.transcript).response, {
      status: 200,
      body: { ciphertext: '[ciphertext]', encryptedBlob: '[ciphertext]' },
    });
    assert.deepEqual(result.shortened, [
      'scenarios[0].calls[0].response.body.ciphertext',
      'scenarios[0].calls[0].response.body.encryptedBlob',
    ]);
    assertNoLeak(JSON.stringify(result), MYSTERY);
  });
});

describe('refusal of unknown fields', () => {
  test('an unknown field inside an array refuses the transcript and names its path, never its value', () => {
    const input = transcriptOf(
      call(
        'before',
        { method: 'GET', path: '/api/tasks' },
        { status: 200, body: { items: [{ id: 'a' }, { id: 'b' }] } },
      ),
      call(
        'after',
        { method: 'GET', path: '/api/tasks' },
        {
          status: 200,
          body: {
            items: [{ id: 'a' }, { id: 'b' }, { id: 'c', mystery: MYSTERY }],
          },
        },
      ),
    );
    const result = redactTranscript(input);
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[1].response.body.items[2].mystery'],
    });
    assertNoLeak(JSON.stringify(result), MYSTERY);
  });

  test('every refused path is reported, not only the first', () => {
    const input = {
      scenarios: [
        {
          id: 'S1',
          calls: [
            call(
              'after',
              { method: 'GET', path: '/x', flavour: 'a' },
              { status: 200 },
            ),
          ],
        },
      ],
      extra: MYSTERY,
    };
    const result = redactTranscript(input);
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.flavour', 'extra'],
    });
    assertNoLeak(JSON.stringify(result), MYSTERY);
  });

  test('key matching is case-insensitive, and a known key keeps its own casing', () => {
    const input = transcriptOf(
      call(
        'after',
        {
          method: 'GET',
          path: '/api/me',
          headers: { 'Content-Type': 'application/json' },
          body: { EMAIL: 'person@example.com', ACCESSTOKEN: CREDENTIAL },
        },
        { status: 200 },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(onlyCall(result.transcript).request, {
      method: 'GET',
      path: '/api/me',
      headers: { 'Content-Type': 'application/json' },
      body: { EMAIL: 'person@example.com', ACCESSTOKEN: '[withheld]' },
    });
    assert.deepEqual(result.withheld, [
      'scenarios[0].calls[0].request.body.ACCESSTOKEN',
    ]);
    assertNoLeak(JSON.stringify(result), CREDENTIAL);
  });
});

describe('rendering', () => {
  test('renders a collapsed block with a summary, a blank line, and a Before/After label per call', () => {
    const input = transcriptOf(
      call('before', { method: 'GET', path: '/a' }, { status: 200 }),
      call('after', { method: 'GET', path: '/a' }, { status: 200 }),
    );
    const out = renderTranscript(redactOk(input).transcript);
    assert.match(
      out,
      /^<details>\n<summary>Request Transcript<\/summary>\n\n#### S1\n\n\*\*Before\*\*\n\n```json\n/,
    );
    assert.equal(out.match(/\*\*Before\*\*/g)?.length, 1);
    assert.equal(out.match(/\*\*After\*\*/g)?.length, 1);
    assert.ok(out.endsWith('```\n\n</details>\n'));
    const first = out.split('```json\n')[1].split('\n```')[0];
    assert.deepEqual(JSON.parse(first), {
      request: { method: 'GET', path: '/a' },
      response: { status: 200 },
    });
  });

  test('a fence longer than any backtick run in the JSON keeps the content inside the block', () => {
    const input = transcriptOf(
      call(
        'after',
        {
          method: 'POST',
          path: '/api/tasks',
          body: { message: 'run ```js first' },
        },
        { status: 201 },
      ),
    );
    const out = renderTranscript(redactOk(input).transcript);
    assert.ok(out.includes('````json\n'));
    assert.ok(out.includes('\n````\n'));
    const body = out.split('````json\n')[1].split('\n````')[0];
    assert.deepEqual(JSON.parse(body).request.body, {
      message: 'run ```js first',
    });
  });

  test('withheld and ciphertext values render redacted, and the raw credential never appears', () => {
    const input = transcriptOf(
      call(
        'after',
        {
          method: 'POST',
          path: '/api/login',
          headers: { Authorization: CREDENTIAL },
          body: { password: CREDENTIAL, ciphertext: 'abcdefghijklmnop' },
        },
        { status: 200, body: { accessToken: CREDENTIAL } },
      ),
    );
    const out = renderTranscript(redactOk(input).transcript);
    assert.equal(out.match(/\[withheld\]/g)?.length, 3);
    assert.ok(out.includes('abcd…[ciphertext, 16 chars]'));
    assertNoLeak(out, CREDENTIAL);
    assertNoLeak(out, 'efghijklmnop');
  });
});

describe('parseTranscriptInput', () => {
  test('accepts a well-formed transcript', () => {
    assert.doesNotThrow(() =>
      parseTranscriptInput(
        transcriptOf(
          call('before', { method: 'GET', path: '/a' }, { status: 200 }),
        ),
      ),
    );
  });

  test('rejects input without a scenarios array', () => {
    assertTranscriptInputError(
      () => parseTranscriptInput({}),
      /input needs a "scenarios" array/,
    );
    assertTranscriptInputError(
      () => parseTranscriptInput({ scenarios: {} }),
      /input needs a "scenarios" array/,
    );
  });

  test('rejects a scenario without a string id or without a calls array', () => {
    assertTranscriptInputError(
      () => parseTranscriptInput({ scenarios: [{ calls: [] }] }),
      /scenarios\[0\] needs a string "id" and a "calls" array/,
    );
    assertTranscriptInputError(
      () => parseTranscriptInput({ scenarios: [{ id: 'S1', calls: {} }] }),
      /scenarios\[0\] needs a string "id" and a "calls" array/,
    );
  });

  test('rejects a null scenario with its exact message', () => {
    assertTranscriptInputError(
      () => parseTranscriptInput({ scenarios: [null] }),
      /^scenarios\[0\] needs a string "id" and a "calls" array$/,
    );
  });

  test('rejects a null call with its exact message', () => {
    assertTranscriptInputError(
      () => parseTranscriptInput({ scenarios: [{ id: 'S1', calls: [null] }] }),
      /^scenarios\[0\]\.calls\[0\] needs a "side" of before or after, a "request" and a "response"$/,
    );
  });

  test('rejects a call with a bad side, or without a request or a response', () => {
    const where =
      /scenarios\[0\]\.calls\[0\] needs a "side" of before or after/;
    assertTranscriptInputError(
      () =>
        parseTranscriptInput({
          scenarios: [
            {
              id: 'S1',
              calls: [{ side: 'during', request: {}, response: {} }],
            },
          ],
        }),
      where,
    );
    assertTranscriptInputError(
      () =>
        parseTranscriptInput({
          scenarios: [{ id: 'S1', calls: [{ side: 'before', request: {} }] }],
        }),
      where,
    );
    assertTranscriptInputError(
      () =>
        parseTranscriptInput({
          scenarios: [{ id: 'S1', calls: [{ side: 'after', response: {} }] }],
        }),
      where,
    );
  });
});
