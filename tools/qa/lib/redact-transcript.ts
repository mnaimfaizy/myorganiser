/**
 * The Request Transcript redactor (ADR 0147 decision 7).
 *
 * A Request Transcript is the QA Artifact for an API change: the calls a
 * scenario made and what came back, Before and After. It goes inline in the
 * QA Report, so every field is decided mechanically, from an allow-list. A
 * field is exactly one of:
 *
 *   - safe: recognised, and passed through unchanged;
 *   - withhold: a credential, cookie, token or authorization header, replaced
 *     by a marker (its whole subtree, so nothing under it is read);
 *   - ciphertext: Ciphertext, shortened to a short prefix and its length.
 *
 * Any other field is unknown, and one unknown field refuses the whole
 * transcript: nothing is rendered. A refusal names each field's path and never
 * its value, as the Host Apply log scanner withholds on a violation
 * (tools/scripts/lib/host-apply.ts). The path does include the field's own
 * key, so a map keyed by something sensitive would echo that key: the allow-
 * list is for fields with fixed names, not for maps keyed by data.
 *
 * Classification is by the key, case-insensitively, with one exception: a
 * string under a safe key that looks like a bearer credential or a JWT is
 * withheld anyway, because a safe name does not make a value safe.
 *
 * Pure: nothing touches disk or a process. The command-line wrapper is
 * tools/qa/redact-transcript.ts.
 *
 * Input:
 *   { "scenarios": [{ "id": "S1", "calls": [{
 *       "side": "before" | "after",
 *       "request":  { "method", "path", "query"?, "headers"?, "body"? },
 *       "response": { "status", "headers"?, "body"? } }] }] }
 */

export const FIELD_CLASSES = ['safe', 'withhold', 'ciphertext'] as const;
export type FieldClass = (typeof FIELD_CLASSES)[number];

/** A field no rule recognises; it refuses the transcript. */
type Classification = FieldClass | 'unknown';

export const WITHHELD_MARKER = '[withheld]';
export const CIPHERTEXT_PREFIX_LENGTH = 8;

/** Keys whose value is a credential, in any casing or separator style. */
const CREDENTIAL_KEY =
  /authorization|cookie|token|secret|password|passwd|api[-_]?key|credential|session|jwt|csrf|xsrf|bearer|signature/i;

/** Keys whose value is Ciphertext (CONTEXT.md: server-storable only). */
const CIPHERTEXT_KEYS = new Set(
  [
    'ciphertext',
    'encryptedBlob',
    'encryptedData',
    'encryptedVault',
    'wrappedMasterKey',
    'iv',
    'nonce',
  ].map((key) => key.toLowerCase()),
);

/**
 * Keys recognised as safe: the transcript's own structure, ordinary HTTP
 * headers, and the plain fields API responses carry. Extending the list is a
 * deliberate edit here, never a runtime option.
 */
const SAFE_KEYS = new Set(
  [
    // transcript structure
    'scenarios',
    'id',
    'calls',
    'side',
    'request',
    'response',
    'method',
    'path',
    'query',
    'headers',
    'body',
    'status',
    // headers
    'accept',
    'content-type',
    'content-length',
    'date',
    'etag',
    'cache-control',
    'location',
    'vary',
    'x-request-id',
    // query and body fields
    'email',
    'name',
    'title',
    'description',
    'message',
    'error',
    'code',
    'type',
    'items',
    'data',
    'count',
    'total',
    'page',
    'limit',
    'offset',
    'version',
    'done',
    'completed',
    'archived',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'userId',
  ].map((key) => key.toLowerCase()),
);

/**
 * A string value shaped like a credential, whatever key holds it: a Bearer or
 * Basic header value, a JWT, or a URL or query string carrying a credential
 * parameter (`?token=…`, `&session=…`), which a safe `path` or `query` string
 * could otherwise smuggle through.
 */
const CREDENTIAL_VALUE = new RegExp(
  `^(?:Bearer|Basic)\\s+\\S|^eyJ[\\w-]+\\.[\\w-]+\\.[\\w-]*$|[?&;][^=&;\\s]*(?:${CREDENTIAL_KEY.source})[^=&;\\s]*=`,
  'i',
);

export function classifyKey(key: string): Classification {
  const lower = key.toLowerCase();
  if (CREDENTIAL_KEY.test(lower)) return 'withhold';
  if (CIPHERTEXT_KEYS.has(lower)) return 'ciphertext';
  if (SAFE_KEYS.has(lower)) return 'safe';
  return 'unknown';
}

/**
 * Ciphertext shortened: a short prefix and the length, never the rest. The
 * prefix is at most CIPHERTEXT_PREFIX_LENGTH characters and never more than a
 * quarter of the value, so a short value is not shown whole.
 */
export function shortenCiphertext(value: unknown): string {
  if (typeof value !== 'string') return '[ciphertext]';
  const prefix = value.slice(
    0,
    Math.min(CIPHERTEXT_PREFIX_LENGTH, Math.floor(value.length / 4)),
  );
  return `${prefix}…[ciphertext, ${value.length} chars]`;
}

/** One handler per class (ADR 0053): a new class must say what it does. */
const HANDLE = {
  safe: (value: unknown) => value,
  withhold: () => WITHHELD_MARKER,
  ciphertext: shortenCiphertext,
} as const satisfies Record<FieldClass, (value: unknown) => unknown>;

export interface RedactionOutcome {
  /** The result union's discriminant: the transcript was redacted in full. */
  ok: true;
  transcript: unknown;
  withheld: string[];
  shortened: string[];
}

export interface RedactionRefusal {
  ok: false;
  /** Paths of fields no rule recognises. Never their values. */
  refusedPaths: string[];
}

export type RedactionResult = RedactionOutcome | RedactionRefusal;

function childPath(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`;
}

export function redactTranscript(input: unknown): RedactionResult {
  const refusedPaths: string[] = [];
  const withheld: string[] = [];
  const shortened: string[] = [];

  function walkValue(value: unknown, path: string): unknown {
    if (Array.isArray(value)) {
      return value.map((item, index) => walkValue(item, `${path}[${index}]`));
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        const here = childPath(path, key);
        const fieldClass = classifyKey(key);
        if (fieldClass === 'unknown') {
          refusedPaths.push(here);
          continue;
        }
        if (fieldClass === 'withhold') withheld.push(here);
        if (fieldClass === 'ciphertext') shortened.push(here);
        out[key] =
          fieldClass === 'safe'
            ? walkValue(child, here)
            : HANDLE[fieldClass](child);
      }
      return out;
    }
    if (typeof value === 'string' && CREDENTIAL_VALUE.test(value)) {
      withheld.push(path);
      return WITHHELD_MARKER;
    }
    return value;
  }

  const transcript = walkValue(input, '');
  if (refusedPaths.length > 0) return { ok: false, refusedPaths };
  return { ok: true, transcript, withheld, shortened };
}

export class TranscriptInputError extends Error {}

interface Call {
  side: string;
  request: unknown;
  response: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Checks the transcript's shape before any field is classified. */
export function parseTranscriptInput(input: unknown): void {
  if (!isRecord(input) || !Array.isArray(input.scenarios)) {
    throw new TranscriptInputError('input needs a "scenarios" array');
  }
  input.scenarios.forEach((scenario, s) => {
    if (
      !isRecord(scenario) ||
      typeof scenario.id !== 'string' ||
      !Array.isArray(scenario.calls)
    ) {
      throw new TranscriptInputError(
        `scenarios[${s}] needs a string "id" and a "calls" array`,
      );
    }
    scenario.calls.forEach((call: unknown, c) => {
      const where = `scenarios[${s}].calls[${c}]`;
      if (
        !isRecord(call) ||
        (call.side !== 'before' && call.side !== 'after') ||
        !isRecord(call.request) ||
        !isRecord(call.response)
      ) {
        throw new TranscriptInputError(
          `${where} needs a "side" of before or after, a "request" and a "response"`,
        );
      }
    });
  });
}

/** A code fence longer than any backtick run inside, so content cannot end it. */
function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * A redacted transcript as a collapsed block for the QA Report. Inline, never
 * uploaded (ADR 0147 decision 7).
 */
export function renderTranscript(transcript: unknown): string {
  const scenarios = (
    transcript as { scenarios: { id: string; calls: Call[] }[] }
  ).scenarios;
  const lines: string[] = [
    '<details>',
    '<summary>Request Transcript</summary>',
    '',
  ];
  for (const scenario of scenarios) {
    lines.push(`#### ${scenario.id}`, '');
    for (const call of scenario.calls) {
      const body = JSON.stringify(
        { request: call.request, response: call.response },
        null,
        2,
      );
      const fence = fenceFor(body);
      lines.push(
        `**${call.side === 'before' ? 'Before' : 'After'}**`,
        '',
        `${fence}json`,
        body,
        fence,
        '',
      );
    }
  }
  lines.push('</details>', '');
  return lines.join('\n');
}
