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
 * transcript: nothing is rendered. A refusal names where the problem is and
 * never its value or its name, as the Host Apply log scanner withholds on a
 * violation (tools/scripts/lib/host-apply.ts).
 *
 * Classification is by the key, case-insensitively. Every string goes through
 * ONE normalisation (`canonical`: NFKC, then format characters stripped) at
 * every decode level before any check sees it.
 *
 * URL-typed strings. A string under `path`, `query` or the `location` header,
 * or any string that (once decoded) starts with `/`, `?`, `#` or `scheme://`,
 * is a URL. It is decoded a bounded number of times (MAX_DECODE_PASSES, until
 * it stops changing; a malformed `%` is left as a literal and never throws),
 * then split on `? # & ;` into parameters. Each parameter NAME goes through the
 * same allow-list as a field name: safe keeps the value, a credential, cookie
 * or token name withholds it, and any other name refuses the transcript. A
 * string still changing after the cap refuses too. So an encoded separator
 * (`%3B`, `%3D`, `%2526`) cannot hide a parameter: it is decoded before the
 * split. `&amp;` refuses because `amp` is an unknown name; that is deliberate
 * fail-closed behaviour. There is no value deny-list for URLs.
 *
 * Any `@` in a URL-typed string (at any decode level: `@`, `%40`, fullwidth
 * `＠`) refuses the whole transcript, wherever it sits (authority, path, query,
 * fragment). Userinfo (`https://user:pass@host`) has too loose a grammar to
 * parse safely, so there is no parsing, rewrite or exception: a legitimate `@`
 * in a URL refuses too. A withheld object key that is not a clean credential
 * word prints as `<field #n>`. A string array inherits its parent key, so
 * `query: ["a=1"]` is URL-typed like `query: "a=1"`. A credential-named
 * parameter has its whole segment withheld, except when its name is a clean
 * credential word (CLEAN_CREDENTIAL_NAMES), when it prints as
 * `name=[withheld]`; `code` is not a safe name (an OAuth code is a credential).
 *
 * Out of scope: free text under a non-URL safe key (`message`, `description`).
 * `page=2 token=abc` separated by spaces in such a field passes unchanged; the
 * premise is QA Account data only, and only URL-typed values are parsed. A
 * form-encoded string body (`body: "a=b&…"`) is out of scope too: the web
 * client sends JSON, and JSON bodies are covered field by field.
 *
 * The one value-shape check. Any string, URL or not, is withheld if it holds
 * `Bearer` or `Basic` followed by a credential-shaped value anywhere in it
 * (a mid-string `x Bearer V`, a decoded `q=Bearer%20V`), or if a JWT or JWE
 * (`eyJ…` then 2 or more dot-separated parts) appears anywhere in it. A
 * parameter allow-list cannot reach these: they are secrets by shape, under a
 * perfectly safe name or in the middle of a path.
 *
 * Known secrets (#1554). A caller that knows the exact values a run must never
 * show (`qa:run`: the password and vault passphrase of each QA Account a
 * scenario looked up, and every `secret()` value) passes them as
 * `knownSecrets`. On top of the rules above, never instead of them: a string
 * they refuse still refuses, and any other string holding one as an exact
 * substring is withheld whole, as is a Ciphertext value with one anywhere in
 * it. Encoded, split or case-changed variants are out of scope on
 * purpose, as in the caption privacy check. Without the option (`qa:redact`)
 * nothing changes.
 *
 * A refusal never echoes an unrecognised name. An unknown field is reported as
 * its containing path plus `key #n`, an unknown parameter as the string's path
 * plus `parameter #n`, an `@` as the string's path plus `(an @ in a URL)`, so a
 * key or parameter that IS a token prints none of itself. The input file shows
 * which one #n is. (Recognised keys, which are all on a list, do appear in
 * paths.)
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
    // vault key-derivation and wrapped master keys (#1515). kdf_params and the
    // wrapped_mk_* values are open JSON on the server, so they are shortened as
    // one value: no nested key or value is read or printed.
    'kdf_salt',
    'kdf_params',
    'wrapped_mk_passphrase',
    'wrapped_mk_recovery',
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
    // response bodies of sign-in, YouTube availability and the vault (#1515).
    // `user`, `blobs` and `meta` are containers: each nested key is classified
    // on its own. `phone` and `details` are left out on purpose.
    'expires_in',
    'available',
    'user',
    'firstName',
    'lastName',
    'disabled',
    'blobs',
    'meta',
    'kdf_name',
    // query parameters the backend reads (apps/backend @Query()). Left out on
    // purpose: cursor, channelId, trackingIssueNumber (opaque or id-like; the
    // runner, #1512, adds what real calls need). `code` is not safe anywhere.
    'pageSize',
    'sort',
    'kind',
    'search',
    'q',
    'role',
    'source',
    'event',
    'platform',
    'action',
  ].map((key) => key.toLowerCase()),
);

/**
 * A recognised key as it appears in a path. An unrecognised key or parameter
 * name is NEVER printed (see refusals): it could be a token.
 */
const IDENTIFIER_SHAPE = /^[a-z][a-z0-9_.-]{0,23}$/;
const MAX_PRINTED_DIGITS = 2;

function printable(name: string): string | null {
  const lower = name.toLowerCase();
  const digits = lower.replace(/\D/g, '').length;
  return IDENTIFIER_SHAPE.test(lower) && digits <= MAX_PRINTED_DIGITS
    ? name
    : null;
}

/**
 * A Bearer or Basic header value. The separator is optional: `canonical` strips
 * a format character, so `Bearer<U+200B>V` reaches this check as `BearerV`, and
 * a glued `BearerV` is no less a credential. A word glued to `bearer` or
 * `basic` in free text is withheld too, which is the safe direction.
 */
const AUTH_SCHEME_VALUE = /bearer[\s+]*\S|basic[\s+]*[a-z0-9+/=_-]{8,}/i;
/** A JWT or JWE anywhere in a string, however it is glued to its neighbours. */
const JWT = /eyJ[\w-]+(?:\.[\w-]*){2,}/;
/** `@`, its percent form, or the fullwidth look-alike. */
const AT_MARK = /@|%40|\uFF20/i;

/**
 * True if a URL-typed string holds an `@` at any decode level, anywhere in it.
 * No parsing: a URL's authority grammar (extra or missing slashes, backslashes,
 * encodings) is too loose to pick userinfo out reliably, so any `@` refuses the
 * transcript, a legitimate one included. Never a rewrite, never an exception.
 */
function hasAtSign(value: string): boolean {
  let level = canonical(value);
  for (let pass = 0; pass <= MAX_DECODE_PASSES; pass++) {
    if (AT_MARK.test(level)) return true;
    level = decodeOnce(level);
  }
  return false;
}

/** A name lowercased with `-` and `_` removed, to compare with the clean list. */
function normalise(name: string): string {
  return canonical(name).toLowerCase().replace(/[-_]/g, '');
}

/**
 * Credential words that may be echoed beside `[withheld]`, with `-` and `_`
 * removed and lowercased. Any other credential-named parameter has its whole
 * segment withheld, since its name could itself be the secret.
 */
const CLEAN_CREDENTIAL_NAMES = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'password',
  'passwd',
  'secret',
  'apikey',
  'session',
  'sessionid',
  'signature',
  'authorization',
  'cookie',
  'jwt',
  'csrf',
  'csrftoken',
  'xsrf',
  'bearer',
  'credential',
  'credentials',
  'setcookie',
  'xapikey',
  'xauthtoken',
  'xsessionid',
  'xcsrftoken',
  'xxsrftoken',
  'proxyauthorization',
  'wwwauthenticate',
  'clientsecret',
  'sessiontoken',
]);

/** True if a credential-named key is a clean credential word, safe to echo. */
function isCleanCredentialName(name: string): boolean {
  return CLEAN_CREDENTIAL_NAMES.has(normalise(name));
}

export const MAX_DECODE_PASSES = 5;
const URL_TYPED_KEYS = new Set(['path', 'query', 'location']);
const URL_START = /^(?:[/?#]|[a-z][a-z0-9+.-]*:\/\/)/i;

/**
 * THE normalisation step. Every check sees a string only after it has been
 * through here, at every decode level: NFKC (so `﹫` U+FE6B and `＠` U+FF20
 * become `@`, and `％４０` becomes `%40`), then format characters (`\p{Cf}`:
 * zero-width space, joiners, soft hyphen, tag characters…) stripped, so one
 * cannot be slipped into a JWT or after `Bearer`. decodeOnce, decodeBounded,
 * the `@` rule, the parameter split, name classification and the value-shape
 * checks all go through it; there are no per-check patches.
 */
export function canonical(value: string): string {
  return value.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

/** Decodes each run of valid %XX once. A malformed % stays a literal. */
function decodeOnce(value: string): string {
  const decoded = value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    const bytes = Uint8Array.from(
      run
        .slice(1)
        .split('%')
        .map((hex) => parseInt(hex, 16)),
    );
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    }
  });
  return canonical(decoded);
}

/** Decoded until it stops changing or the cap; `stable` is false at the cap. */
export function decodeBounded(value: string): {
  value: string;
  stable: boolean;
} {
  let current = canonical(value);
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    const next = decodeOnce(current);
    if (next === current) return { value: current, stable: true };
    current = next;
  }
  return { value: current, stable: decodeOnce(current) === current };
}

/** Whether a decoded string holds a Bearer/Basic value or a JWT. Exported for the caption privacy check; behaviour unchanged. */
export function looksLikeCredentialValue(decoded: string): boolean {
  return AUTH_SCHEME_VALUE.test(decoded) || JWT.test(decoded);
}

type UrlVerdict =
  | { kind: 'pass' }
  | { kind: 'withhold'; value: string }
  | { kind: 'refuse'; reasons: string[] };

/** Parameters of a decoded URL-typed string, each judged by its name. */
function judgeUrl(decoded: string, leadingIsParameter: boolean): UrlVerdict {
  const parts = decoded.split(/([?#&;])/);
  const reasons: string[] = [];
  let withheldAny = false;
  let position = 0;
  const rebuilt = parts.map((part, index) => {
    if (index % 2 === 1 || part === '') return part;
    const equals = part.indexOf('=');
    if (index === 0 && !leadingIsParameter && equals === -1) return part;
    position += 1;
    // Every piece but the last is a name: `page=token=V` hides a pair after a
    // second `=`, and a value can only be the last piece.
    const pieces = part.split('=');
    const names = pieces.slice(0, -1);
    const hasValue = equals !== -1;
    const judged = (hasValue ? names : pieces).map((piece, at) =>
      index === 0 && at === 0 ? piece.slice(piece.lastIndexOf('/') + 1) : piece,
    );
    let credential = false;
    for (const name of judged) {
      // An empty name (`?=V`) is on no allow-list: it refuses.
      const fieldClass = name === '' ? 'unknown' : classifyKey(name);
      if (fieldClass === 'unknown') {
        const reason = `parameter #${position}`;
        if (!reasons.includes(reason)) reasons.push(reason);
      } else if (fieldClass !== 'safe') {
        credential = true;
      }
    }
    if (!credential) return part;
    withheldAny = true;
    // A segment with no `=` is a bare name that may itself be the secret.
    const first = hasValue ? judged[0] : '';
    const clean =
      hasValue && judged.length === 1 && isCleanCredentialName(first);
    return clean ? `${first}=${WITHHELD_MARKER}` : WITHHELD_MARKER;
  });
  if (reasons.length > 0) return { kind: 'refuse', reasons };
  return withheldAny
    ? { kind: 'withhold', value: rebuilt.join('') }
    : { kind: 'pass' };
}

export function classifyKey(key: string): Classification {
  const lower = canonical(key).toLowerCase();
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

/** A key in a path, printed only if it is a plain identifier. */
function childPath(parent: string, key: string, index: number): string {
  const shown = printable(key) ?? `<field #${index + 1}>`;
  return parent === '' ? shown : `${parent}.${shown}`;
}

/**
 * Whether a string holds one of `secrets` as an exact substring. An empty
 * value is ignored: it is a substring of everything, so it can never be a
 * secret. Shared with the caption privacy check.
 */
export function holdsKnownSecret(
  text: string,
  secrets: readonly string[],
): boolean {
  return secrets.some((secret) => secret !== '' && text.includes(secret));
}

export interface RedactionOptions {
  /** Exact values no string may hold (`holdsKnownSecret`). Held in memory only. */
  knownSecrets?: readonly string[];
}

export function redactTranscript(
  input: unknown,
  options: RedactionOptions = {},
): RedactionResult {
  const refusedPaths: string[] = [];
  const withheld: string[] = [];
  const shortened: string[] = [];
  const knownSecrets = options.knownSecrets ?? [];
  const holdsSecret = (text: string): boolean =>
    holdsKnownSecret(text, knownSecrets);

  /** Whether any string or key in a subtree holds a known secret. */
  function subtreeHoldsKnownSecret(value: unknown): boolean {
    if (typeof value === 'string') return holdsSecret(value);
    if (Array.isArray(value)) return value.some(subtreeHoldsKnownSecret);
    if (value !== null && typeof value === 'object') {
      return Object.entries(value).some(
        ([key, child]) => holdsSecret(key) || subtreeHoldsKnownSecret(child),
      );
    }
    return false;
  }

  /**
   * The existing rules first: a string they refuse still refuses. Otherwise a
   * string holding a known secret is withheld whole.
   */
  function walkString(value: string, path: string, key: string): string {
    const refusedBefore = refusedPaths.length;
    const withheldBefore = withheld.length;
    const judged = applyStringRules(value, path, key);
    if (refusedPaths.length > refusedBefore || !holdsSecret(value)) {
      return judged;
    }
    if (withheld.length === withheldBefore) withheld.push(path);
    return WITHHELD_MARKER;
  }

  function applyStringRules(value: string, path: string, key: string): string {
    const decoded = decodeBounded(value);
    const urlTyped = URL_TYPED_KEYS.has(key) || URL_START.test(decoded.value);
    if (urlTyped && !decoded.stable) {
      refusedPaths.push(`${path} (does not finish decoding)`);
      return value;
    }
    if (!decoded.stable || looksLikeCredentialValue(decoded.value)) {
      withheld.push(path);
      return WITHHELD_MARKER;
    }
    if (!urlTyped) return value;
    if (hasAtSign(value)) {
      refusedPaths.push(`${path} (an @ in a URL)`);
      return value;
    }
    const verdict = judgeUrl(decoded.value, key === 'query');
    if (verdict.kind === 'refuse') {
      for (const reason of verdict.reasons) {
        refusedPaths.push(`${path} ${reason}`);
      }
      return value;
    }
    if (verdict.kind === 'withhold') {
      withheld.push(path);
      return verdict.value;
    }
    return value;
  }

  function walkValue(value: unknown, path: string, parentKey = ''): unknown {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        walkValue(item, `${path}[${index}]`, parentKey),
      );
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [index, [key, child]] of Object.entries(value).entries()) {
        const fieldClass = classifyKey(key);
        // A credential-word key that is not a clean credential name may itself
        // be the secret (`token=V`, `Bearer V`): it is never echoed.
        const hidden = fieldClass === 'withhold' && !isCleanCredentialName(key);
        const outKey = hidden ? `<field #${index + 1}>` : key;
        const here = hidden
          ? childPath(path, outKey, index)
          : childPath(path, key, index);
        if (fieldClass === 'unknown') {
          refusedPaths.push(`${path} key #${index + 1}`.trim());
          continue;
        }
        // Ciphertext is shortened, not walked: a known secret under it withholds it whole.
        if (fieldClass === 'ciphertext' && subtreeHoldsKnownSecret(child)) {
          withheld.push(here);
          out[outKey] = WITHHELD_MARKER;
          continue;
        }
        if (fieldClass === 'withhold') withheld.push(here);
        if (fieldClass === 'ciphertext') shortened.push(here);
        out[outKey] =
          fieldClass === 'safe'
            ? walkValue(child, here, canonical(key).toLowerCase())
            : HANDLE[fieldClass](child);
      }
      return out;
    }
    if (typeof value === 'string') return walkString(value, path, parentKey);
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
