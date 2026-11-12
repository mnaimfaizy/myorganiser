// Generated encoding corpus for the Request Transcript redactor (ADR 0147
// decision 7). The hand-written contracts are in ./redact-transcript.test.ts;
// this suite is the generated one. It crosses a carrier (where the credential
// sits: a path, a query, a location header, a JSON body) with a payload (how
// the credential is written: its name, separators, value and encoding), and
// asserts one invariant over every case: the sentinel never appears in the
// output. On an `ok` result it is absent from JSON.stringify(result) and from
// renderTranscript(result.transcript); on a refusal it is absent from
// JSON.stringify(result). A refusal is an acceptable outcome; a leak is not.
// The control test proves the detector can fail.
//
// Out of scope, as the redactor's header declares, so nothing here asserts it:
// free text under a non-URL safe key that is not Bearer-, Basic- or JWT-shaped
// (a query-like `?token=` inside `message`), form-encoded string bodies, and
// scenario ids. Those are the only exclusions: no family is narrowed to what
// the redactor handles today, so a gap fails its family.
//
// Sentinels are visibly synthetic (`ZQ01001-SYNTH`), at least 8 characters so
// that a Bearer or Basic value is credential-shaped, and unique per case, so a
// failure message names the one encoding that leaked.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  redactTranscript,
  renderTranscript,
  type RedactionOutcome,
} from './redact-transcript.ts';

/** A named row of a corpus table; the name appears in every case id. */
type Row<T> = readonly [string, T];

interface Case {
  id: string;
  input: unknown;
  sentinel: string;
}

/** The sentinel for case `index` of `family`, unique across the corpus. */
function sentinelFor(family: number, index: number): string {
  return `ZQ${String(family).padStart(2, '0')}${String(index).padStart(3, '0')}-SYNTH`;
}

function afterCall(request: object, response: object = { status: 200 }) {
  return {
    scenarios: [{ id: 'S1', calls: [{ side: 'after', request, response }] }],
  };
}

function redactOk(input: unknown): RedactionOutcome {
  const result = redactTranscript(input);
  if (!result.ok) {
    throw new Error(`unexpected refusal: ${result.refusedPaths.join(', ')}`);
  }
  return result;
}

/** `text` percent-encoded `levels` times, so decoding it takes that many passes. */
function encodedTimes(text: string, levels: number): string {
  let encoded = text;
  for (let level = 0; level < levels; level++) {
    encoded = encodeURIComponent(encoded);
  }
  return encoded;
}

/** The hex digits of every %XX in `text`, lowercased. */
function lowerHex(text: string): string {
  return text.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
}

/**
 * Crosses carriers with payloads. Each case is numbered inside its family, so
 * its sentinel is unique, and its id names both halves.
 */
function corpus<P>(
  family: number,
  carriers: readonly Row<(payload: P) => object>[],
  payloads: readonly Row<(sentinel: string) => P>[],
): Case[] {
  const cases: Case[] = [];
  for (const [carrierName, carrier] of carriers) {
    for (const [payloadName, payload] of payloads) {
      const sentinel = sentinelFor(family, cases.length + 1);
      cases.push({
        id: `${carrierName} \u00d7 ${payloadName}`,
        input: carrier(payload(sentinel)),
        sentinel,
      });
    }
  }
  return cases;
}

/** The invariant, for every case. A failure names the case id and sentinel. */
function assertNoLeakInEveryCase(cases: readonly Case[]) {
  assert.ok(cases.length > 0, 'the corpus generated no cases');
  const ids = new Set(cases.map((c) => c.id));
  assert.equal(ids.size, cases.length, 'two generated cases share an id');
  for (const { id, input, sentinel } of cases) {
    let result;
    try {
      result = redactTranscript(input);
    } catch (error) {
      throw new Error(`case ${id}: the redactor threw: ${String(error)}`);
    }
    assert.ok(
      !JSON.stringify(result).includes(sentinel),
      `case ${id}: sentinel ${sentinel} leaked into the redaction result`,
    );
    if (result.ok) {
      assert.ok(
        !renderTranscript(result.transcript).includes(sentinel),
        `case ${id}: sentinel ${sentinel} leaked into the rendered transcript`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Payloads that encode a credential-named URL parameter (families 1-4).
// ---------------------------------------------------------------------------

/**
 * Transforms on the URL-typed credential parameter: its name, its separators
 * and its value. Each keeps `page=2` beside it, so the safe parameter is in
 * every case.
 */
const PARAMETER_TRANSFORMS: readonly Row<(sentinel: string) => string>[] = [
  ['raw', (s) => `page=2&token=${s}`],
  ...[1, 2, 3, 4, 5].map(
    (levels): Row<(sentinel: string) => string> => [
      `${levels} encoding level${levels === 1 ? '' : 's'}`,
      (s) => `page=2&${encodedTimes(`token=${s}`, levels)}`,
    ],
  ),
  // Past MAX_DECODE_PASSES (5): decoding cannot finish, so the redactor refuses.
  [
    '6 encoding levels, past the cap',
    (s) => `page=2&${encodedTimes(`token=${s}`, 6)}`,
  ],
  [
    '1 encoding level, lowercase hex',
    (s) => `page=2&${lowerHex(encodedTimes(`token=${s}`, 1))}`,
  ],
  [
    '2 encoding levels, lowercase hex',
    (s) => `page=2&${lowerHex(encodedTimes(`token=${s}`, 2))}`,
  ],
  ['& as %26', (s) => `page=2%26token=${s}`],
  ['& as %3B', (s) => `page=2%3Btoken=${s}`],
  ['& as %23', (s) => `page=2%23token=${s}`],
  ['& as %2526', (s) => `page=2%2526token=${s}`],
  ['& as UTF-8 %EF%BC%86', (s) => `page=2%EF%BC%86token=${s}`],
  ['& as fullwidth U+FF06', (s) => `page=2\uff06token=${s}`],
  ['= as %3D', (s) => `page=2&token%3D${s}`],
  ['= as %253D', (s) => `page=2&token%253D${s}`],
  ['= as fullwidth U+FF1D', (s) => `page=2&token\uff1d${s}`],
  ['name fullwidth', (s) => `page=2&\uff54\uff4f\uff4b\uff45\uff4e=${s}`],
  [
    'name fullwidth, encoded',
    (s) =>
      `page=2&${encodeURIComponent('\uff54\uff4f\uff4b\uff45\uff4e')}=${s}`,
  ],
  ['name with U+200B', (s) => `page=2&to\u200bken=${s}`],
  ['name with U+FEFF', (s) => `page=2&to\ufeffken=${s}`],
  ['name with U+200B, encoded', (s) => `page=2&to%E2%80%8Bken=${s}`],
  ['name in capitals', (s) => `page=2&TOKEN=${s}`],
  ['value with %40 after it', (s) => `page=2&token=${s}%40h`],
];

const PATH_STRING: Row<(url: string) => object> = [
  'path string',
  (url) => afterCall({ method: 'GET', path: `/x?${url}` }),
];
const QUERY_STRING: Row<(url: string) => object> = [
  'query string',
  (url) => afterCall({ method: 'GET', path: '/x', query: url }),
];
const LOCATION_STRING: Row<(url: string) => object> = [
  'location header',
  (url) =>
    afterCall(
      { method: 'GET', path: '/x' },
      { status: 302, headers: { location: `/x?${url}` } },
    ),
];

const STRING_ARRAY_CARRIERS: readonly Row<(url: string) => object>[] = [
  ['path array', (url) => afterCall({ method: 'GET', path: [`/x?${url}`] })],
  [
    'query array',
    (url) => afterCall({ method: 'GET', path: '/x', query: [url] }),
  ],
  [
    'location header array',
    (url) =>
      afterCall(
        { method: 'GET', path: '/x' },
        { status: 302, headers: { location: [`/x?${url}`] } },
      ),
  ],
];

// ---------------------------------------------------------------------------
// Payloads for a credential-named JSON key (family 5).
// ---------------------------------------------------------------------------

const CREDENTIAL_KEYS: readonly Row<string>[] = [
  ['accessToken', 'accessToken'],
  ['Access-Token', 'Access-Token'],
  ['access + U+200B + Token', 'access\u200bToken'],
  ['fullwidth first letter', '\uff41ccessToken'],
];

const CREDENTIAL_SHAPES: readonly Row<(key: string, s: string) => unknown>[] = [
  ['direct key', (key, s) => ({ [key]: s })],
  ['key in an array item', (key, s) => ({ items: [{ [key]: s }] })],
  ['key with an object value', (key, s) => ({ [key]: { value: s } })],
];

const JSON_PAYLOADS: readonly Row<(sentinel: string) => unknown>[] =
  CREDENTIAL_KEYS.flatMap(([keyName, key]) =>
    CREDENTIAL_SHAPES.map(
      ([shapeName, shape]): Row<(sentinel: string) => unknown> => [
        `${keyName}, ${shapeName}`,
        (s) => shape(key, s),
      ],
    ),
  );

const BODY_CARRIERS: readonly Row<(body: unknown) => object>[] = [
  ['request body', (body) => afterCall({ method: 'POST', path: '/x', body })],
  [
    'response body',
    (body) => afterCall({ method: 'GET', path: '/x' }, { status: 200, body }),
  ],
];

// ---------------------------------------------------------------------------
// Payloads for Bearer and Basic values (family 6).
// ---------------------------------------------------------------------------

const AUTH_SEPARATORS: readonly Row<string>[] = [
  ['space', ' '],
  ['%20', '%20'],
  ['+', '+'],
  ['%2520', '%2520'],
  ['no-break space U+00A0', '\u00a0'],
  ['none', ''],
  ['zero-width space U+200B', '\u200b'],
  ['zero-width space, encoded', '%E2%80%8B'],
  ['BOM U+FEFF', '\ufeff'],
];

const AUTH_PAYLOADS: readonly Row<(sentinel: string) => string>[] = [
  'Bearer',
  'Basic',
].flatMap((scheme) =>
  AUTH_SEPARATORS.map(
    ([sepName, sep]): Row<(sentinel: string) => string> => [
      `${scheme}, ${sepName}`,
      (s) => `${scheme}${sep}${s}`,
    ],
  ),
);

const AUTH_CARRIERS: readonly Row<(value: string) => object>[] = [
  [
    'message',
    (value) =>
      afterCall({ method: 'POST', path: '/x', body: { message: value } }),
  ],
  [
    'description',
    (value) =>
      afterCall({ method: 'POST', path: '/x', body: { description: value } }),
  ],
  [
    'path segment',
    (value) => afterCall({ method: 'GET', path: `/x/${value}` }),
  ],
  [
    'query value',
    (value) => afterCall({ method: 'GET', path: '/x', query: `page=${value}` }),
  ],
];

// ---------------------------------------------------------------------------
// Payloads for a JWT (family 7).
// ---------------------------------------------------------------------------

const jwtOf = (s: string) => `eyJhbGciOi.eyJzdWIi.${s}`;

const JWT_PAYLOADS: readonly Row<(sentinel: string) => string>[] = [
  ['raw dots', jwtOf],
  ['dots as %2E', (s) => jwtOf(s).split('.').join('%2E')],
  ['dots as fullwidth U+FF0E', (s) => jwtOf(s).split('.').join('\uff0e')],
  ['U+200B after eyJ', (s) => jwtOf(s).replace('eyJ', 'eyJ\u200b')],
];

const JWT_CARRIERS: readonly Row<(token: string) => object>[] = [
  [
    'path segment',
    (token) => afterCall({ method: 'GET', path: `/x/${token}` }),
  ],
  [
    'message',
    (token) =>
      afterCall({ method: 'POST', path: '/x', body: { message: token } }),
  ],
  [
    'description',
    (token) =>
      afterCall({ method: 'POST', path: '/x', body: { description: token } }),
  ],
];

// ---------------------------------------------------------------------------
// Payloads for URL userinfo (family 8). Any `@` refuses the transcript.
// ---------------------------------------------------------------------------

const USERINFO_COLONS: readonly Row<string>[] = [
  ['colon', ':'],
  ['colon as %3A', '%3A'],
  ['colon as fullwidth U+FF1A', '\uff1a'],
];

const USERINFO_AT_SIGNS: readonly Row<string>[] = [
  ['@', '@'],
  ['@ as %40', '%40'],
  ['@ as %2540', '%2540'],
  ['@ as fullwidth U+FF20', '\uff20'],
  ['@ as fullwidth %40', '\uff05\uff14\uff10'],
];

const USERINFO_PAYLOADS: readonly Row<(sentinel: string) => string>[] =
  USERINFO_COLONS.flatMap(([colonName, colon]) =>
    USERINFO_AT_SIGNS.map(
      ([atName, at]): Row<(sentinel: string) => string> => [
        `${colonName}, ${atName}`,
        (s) => `https://u${colon}${s}${at}h.example/x`,
      ],
    ),
  );

const USERINFO_CARRIERS: readonly Row<(url: string) => object>[] = [
  ['path', (url) => afterCall({ method: 'GET', path: url })],
  [
    'location header',
    (url) =>
      afterCall(
        { method: 'GET', path: '/x' },
        { status: 302, headers: { location: url } },
      ),
  ],
];

describe('Request Transcript redactor, generated encoding corpus', () => {
  test('a credential parameter in a path string never leaks, under any encoding', () => {
    assertNoLeakInEveryCase(corpus(1, [PATH_STRING], PARAMETER_TRANSFORMS));
  });

  test('a credential parameter in a query string never leaks, under any encoding', () => {
    assertNoLeakInEveryCase(corpus(2, [QUERY_STRING], PARAMETER_TRANSFORMS));
  });

  test('a credential parameter in a location header never leaks, under any encoding', () => {
    assertNoLeakInEveryCase(corpus(3, [LOCATION_STRING], PARAMETER_TRANSFORMS));
  });

  test('a credential parameter in a string array under path, query or location never leaks', () => {
    assertNoLeakInEveryCase(
      corpus(4, STRING_ARRAY_CARRIERS, PARAMETER_TRANSFORMS),
    );
  });

  test('a credential-named JSON key is withheld in every spelling and shape', () => {
    assertNoLeakInEveryCase(corpus(5, BODY_CARRIERS, JSON_PAYLOADS));
  });

  test('a Bearer or Basic value never leaks, under any separator, carrier or invisible character', () => {
    assertNoLeakInEveryCase(corpus(6, AUTH_CARRIERS, AUTH_PAYLOADS));
  });

  test('a JWT in a path segment or under a safe key never leaks', () => {
    assertNoLeakInEveryCase(corpus(7, JWT_CARRIERS, JWT_PAYLOADS));
  });

  test('URL userinfo in a path or location never leaks, under any @ spelling', () => {
    assertNoLeakInEveryCase(corpus(8, USERINFO_CARRIERS, USERINFO_PAYLOADS));
  });

  test('control: a sentinel under a safe name reaches the output, so the absence checks can fail', () => {
    const sentinel = 'ZQ00000-SYNTH';
    const result = redactOk(
      afterCall({ method: 'GET', path: `/x?page=${sentinel}` }),
    );
    assert.ok(
      JSON.stringify(result).includes(sentinel),
      'control: the sentinel under the safe name page is missing from the redaction result',
    );
    assert.ok(
      renderTranscript(result.transcript).includes(sentinel),
      'control: the sentinel under the safe name page is missing from the rendered transcript',
    );
  });
});
