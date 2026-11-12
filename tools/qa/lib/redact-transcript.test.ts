// Contracts for the Request Transcript redactor (ADR 0147 decision 7), exercised
// through its public entry: redactTranscript, parseTranscriptInput,
// renderTranscript, and TranscriptInputError. Pure functions, so no fixtures and
// no subprocess; the command-line surface is in ../redact-transcript.test.ts.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  MAX_DECODE_PASSES,
  TranscriptInputError,
  canonical,
  decodeBounded,
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

/** A transcript holding one After call with the given request and a 200 response. */
function afterRequest(request: object) {
  return transcriptOf(call('after', request, { status: 200 }));
}

/** `text` percent-encoded `levels` times, so decoding it takes that many passes. */
function encodedTimes(text: string, levels: number): string {
  let encoded = text;
  for (let level = 0; level < levels; level++) {
    encoded = encodeURIComponent(encoded);
  }
  return encoded;
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
  test('a null under a credential key is withheld', () => {
    const input = transcriptOf(
      call(
        'after',
        { method: 'POST', path: '/x', body: { password: null } },
        { status: 200 },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(onlyCall(result.transcript).request, {
      method: 'POST',
      path: '/x',
      body: { password: '[withheld]' },
    });
    assert.deepEqual(result.withheld, [
      'scenarios[0].calls[0].request.body.password',
    ]);
  });
});

describe('credential parameters inside string values', () => {
  // A credential parameter introduced by each separator or encoding the split
  // recognises. `key` is the field holding the string; the safe parameter beside
  // the credential is kept, and the credential's value never appears.
  const FORMS: {
    form: string;
    key: 'path' | 'query';
    value: string;
    expected: string;
    sentinel: string;
  }[] = [
    {
      form: 'after ? in a path',
      key: 'path',
      value: '/api/x?token=SYNTH-F01&page=2',
      expected: '/api/x?token=[withheld]&page=2',
      sentinel: 'SYNTH-F01',
    },
    {
      form: 'after &',
      key: 'query',
      value: 'page=2&token=SYNTH-F02',
      expected: 'page=2&token=[withheld]',
      sentinel: 'SYNTH-F02',
    },
    {
      form: 'after ;',
      key: 'query',
      value: 'page=2;token=SYNTH-F03',
      expected: 'page=2;token=[withheld]',
      sentinel: 'SYNTH-F03',
    },
    {
      form: 'after # in a path',
      key: 'path',
      value: '/x?page=2#token=SYNTH-F04',
      expected: '/x?page=2#token=[withheld]',
      sentinel: 'SYNTH-F04',
    },
    {
      form: 'as a matrix parameter in a path',
      key: 'path',
      value: '/api/;token=SYNTH-F05',
      expected: '/api/;token=[withheld]',
      sentinel: 'SYNTH-F05',
    },
    {
      form: 'as a bare leading parameter',
      key: 'query',
      value: 'token=SYNTH-F06',
      expected: 'token=[withheld]',
      sentinel: 'SYNTH-F06',
    },
    {
      form: 'as a bare name with no =',
      key: 'query',
      value: 'page=2&token',
      expected: 'page=2&[withheld]',
      sentinel: 'token',
    },
    {
      form: 'after a percent-encoded & (%26)',
      key: 'query',
      value: 'page=2%26token=SYNTH-F07',
      expected: 'page=2&token=[withheld]',
      sentinel: 'SYNTH-F07',
    },
    {
      form: 'after an encoded ; (%3B)',
      key: 'query',
      value: 'page=2%3Btoken=SYNTH-F08',
      expected: 'page=2;token=[withheld]',
      sentinel: 'SYNTH-F08',
    },
    {
      form: 'with an encoded = (%3D) before the value',
      key: 'query',
      value: 'page=2&token%3DSYNTH-F09',
      expected: 'page=2&token=[withheld]',
      sentinel: 'SYNTH-F09',
    },
    {
      form: 'after a double-encoded & (%2526)',
      key: 'query',
      value: 'page=2%2526token=SYNTH-F10',
      expected: 'page=2&token=[withheld]',
      sentinel: 'SYNTH-F10',
    },
    {
      form: 'after a double-encoded ; (%253B)',
      key: 'query',
      value: 'page=2%253Btoken=SYNTH-F11',
      expected: 'page=2;token=[withheld]',
      sentinel: 'SYNTH-F11',
    },
    {
      form: 'after an encoded ? (%3F)',
      key: 'query',
      value: 'page=2%3Ftoken=SYNTH-F12',
      expected: 'page=2?token=[withheld]',
      sentinel: 'SYNTH-F12',
    },
    {
      form: 'after an encoded # (%23)',
      key: 'query',
      value: 'page=2%23token=SYNTH-F13',
      expected: 'page=2#token=[withheld]',
      sentinel: 'SYNTH-F13',
    },
    {
      form: 'with an uppercase name',
      key: 'query',
      value: 'page=2&ACCESS_TOKEN=SYNTH-F14',
      expected: 'page=2&ACCESS_TOKEN=[withheld]',
      sentinel: 'SYNTH-F14',
    },
    {
      form: 'with the name sessionId',
      key: 'query',
      value: 'page=2&sessionId=SYNTH-F15',
      expected: 'page=2&sessionId=[withheld]',
      sentinel: 'SYNTH-F15',
    },
  ];

  for (const { form, key, value, expected, sentinel } of FORMS) {
    test(`a credential parameter ${form} is withheld, and the parameter beside it is kept`, () => {
      const result = redactOk(
        afterRequest({ method: 'GET', path: '/x', [key]: value }),
      );
      assert.deepEqual(onlyCall(result.transcript).request, {
        method: 'GET',
        path: '/x',
        [key]: expected,
      });
      assert.deepEqual(result.withheld, [
        `scenarios[0].calls[0].request.${key}`,
      ]);
      assertNoLeak(JSON.stringify(result), sentinel);
      assertNoLeak(renderTranscript(result.transcript), sentinel);
    });
  }

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

describe('parameter names in URL-typed strings', () => {
  test('each safe parameter name passes, and its value is kept', () => {
    const names = [
      'page',
      'pageSize',
      'limit',
      'offset',
      'sort',
      'status',
      'kind',
      'search',
      'q',
      'role',
      'source',
      'event',
      'platform',
      'action',
      'userId',
    ];
    for (const name of names) {
      const input = afterRequest({
        method: 'GET',
        path: '/api/x',
        query: `${name}=v1`,
      });
      const result = redactOk(input);
      assert.deepEqual(result.transcript, input, name);
      assert.deepEqual(result.withheld, [], name);
    }
  });

  test('empty segments from && or ;; and a safe fragment pass unchanged', () => {
    for (const path of [
      '/api/x?page=2&&limit=10',
      '/api/x?;;page=2;',
      '/x#page=2',
    ]) {
      const input = afterRequest({ method: 'GET', path });
      assert.deepEqual(redactOk(input).transcript, input, path);
    }
  });

  test('an unknown parameter name refuses by position, naming the path and the position but never the name or value', () => {
    const result = redactTranscript(
      afterRequest({ method: 'GET', path: '/api/x?page=2&zzz=SYNTH-U01' }),
    );
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.path parameter #2'],
    });
    assertNoLeak(JSON.stringify(result), 'SYNTH-U01');
    assertNoLeak(JSON.stringify(result), 'zzz');
  });

  test('&amp; refuses as a position because amp is an unknown name: deliberate fail-closed', () => {
    const result = redactTranscript(
      afterRequest({ method: 'GET', path: '/api/x?page=2&amp;limit=10' }),
    );
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.path parameter #2'],
    });
    assertNoLeak(JSON.stringify(result), 'amp;');
  });

  test('free text under a non-URL key is not parsed: page=2 token=abc passes unchanged', () => {
    const input = afterRequest({
      method: 'POST',
      path: '/api/tasks',
      body: { message: 'page=2 token=abc' },
    });
    const result = redactOk(input);
    assert.deepEqual(result.transcript, input);
    assert.deepEqual(result.withheld, []);
  });
});

describe('decoding bounds and malformed percent-encoding', () => {
  test('a malformed % in a parameter name refuses by position, never throws, and never prints the value', () => {
    const cases: [string, string][] = [
      ['/x?%=SYNTH-M01', '#1'],
      ['/x?%G1=SYNTH-M01', '#1'],
      ['/x?%2=SYNTH-M01', '#1'],
      ['/x?%E0%A4=SYNTH-M01', '#1'],
      ['/x?page=2&SYNTH-M01%', '#2'],
    ];
    for (const [path, position] of cases) {
      const result = redactTranscript(afterRequest({ method: 'GET', path }));
      assert.deepEqual(
        result,
        {
          ok: false,
          refusedPaths: [
            `scenarios[0].calls[0].request.path parameter ${position}`,
          ],
        },
        path,
      );
      assertNoLeak(JSON.stringify(result), 'SYNTH-M01');
    }
  });

  test('an invalid UTF-8 byte (%FF) falls back to latin-1 without throwing, and an unknown name refuses', () => {
    const result = redactTranscript(
      afterRequest({ method: 'GET', path: '/x?%FF=SYNTH-L01' }),
    );
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.path parameter #1'],
    });
    assertNoLeak(JSON.stringify(result), 'SYNTH-L01');
  });

  test('a string still changing after MAX_DECODE_PASSES refuses, and the refusal holds no part of the value', () => {
    const path = `/x?${encodedTimes('token=SYNTH-C01', MAX_DECODE_PASSES + 2)}`;
    const result = redactTranscript(afterRequest({ method: 'GET', path }));
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: [
        'scenarios[0].calls[0].request.path (does not finish decoding)',
      ],
    });
    assertNoLeak(JSON.stringify(result), 'SYNTH-C01');
    assertNoLeak(JSON.stringify(result), 'token');
  });

  test('a parameter encoded MAX_DECODE_PASSES times is decoded and withheld; one more level refuses', () => {
    const withinCap = redactOk(
      afterRequest({
        method: 'GET',
        path: `/x?page=2&${encodedTimes('token=SYNTH-C02', MAX_DECODE_PASSES)}`,
      }),
    );
    assert.deepEqual(onlyCall(withinCap.transcript).request, {
      method: 'GET',
      path: '/x?page=2&token=[withheld]',
    });
    assertNoLeak(JSON.stringify(withinCap), 'SYNTH-C02');

    const overCap = redactTranscript(
      afterRequest({
        method: 'GET',
        path: `/x?page=2&${encodedTimes('token=SYNTH-C02', MAX_DECODE_PASSES + 1)}`,
      }),
    );
    assert.deepEqual(overCap, {
      ok: false,
      refusedPaths: [
        'scenarios[0].calls[0].request.path (does not finish decoding)',
      ],
    });
  });
});

describe('decodeBounded', () => {
  test('decodes each layer of percent-encoding until the value stops changing', () => {
    assert.deepEqual(decodeBounded('plain'), { value: 'plain', stable: true });
    assert.deepEqual(decodeBounded('%25'), { value: '%', stable: true });
    assert.deepEqual(decodeBounded('%2525'), { value: '%', stable: true });
    assert.deepEqual(decodeBounded('%2526'), { value: '&', stable: true });
    assert.deepEqual(
      decodeBounded(encodedTimes('token=SYNTH-D01', MAX_DECODE_PASSES)),
      { value: 'token=SYNTH-D01', stable: true },
    );
  });

  test('a malformed % stays a literal, an invalid UTF-8 run falls back to latin-1, and nothing throws', () => {
    for (const value of ['%', '%G1', '%2', 'a%']) {
      assert.deepEqual(decodeBounded(value), { value, stable: true });
    }
    assert.equal(
      decodeBounded('%E0%A4').value,
      String.fromCharCode(0xe0, 0xa4),
    );
    assert.equal(decodeBounded('%FF').value, String.fromCharCode(0xff));
  });

  test('a value still changing after MAX_DECODE_PASSES is reported as not stable', () => {
    assert.equal(
      decodeBounded(encodedTimes('token=SYNTH-D01', MAX_DECODE_PASSES + 1))
        .stable,
      false,
    );
  });
});

describe('bare tokens and opaque keys', () => {
  test('a JWT is withheld whole as a bare parameter name, after a safe parameter, or as a path segment', () => {
    const jwt = 'eyJJWT-SYNTH.jwtpart2.jwt-sig3';
    for (const path of [`/x?${jwt}`, `/x?page=2&${jwt}`, `/api/v1/x/${jwt}`]) {
      const result = redactOk(afterRequest({ method: 'GET', path }));
      assert.deepEqual(onlyCall(result.transcript).request, {
        method: 'GET',
        path: '[withheld]',
      });
      assert.deepEqual(result.withheld, ['scenarios[0].calls[0].request.path']);
      assertNoLeak(JSON.stringify(result), jwt);
      assertNoLeak(JSON.stringify(result), 'JWT-SYNTH');
    }
  });

  test('an opaque bare parameter name that is not a plain identifier refuses by position, printing none of it', () => {
    const result = redactTranscript(
      afterRequest({ method: 'GET', path: '/x?page=2&Xk9-Opaque+Tok' }),
    );
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.path parameter #2'],
    });
    assertNoLeak(JSON.stringify(result), 'Xk9');
    assertNoLeak(JSON.stringify(result), 'Opaque');
  });

  test('an opaque JSON key is refused as key #n, and its name is never printed', () => {
    const result = redactTranscript(
      afterRequest({
        method: 'GET',
        path: '/x',
        body: { page: 1, 'Xk9+Opaque': 1 },
      }),
    );
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.body key #2'],
    });
    assertNoLeak(JSON.stringify(result), 'Xk9');
    assertNoLeak(JSON.stringify(result), 'Opaque');
  });
});

describe('every = splits a parameter, and only short identifiers print', () => {
  const HEX_TOKEN = '0f1e2d3c'.repeat(4);

  test('a credential pair after a second = withholds the whole segment, raw or encoded, and its value is absent', () => {
    const cases: [string, string][] = [
      ['/x?page=token=SYNTH-R1', 'SYNTH-R1'],
      ['/x?page%3Dtoken=SYNTH-R2', 'SYNTH-R2'],
    ];
    for (const [path, sentinel] of cases) {
      const result = redactOk(afterRequest({ method: 'GET', path }));
      assert.deepEqual(
        onlyCall(result.transcript).request,
        {
          method: 'GET',
          path: '/x?[withheld]',
        },
        path,
      );
      assert.deepEqual(result.withheld, ['scenarios[0].calls[0].request.path']);
      assertNoLeak(JSON.stringify(result), sentinel);
      assertNoLeak(renderTranscript(result.transcript), sentinel);
    }
  });

  test('a second = that leaves an unknown name refuses once, naming no value', () => {
    const result = redactTranscript(
      afterRequest({ method: 'GET', path: '/x?q=abc==SYNTH-EQ1' }),
    );
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.path parameter #1'],
    });
    assertNoLeak(JSON.stringify(result), 'SYNTH-EQ1');
    assertNoLeak(JSON.stringify(result), 'abc');
  });

  test('a hex token as a bare parameter name refuses by position, printing none of it', () => {
    const result = redactTranscript(
      afterRequest({ method: 'GET', path: `/x?page=2&${HEX_TOKEN}` }),
    );
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.path parameter #2'],
    });
    assertNoLeak(JSON.stringify(result), HEX_TOKEN);
    assertNoLeak(JSON.stringify(result), HEX_TOKEN.slice(0, 8));
  });

  test('a hex token as a JSON key refuses as key #n, printing none of it', () => {
    const result = redactTranscript(
      afterRequest({
        method: 'GET',
        path: '/x',
        body: { [HEX_TOKEN]: 1 },
      }),
    );
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.body key #1'],
    });
    assertNoLeak(JSON.stringify(result), HEX_TOKEN);
  });

  test('a 25-letter name does not print, as a parameter or as a JSON key', () => {
    const name = 'abcdefghijklmnopqrstuvwxy';
    const asParameter = redactTranscript(
      afterRequest({ method: 'GET', path: `/x?${name}` }),
    );
    assert.deepEqual(asParameter, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.path parameter #1'],
    });
    const asKey = redactTranscript(
      afterRequest({ method: 'GET', path: '/x', body: { [name]: 1 } }),
    );
    assert.deepEqual(asKey, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.body key #1'],
    });
    assertNoLeak(JSON.stringify([asParameter, asKey]), name);
  });

  test('an unrecognised parameter name of any shape refuses as parameter #n, printing no part of the name', () => {
    const cases: [string, string, string][] = [
      ['/x?qzvxmarkqw', 'qzvxmarkqw', 'parameter #1'],
      ['/x?synth-opaque', 'synth-opaque', 'parameter #1'],
      ['/x?page=2&amp;limit=10', 'amp', 'parameter #2'],
      [`/x?page=2&${HEX_TOKEN}`, HEX_TOKEN, 'parameter #2'],
      [
        '/x?abcdefghijklmnopqrstuvwxy',
        'abcdefghijklmnopqrstuvwxy',
        'parameter #1',
      ],
      ['/x?ab123c', 'ab123c', 'parameter #1'],
    ];
    for (const [path, name, reason] of cases) {
      const result = redactTranscript(afterRequest({ method: 'GET', path }));
      assert.deepEqual(
        result,
        {
          ok: false,
          refusedPaths: [`scenarios[0].calls[0].request.path ${reason}`],
        },
        path,
      );
      assertNoLeak(JSON.stringify(result), name);
    }
  });

  test('an unrecognised JSON key of any shape refuses as key #n, printing no part of the key', () => {
    const keys = [
      'qzvxmarkqw',
      'synth-opaque',
      'amp',
      HEX_TOKEN,
      'abcdefghijklmnopqrstuvwxy',
      'ab123c',
    ];
    for (const key of keys) {
      const result = redactTranscript(
        afterRequest({ method: 'GET', path: '/x', body: { [key]: 1 } }),
      );
      assert.deepEqual(
        result,
        {
          ok: false,
          refusedPaths: ['scenarios[0].calls[0].request.body key #1'],
        },
        key,
      );
      assertNoLeak(JSON.stringify(result), key);
    }
  });

  test('a credential name with three digits is withheld bare, and its value is absent', () => {
    const result = redactOk(
      afterRequest({
        method: 'GET',
        path: '/x',
        query: 'page=2&token123=SYNTH-R5',
      }),
    );
    assert.deepEqual(onlyCall(result.transcript).request, {
      method: 'GET',
      path: '/x',
      query: 'page=2&[withheld]',
    });
    assertNoLeak(JSON.stringify(result), 'SYNTH-R5');
  });
});

describe('auth-shaped values, empty names, token shapes and name case', () => {
  test('Bearer followed by a value is withheld whole in a message, a query and a path, and its value is absent from the output and the render', () => {
    const cases: { request: object; expected: object; withheld: string }[] = [
      {
        request: { method: 'GET', path: '/x', query: 'q=Bearer%20SYNTH-AU1' },
        expected: { method: 'GET', path: '/x', query: '[withheld]' },
        withheld: 'scenarios[0].calls[0].request.query',
      },
      {
        request: { method: 'GET', path: '/x/Bearer%20SYNTH-AU1' },
        expected: { method: 'GET', path: '[withheld]' },
        withheld: 'scenarios[0].calls[0].request.path',
      },
      {
        request: { method: 'GET', path: '/x?q=Bearer+SYNTH-AU1' },
        expected: { method: 'GET', path: '[withheld]' },
        withheld: 'scenarios[0].calls[0].request.path',
      },
      {
        request: { method: 'GET', path: '/x?q=%42earer%20SYNTH-AU1' },
        expected: { method: 'GET', path: '[withheld]' },
        withheld: 'scenarios[0].calls[0].request.path',
      },
      {
        request: { method: 'GET', path: '/x?q=bearer%20SYNTH-AU1' },
        expected: { method: 'GET', path: '[withheld]' },
        withheld: 'scenarios[0].calls[0].request.path',
      },
      {
        request: {
          method: 'GET',
          path: '/x',
          body: { message: 'x Bearer SYNTH-AU1' },
        },
        expected: {
          method: 'GET',
          path: '/x',
          body: { message: '[withheld]' },
        },
        withheld: 'scenarios[0].calls[0].request.body.message',
      },
    ];
    for (const { request, expected, withheld } of cases) {
      const result = redactOk(afterRequest(request));
      assert.deepEqual(onlyCall(result.transcript).request, expected);
      assert.deepEqual(result.withheld, [withheld]);
      assertNoLeak(JSON.stringify(result), 'SYNTH-AU1');
      assertNoLeak(renderTranscript(result.transcript), 'SYNTH-AU1');
    }
  });

  test('Basic followed by 8 or more base64-ish characters is withheld, and Basic plan passes', () => {
    const withheld = redactOk(
      afterRequest({
        method: 'POST',
        path: '/x',
        body: { message: 'Basic dXNlcjpwYXNz' },
      }),
    );
    assert.deepEqual(onlyCall(withheld.transcript).request, {
      method: 'POST',
      path: '/x',
      body: { message: '[withheld]' },
    });
    assertNoLeak(JSON.stringify(withheld), 'dXNlcjpwYXNz');

    const plan = afterRequest({
      method: 'POST',
      path: '/x',
      body: { message: 'Basic plan' },
    });
    assert.deepEqual(redactOk(plan).transcript, plan);
  });

  test('an empty parameter name refuses as parameter #1, in a path or a query, and its value is absent', () => {
    const cases: [object, string][] = [
      [{ method: 'GET', path: '/x?=SYNTH-EN1' }, 'request.path'],
      [{ method: 'GET', path: '/x', query: '=SYNTH-EN1' }, 'request.query'],
    ];
    for (const [request, field] of cases) {
      const result = redactTranscript(afterRequest(request));
      assert.deepEqual(result, {
        ok: false,
        refusedPaths: [`scenarios[0].calls[0].${field} parameter #1`],
      });
      assertNoLeak(JSON.stringify(result), 'SYNTH-EN1');
    }
  });

  test('a 5-part JWE and a 3-part JWT are withheld whole under q=', () => {
    const cases = [
      'q=eyJhbGciOiJSU0EtT0FFUCJ9.a2V5.aXY.SYNTH-JE1.dGFn',
      'q=eyJhbGciOi.eyJzdWIi.SYNTH-JT1',
    ];
    for (const query of cases) {
      const result = redactOk(
        afterRequest({ method: 'GET', path: '/x', query }),
      );
      assert.deepEqual(onlyCall(result.transcript).request, {
        method: 'GET',
        path: '/x',
        query: '[withheld]',
      });
      assertNoLeak(JSON.stringify(result), 'SYNTH-J');
    }
  });

  test('a 6-part dotted eyJ string is withheld whole, and its value is absent', () => {
    const result = redactOk(
      afterRequest({
        method: 'GET',
        path: '/x',
        query: 'q=eyJhbGciOi.a.b.c.d.SYNTH-J6',
      }),
    );
    assert.deepEqual(onlyCall(result.transcript).request, {
      method: 'GET',
      path: '/x',
      query: '[withheld]',
    });
    assert.deepEqual(result.withheld, ['scenarios[0].calls[0].request.query']);
    assertNoLeak(JSON.stringify(result), 'SYNTH-J6');
  });

  test('an unrecognised mixed-case or non-lowercase name prints as a position, a recognised camelCase key still prints', () => {
    for (const path of ['/x?AbCdEfGhIjKlMnOpQrSt=SYNTH-MC1', '/x?qzvxMark']) {
      const result = redactTranscript(afterRequest({ method: 'GET', path }));
      assert.deepEqual(result, {
        ok: false,
        refusedPaths: ['scenarios[0].calls[0].request.path parameter #1'],
      });
      assertNoLeak(JSON.stringify(result), 'qzvxMark');
      assertNoLeak(JSON.stringify(result), 'AbCdEf');
    }

    const asKey = redactTranscript(
      afterRequest({ method: 'GET', path: '/x', body: { qzvxMark: 1 } }),
    );
    assert.deepEqual(asKey, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.body key #1'],
    });

    const recognised = redactOk(
      afterRequest({
        method: 'POST',
        path: '/x',
        body: { accessToken: 'SYNTH-AT1' },
      }),
    );
    assert.deepEqual(recognised.withheld, [
      'scenarios[0].calls[0].request.body.accessToken',
    ]);
    assertNoLeak(JSON.stringify(recognised), 'SYNTH-AT1');

    const setCookie = redactOk(
      transcriptOf(
        call(
          'after',
          { method: 'GET', path: '/x' },
          { status: 200, headers: { 'Set-Cookie': 'SYNTH-SC1' } },
        ),
      ),
    );
    assert.deepEqual(setCookie.withheld, [
      'scenarios[0].calls[0].response.headers.Set-Cookie',
    ]);
    assertNoLeak(JSON.stringify(setCookie), 'SYNTH-SC1');
  });

  test('a ~200k-character invalid-UTF-8 %-run no longer throws a RangeError; in a URL it refuses', () => {
    const run = '%FF'.repeat(66_000);
    let result: unknown;
    assert.doesNotThrow(() => {
      result = redactTranscript(
        afterRequest({ method: 'GET', path: `/x?${run}` }),
      );
    });
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.path parameter #1'],
    });
  });
});

describe('an @ in a URL, the segment rule and shapes anywhere in a string', () => {
  test('a string array inherits its parent key: query, path and location arrays are judged as URLs', () => {
    const query = redactOk(
      afterRequest({
        method: 'GET',
        path: '/x',
        query: ['token=SYNTH-A1', 'page=2'],
      }),
    );
    assert.deepEqual(onlyCall(query.transcript).request, {
      method: 'GET',
      path: '/x',
      query: ['token=[withheld]', 'page=2'],
    });
    assert.deepEqual(query.withheld, [
      'scenarios[0].calls[0].request.query[0]',
    ]);
    assertNoLeak(JSON.stringify(query), 'SYNTH-A1');

    const path = redactOk(
      afterRequest({ method: 'GET', path: ['x?token=SYNTH-A2'] }),
    );
    assert.deepEqual(onlyCall(path.transcript).request, {
      method: 'GET',
      path: ['x?token=[withheld]'],
    });
    assert.deepEqual(path.withheld, ['scenarios[0].calls[0].request.path[0]']);
    assertNoLeak(JSON.stringify(path), 'SYNTH-A2');

    const location = redactOk(
      transcriptOf(
        call(
          'after',
          { method: 'GET', path: '/x' },
          { status: 302, headers: { location: ['x?token=SYNTH-A3'] } },
        ),
      ),
    );
    assert.deepEqual(onlyCall(location.transcript).response, {
      status: 302,
      headers: { location: ['x?token=[withheld]'] },
    });
    assert.deepEqual(location.withheld, [
      'scenarios[0].calls[0].response.headers.location[0]',
    ]);
    assertNoLeak(JSON.stringify(location), 'SYNTH-A3');
  });

  test('a string array under a safe non-URL key is not parsed (out of scope, pinned)', () => {
    const input = afterRequest({
      method: 'GET',
      path: '/x',
      body: { items: ['token=SYNTH-A4'] },
    });
    assert.deepEqual(redactOk(input).transcript, input);
  });

  test('an @ or a look-alike of it refuses in these forms, and never echoes the secret', () => {
    const cases: [object, string][] = [
      [{ method: 'GET', path: 'https://user:SYNTH-U1@host/x' }, 'request.path'],
      [
        { method: 'GET', path: 'https:///user:SYNTH-U1@host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https:////user:SYNTH-U1@host/x' },
        'request.path',
      ],
      [{ method: 'GET', path: 'http:/user:SYNTH-U1@host/x' }, 'request.path'],
      [
        { method: 'GET', path: 'https:\\\\user:SYNTH-U1@host/x' },
        'request.path',
      ],
      [{ method: 'GET', path: '\\\\user:SYNTH-U1@host/x' }, 'request.path'],
      [{ method: 'GET', path: '/\\user:SYNTH-U1@host/x' }, 'request.path'],
      [{ method: 'GET', path: 'https:/\\user:SYNTH-U1@h/x' }, 'request.path'],
      [
        { method: 'GET', path: 'https:%5C%5Cuser:SYNTH-U1@host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https:%2F%2F%2Fuser:SYNTH-U1@host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https://user:A%2FSYNTH-U1@host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https://user:A%20SYNTH-U1@host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https://user:A%09SYNTH-U1@host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https://user:A SYNTH-U1@host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https://user:A\tSYNTH-U1@host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https://user:SYNTH-U1@SYNTH-U2@host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https://user:SYNTH-U1%40host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https://user:SYNTH-U1＠host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https%3A%2F%2Fu%3ASYNTH-U1%40h/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https%253A%252F%252Fu%253ASYNTH-U1%2540h/x' },
        'request.path',
      ],
      [{ method: 'GET', path: 'HTTPS://user:SYNTH-U1@host/x' }, 'request.path'],
      [{ method: 'GET', path: '//user:SYNTH-U1@host/x' }, 'request.path'],
      [{ method: 'GET', path: 'https://SYNTH-U1@host/x' }, 'request.path'],
      [
        { method: 'GET', path: '/x', query: 'q=1https://u:SYNTH-U1@h/x' },
        'request.query',
      ],
      [
        { method: 'GET', path: '/x', query: 'q=_https://u:SYNTH-U1@h/x' },
        'request.query',
      ],
      [{ method: 'GET', path: '/users/SYNTH-U1@b.example' }, 'request.path'],
      [
        { method: 'GET', path: '/x', query: 'page=2&q=SYNTH-U1@b' },
        'request.query',
      ],
      [{ method: 'GET', path: '/x#SYNTH-U1@b' }, 'request.path'],
      [
        { method: 'GET', path: 'https://user:SYNTH-U1﹫host/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https://user:SYNTH-U1%EF%B9%ABhost/x' },
        'request.path',
      ],
      [
        { method: 'GET', path: 'https://user:SYNTH-U1％４０host/x' },
        'request.path',
      ],
      [
        {
          method: 'GET',
          path: '/x',
          query: 'q=https://u:SYNTH-U1%EF%B9%ABh/x',
        },
        'request.query',
      ],
    ];
    for (const [request, field] of cases) {
      const result = redactTranscript(afterRequest(request));
      assert.deepEqual(
        result,
        {
          ok: false,
          refusedPaths: [`scenarios[0].calls[0].${field} (an @ in a URL)`],
        },
        JSON.stringify(request),
      );
      assertNoLeak(JSON.stringify(result), 'SYNTH-U1');
      assertNoLeak(JSON.stringify(result), 'SYNTH-U2');
    }
  });

  test('an @ in a URL location header or in a string array under query, path or location refuses too', () => {
    const location = redactTranscript(
      transcriptOf(
        call(
          'after',
          { method: 'GET', path: '/x' },
          {
            status: 302,
            headers: { location: 'https://u:SYNTH-U2@h.example/x' },
          },
        ),
      ),
    );
    assert.deepEqual(location, {
      ok: false,
      refusedPaths: [
        'scenarios[0].calls[0].response.headers.location (an @ in a URL)',
      ],
    });
    assertNoLeak(JSON.stringify(location), 'SYNTH-U2');

    const arrays: [object, string][] = [
      [
        { method: 'GET', path: '/x', query: ['https://u:SYNTH-U3@h/x'] },
        'request.query[0]',
      ],
      [{ method: 'GET', path: ['https://u:SYNTH-U3@h/x'] }, 'request.path[0]'],
    ];
    for (const [request, field] of arrays) {
      const result = redactTranscript(afterRequest(request));
      assert.deepEqual(result, {
        ok: false,
        refusedPaths: [`scenarios[0].calls[0].${field} (an @ in a URL)`],
      });
      assertNoLeak(JSON.stringify(result), 'SYNTH-U3');
    }

    const locationArray = redactTranscript(
      transcriptOf(
        call(
          'after',
          { method: 'GET', path: '/x' },
          { status: 302, headers: { location: ['https://u:SYNTH-U3@h/x'] } },
        ),
      ),
    );
    assert.deepEqual(locationArray, {
      ok: false,
      refusedPaths: [
        'scenarios[0].calls[0].response.headers.location[0] (an @ in a URL)',
      ],
    });
    assertNoLeak(JSON.stringify(locationArray), 'SYNTH-U3');
  });

  test('a fullwidth or %EF%B9%AB look-alike @ in a location header refuses, as the @ itself does', () => {
    const location = redactTranscript(
      transcriptOf(
        call(
          'after',
          { method: 'GET', path: '/x' },
          {
            status: 302,
            headers: { location: 'https://u:SYNTH-U2%EF%B9%ABh.example/x' },
          },
        ),
      ),
    );
    assert.deepEqual(location, {
      ok: false,
      refusedPaths: [
        'scenarios[0].calls[0].response.headers.location (an @ in a URL)',
      ],
    });
    assertNoLeak(JSON.stringify(location), 'SYNTH-U2');
  });

  test('a URL without an @ passes, and an @ in a non-URL field (message, email) is not refused', () => {
    const url = afterRequest({ method: 'GET', path: 'https://h/x?page=2' });
    assert.deepEqual(redactOk(url).transcript, url);
    assert.deepEqual(redactOk(url).withheld, []);

    const free = afterRequest({
      method: 'POST',
      path: '/x',
      body: { message: 'a@b', email: 'a@b.example' },
    });
    assert.deepEqual(redactOk(free).transcript, free);
    assert.deepEqual(redactOk(free).withheld, []);
  });

  test('a credential-named key outside the clean list prints as <field #n> with its value withheld', () => {
    const cases: [string, string][] = [
      ['token=SYNTH-K1', 'SYNTH-K1'],
      ['Bearer SYNTH-K2', 'SYNTH-K2'],
      ['sessionid:SYNTH-K3', 'SYNTH-K3'],
    ];
    for (const [key, sentinel] of cases) {
      const result = redactOk(
        afterRequest({ method: 'GET', path: '/x', body: { [key]: 1 } }),
      );
      assert.deepEqual(
        onlyCall(result.transcript).request,
        { method: 'GET', path: '/x', body: { '<field #1>': '[withheld]' } },
        key,
      );
      assert.deepEqual(result.withheld, [
        'scenarios[0].calls[0].request.body.<field #1>',
      ]);
      assertNoLeak(JSON.stringify(result), sentinel);
      assertNoLeak(renderTranscript(result.transcript), sentinel);
    }
  });

  test('clean credential key names print as themselves, with their values withheld', () => {
    const body = {
      authorization: 'SYNTHC1',
      cookie: 'SYNTHC1',
      token: 'SYNTHC1',
      'Set-Cookie': 'SYNTHC1',
      'x-api-key': 'SYNTHC1',
      accessToken: 'SYNTHC1',
      refreshToken: 'SYNTHC1',
      password: 'SYNTHC1',
    };
    const result = redactOk(afterRequest({ method: 'POST', path: '/x', body }));
    assert.deepEqual(onlyCall(result.transcript).request, {
      method: 'POST',
      path: '/x',
      body: {
        authorization: '[withheld]',
        cookie: '[withheld]',
        token: '[withheld]',
        'Set-Cookie': '[withheld]',
        'x-api-key': '[withheld]',
        accessToken: '[withheld]',
        refreshToken: '[withheld]',
        password: '[withheld]',
      },
    });
    assert.deepEqual(
      result.withheld,
      Object.keys(body).map(
        (key) => `scenarios[0].calls[0].request.body.${key}`,
      ),
    );
    assertNoLeak(JSON.stringify(result), 'SYNTHC1');
  });

  test("'code' is not a safe name: a query code parameter and a body key code both refuse", () => {
    const query = redactTranscript(
      afterRequest({ method: 'GET', path: '/x', query: 'code=SYNTH-C1' }),
    );
    assert.deepEqual(query, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.query parameter #1'],
    });
    assertNoLeak(JSON.stringify(query), 'SYNTH-C1');

    const body = redactTranscript(
      afterRequest({ method: 'POST', path: '/x', body: { code: 'SYNTH-C1' } }),
    );
    assert.deepEqual(body, {
      ok: false,
      refusedPaths: ['scenarios[0].calls[0].request.body key #1'],
    });
    assertNoLeak(JSON.stringify(body), 'SYNTH-C1');
  });

  test('a credential-named parameter withholds its whole segment unless its name is a clean credential word', () => {
    const cases: [string, string, string][] = [
      ['token=SYNTH-N1', 'token=[withheld]', 'SYNTH-N1'],
      ['ACCESS_TOKEN=SYNTH-N2', 'ACCESS_TOKEN=[withheld]', 'SYNTH-N2'],
      ['zzz-token-zz=SYNTH-N3', '[withheld]', 'SYNTH-N3'],
      ['page=token=SYNTH-N4', '[withheld]', 'SYNTH-N4'],
    ];
    for (const [query, expected, sentinel] of cases) {
      const result = redactOk(
        afterRequest({ method: 'GET', path: '/x', query }),
      );
      assert.deepEqual(
        onlyCall(result.transcript).request,
        {
          method: 'GET',
          path: '/x',
          query: expected,
        },
        query,
      );
      assertNoLeak(JSON.stringify(result), sentinel);
      assertNoLeak(JSON.stringify(result), 'zzz-token-zz');
    }
  });

  test('a JWT or JWE found anywhere in a string is withheld whole, glued to a word or after a name', () => {
    const cases: [object, object, string, string][] = [
      [
        {
          method: 'GET',
          path: '/x',
          body: { message: 'jwt:eyJhbGciOi.eyJzdWIi.SYNTH-JW1' },
        },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
        'SYNTH-JW1',
      ],
      [
        {
          method: 'GET',
          path: '/x',
          query: 'page=abc.eyJhbGciOi.eyJzdWIi.SYNTH-JW2',
        },
        { method: 'GET', path: '/x', query: '[withheld]' },
        'request.query',
        'SYNTH-JW2',
      ],
      [
        {
          method: 'GET',
          path: '/x',
          body: { message: 'tokeneyJhbGciOi.eyJzdWIi.SYNTH-JW3' },
        },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
        'SYNTH-JW3',
      ],
    ];
    for (const [request, expected, withheld, sentinel] of cases) {
      const result = redactOk(afterRequest(request));
      assert.deepEqual(onlyCall(result.transcript).request, expected);
      assert.deepEqual(result.withheld, [`scenarios[0].calls[0].${withheld}`]);
      assertNoLeak(JSON.stringify(result), sentinel);
    }
  });

  test('Bearer glued to a word, anywhere in a string, is withheld whole', () => {
    const cases: [object, object, string][] = [
      [
        { method: 'GET', path: '/x', body: { message: 'xBearer SYNTH-B1' } },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
      ],
      [
        { method: 'GET', path: '/x', body: { message: 'ABearer SYNTH-B2' } },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
      ],
      [
        { method: 'GET', path: '/x', body: { message: '1Bearer SYNTH-B5' } },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
      ],
      [
        { method: 'GET', path: '/x', query: 'q=xBearer%20SYNTH-B3' },
        { method: 'GET', path: '/x', query: '[withheld]' },
        'request.query',
      ],
      [
        { method: 'GET', path: '/x/xBearer%20SYNTH-B4' },
        { method: 'GET', path: '[withheld]' },
        'request.path',
      ],
    ];
    for (const [request, expected, withheld] of cases) {
      const result = redactOk(afterRequest(request));
      assert.deepEqual(onlyCall(result.transcript).request, expected);
      assert.deepEqual(result.withheld, [`scenarios[0].calls[0].${withheld}`]);
      assertNoLeak(JSON.stringify(result), 'SYNTH-B');
    }
  });
});

describe('format characters and look-alikes do not hide a secret shape or name', () => {
  test('a zero-width, soft-hyphen or word-joiner character inside a JWT or Bearer value still withholds the whole value', () => {
    const cases: [object, object, string][] = [
      [
        { method: 'GET', path: '/x', query: 'q=eyJhbGci​Oi.abc.SYNTH-Z1' },
        { method: 'GET', path: '/x', query: '[withheld]' },
        'request.query',
      ],
      [
        { method: 'GET', path: '/x', query: 'q=eyJhbGci⁠Oi.abc.SYNTH-Z1' },
        { method: 'GET', path: '/x', query: '[withheld]' },
        'request.query',
      ],
      [
        { method: 'GET', path: '/x', query: 'q=Bearer​ SYNTH-Z1' },
        { method: 'GET', path: '/x', query: '[withheld]' },
        'request.query',
      ],
      [
        { method: 'GET', path: '/x', query: 'q=Bear​er SYNTH-Z1' },
        { method: 'GET', path: '/x', query: '[withheld]' },
        'request.query',
      ],
      [
        { method: 'GET', path: '/x', body: { message: 'Bearer​ SYNTH-Z1' } },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
      ],
      [
        { method: 'GET', path: '/x', body: { message: 'Bear​er SYNTH-Z1' } },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
      ],
      [
        { method: 'GET', path: '/x', body: { message: 'Bearer­ SYNTH-Z1' } },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
      ],
      [
        { method: 'GET', path: '/x', body: { message: 'Bear⁠er SYNTH-Z1' } },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
      ],
    ];
    for (const [request, expected, withheld] of cases) {
      const result = redactOk(afterRequest(request));
      assert.deepEqual(onlyCall(result.transcript).request, expected);
      assert.deepEqual(result.withheld, [`scenarios[0].calls[0].${withheld}`]);
      assertNoLeak(JSON.stringify(result), 'SYNTH-Z1');
    }
  });

  test('a format character or a fullwidth letter inside a credential parameter name is canonicalised before the name is judged', () => {
    const cases: [string, string][] = [
      ['to​ken=SYNTH-Z2', 'token=[withheld]'],
      ['ｔoken=SYNTH-Z2', 'token=[withheld]'],
    ];
    for (const [query, expected] of cases) {
      const result = redactOk(
        afterRequest({ method: 'GET', path: '/x', query }),
      );
      assert.deepEqual(onlyCall(result.transcript).request, {
        method: 'GET',
        path: '/x',
        query: expected,
      });
      assert.deepEqual(result.withheld, [
        'scenarios[0].calls[0].request.query',
      ]);
      assertNoLeak(JSON.stringify(result), 'SYNTH-Z2');
      assertNoLeak(JSON.stringify(result), 'ｔ');
    }
  });
});

describe('canonicalised keys and look-alikes in URL positions', () => {
  test('a zero-width or fullwidth spelling of a URL key still counts as that key, so its @ refuses by position', () => {
    const cases: [object, string][] = [
      [
        { method: 'GET', ['pa​th']: 'user:SYNTH-Y1@host/x' },
        'scenarios[0].calls[0].request.<field #2> (an @ in a URL)',
      ],
      [
        { method: 'GET', ['ｐａｔｈ']: 'user:SYNTH-Y1@host/x' },
        'scenarios[0].calls[0].request.<field #2> (an @ in a URL)',
      ],
    ];
    for (const [request, refusal] of cases) {
      const result = redactTranscript(afterRequest(request));
      assert.deepEqual(result, { ok: false, refusedPaths: [refusal] });
      assertNoLeak(JSON.stringify(result), 'SYNTH-Y1');
    }
  });

  test('a fullwidth location header key still counts as location, so its @ refuses by position', () => {
    const result = redactTranscript(
      transcriptOf(
        call(
          'after',
          { method: 'GET', path: '/x' },
          {
            status: 302,
            headers: {
              ['ｌｏｃａｔｉｏｎ']: 'https://u:SYNTH-Y1@h.example/x',
            },
          },
        ),
      ),
    );
    assert.deepEqual(result, {
      ok: false,
      refusedPaths: [
        'scenarios[0].calls[0].response.headers.<field #1> (an @ in a URL)',
      ],
    });
    assertNoLeak(JSON.stringify(result), 'SYNTH-Y1');
  });

  test('a fullwidth query key still counts as query, so its credential parameter is withheld and its value absent', () => {
    const result = redactOk(
      afterRequest({
        method: 'GET',
        ['ｑｕｅｒｙ']: 'token=SYNTH-Y1',
      }),
    );
    assert.deepEqual(onlyCall(result.transcript).request, {
      method: 'GET',
      ['ｑｕｅｒｙ']: 'token=[withheld]',
    });
    assert.deepEqual(result.withheld, [
      'scenarios[0].calls[0].request.<field #2>',
    ]);
    assertNoLeak(JSON.stringify(result), 'SYNTH-Y1');
  });

  test('raw U+FE6B, U+FF20 and fullwidth %40 inside a query value or a location header refuse as an @', () => {
    const queryForms = [
      'q=https://u:SYNTH-Y1﹫h/x',
      'q=https://u:SYNTH-Y1＠h/x',
      'q=https://u:SYNTH-Y1％４０h/x',
    ];
    for (const query of queryForms) {
      const result = redactTranscript(
        afterRequest({ method: 'GET', path: '/x', query }),
      );
      assert.deepEqual(
        result,
        {
          ok: false,
          refusedPaths: ['scenarios[0].calls[0].request.query (an @ in a URL)'],
        },
        query,
      );
      assertNoLeak(JSON.stringify(result), 'SYNTH-Y1');
    }

    const locationForms = [
      'https://u:SYNTH-Y1﹫h/x',
      'https://u:SYNTH-Y1＠h/x',
      'https://u:SYNTH-Y1％４０h/x',
    ];
    for (const location of locationForms) {
      const result = redactTranscript(
        transcriptOf(
          call(
            'after',
            { method: 'GET', path: '/x' },
            { status: 302, headers: { location } },
          ),
        ),
      );
      assert.deepEqual(
        result,
        {
          ok: false,
          refusedPaths: [
            'scenarios[0].calls[0].response.headers.location (an @ in a URL)',
          ],
        },
        location,
      );
      assertNoLeak(JSON.stringify(result), 'SYNTH-Y1');
    }
  });

  test('zero-width, soft-hyphen and word-joiner characters inside a JWT or Bearer in a path, or a JWT in body.message, withhold the whole value', () => {
    const cases: [object, object, string][] = [
      [
        { method: 'GET', path: '/x/eyJhbGci​Oi.abc.SYNTH-Y2' },
        { method: 'GET', path: '[withheld]' },
        'request.path',
      ],
      [
        { method: 'GET', path: '/x/eyJhbGci⁠Oi.abc.SYNTH-Y2' },
        { method: 'GET', path: '[withheld]' },
        'request.path',
      ],
      [
        { method: 'GET', path: '/x/eyJhbGci­Oi.abc.SYNTH-Y2' },
        { method: 'GET', path: '[withheld]' },
        'request.path',
      ],
      [
        { method: 'GET', path: '/x/Bear​er%20SYNTH-Y2' },
        { method: 'GET', path: '[withheld]' },
        'request.path',
      ],
      [
        { method: 'GET', path: '/x/Bear⁠er%20SYNTH-Y2' },
        { method: 'GET', path: '[withheld]' },
        'request.path',
      ],
      [
        { method: 'GET', path: '/x/Bear­er%20SYNTH-Y2' },
        { method: 'GET', path: '[withheld]' },
        'request.path',
      ],
      [
        {
          method: 'GET',
          path: '/x',
          body: { message: 'eyJhbGci​Oi.abc.SYNTH-Y2' },
        },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
      ],
      [
        {
          method: 'GET',
          path: '/x',
          body: { message: 'eyJhbGci⁠Oi.abc.SYNTH-Y2' },
        },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
      ],
      [
        {
          method: 'GET',
          path: '/x',
          body: { message: 'eyJhbGci­Oi.abc.SYNTH-Y2' },
        },
        { method: 'GET', path: '/x', body: { message: '[withheld]' } },
        'request.body.message',
      ],
    ];
    for (const [request, expected, withheld] of cases) {
      const result = redactOk(afterRequest(request));
      assert.deepEqual(
        onlyCall(result.transcript).request,
        expected,
        JSON.stringify(request),
      );
      assert.deepEqual(result.withheld, [`scenarios[0].calls[0].${withheld}`]);
      assertNoLeak(JSON.stringify(result), 'SYNTH-Y2');
    }
  });
});

describe('canonical', () => {
  test('folds look-alike @ and percent characters with NFKC', () => {
    assert.equal(canonical('﹫'), '@');
    assert.equal(canonical('＠'), '@');
    assert.equal(canonical('％４０'), '%40');
  });

  test('strips format characters: zero-width space, soft hyphen and word joiner', () => {
    assert.equal(canonical('a​b­c⁠d'), 'abcd');
  });

  test('leaves plain ASCII unchanged', () => {
    const plain = 'https://h/x?a=1-2_3.4&b=c';
    assert.equal(canonical(plain), plain);
  });

  test('is idempotent', () => {
    const once = canonical('a​﹫％４０');
    assert.equal(canonical(once), once);
  });
});

describe('URL-typed strings outside path and query', () => {
  test('a free-text string starting with a scheme or an encoded slash is judged as a URL', () => {
    const result = redactOk(
      afterRequest({
        method: 'POST',
        path: '/x',
        body: {
          title: 'https://example.test/x?token=SYNTH-T01',
          description: '%2Fx%3Fpage%3D2%26token%3DSYNTH-T02',
        },
      }),
    );
    assert.deepEqual(onlyCall(result.transcript).request, {
      method: 'POST',
      path: '/x',
      body: {
        title: 'https://example.test/x?token=[withheld]',
        description: '/x?page=2&token=[withheld]',
      },
    });
    assert.deepEqual(result.withheld, [
      'scenarios[0].calls[0].request.body.title',
      'scenarios[0].calls[0].request.body.description',
    ]);
    assertNoLeak(JSON.stringify(result), 'SYNTH-T01');
    assertNoLeak(JSON.stringify(result), 'SYNTH-T02');
  });

  test('a location header is URL-typed: its token parameter is withheld and page is kept', () => {
    const result = redactOk(
      transcriptOf(
        call(
          'after',
          { method: 'GET', path: '/x' },
          {
            status: 302,
            headers: { location: '/x?page=2&token=SYNTH-T03' },
          },
        ),
      ),
    );
    assert.deepEqual(onlyCall(result.transcript).response, {
      status: 302,
      headers: { location: '/x?page=2&token=[withheld]' },
    });
    assertNoLeak(JSON.stringify(result), 'SYNTH-T03');
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
  test('a null under a ciphertext key becomes [ciphertext]', () => {
    const input = transcriptOf(
      call(
        'after',
        { method: 'PUT', path: '/api/vault' },
        { status: 200, body: { ciphertext: null } },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(onlyCall(result.transcript).response, {
      status: 200,
      body: { ciphertext: '[ciphertext]' },
    });
    assert.deepEqual(result.shortened, [
      'scenarios[0].calls[0].response.body.ciphertext',
    ]);
  });

  test('a 3-character Ciphertext has an empty prefix', () => {
    const input = transcriptOf(
      call(
        'after',
        { method: 'PUT', path: '/api/vault' },
        { status: 200, body: { ciphertext: 'abc' } },
      ),
    );
    const result = redactOk(input);
    assert.deepEqual(onlyCall(result.transcript).response, {
      status: 200,
      body: { ciphertext: '…[ciphertext, 3 chars]' },
    });
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
      refusedPaths: ['scenarios[0].calls[1].response.body.items[2] key #2'],
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
      refusedPaths: ['scenarios[0].calls[0].request key #3', 'key #2'],
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
