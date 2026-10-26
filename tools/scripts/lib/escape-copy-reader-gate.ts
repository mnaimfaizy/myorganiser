/**
 * The decisions behind `yarn escape-copy-reader:check`, separated from its IO
 * so they can be exercised against fixtures.
 *
 * `tools/scripts/check-escape-copy-reader.mjs` is the half that builds the
 * reader, runs the real exporter and evaluates the built page; this half is
 * every judgment that file makes about what it got back. Splitting them is
 * what lets the contract suite prove the checker fails on the drift its header
 * claims to catch (ADR 0085) without building a 500 KB page per assertion.
 */
import { transformSync } from 'esbuild';

/**
 * Capabilities the reader must not have, and why each one would matter.
 *
 * Matched against the built page's text, which is unminified on purpose — see
 * the build script. A match is a finding even if it is unreachable at run
 * time: this is a file Users are told to verify by checksum and then trust
 * with a vault passphrase, and "it is in there but never called" is not a
 * claim a checksum can carry.
 *
 * A comment is not "in there" in that sense: it is not code, reachable or
 * not, so each inline script is scanned with its comments removed. Bundled
 * dependencies write prose about `import()` and `fetch()` in theirs.
 */
export const FORBIDDEN_CAPABILITIES = [
  ['fetch(', 'reaches the network'],
  ['XMLHttpRequest', 'reaches the network'],
  ['WebSocket', 'reaches the network'],
  ['sendBeacon', 'reaches the network'],
  ['EventSource', 'reaches the network'],
  ['import(', 'can load code at run time'],
  ['importScripts', 'can load code at run time'],
  ['localStorage', 'writes browser storage'],
  ['sessionStorage', 'writes browser storage'],
  ['indexedDB', 'writes browser storage'],
  ['document.cookie', 'writes browser storage'],
] as const satisfies ReadonlyArray<readonly [string, string]>;

/** An external resource reference, which would make the file non-self-contained. */
const EXTERNAL_REFERENCE = /(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//giu;

const INLINE_SCRIPT = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/giu;

/**
 * The page with every inline script's comments removed, by esbuild's parser
 * rather than a pattern — a pattern cannot tell `//` in a string from a
 * comment. Whitespace-only minification leaves strings and identifiers as
 * written. A script that does not parse is kept verbatim, so the scan fails
 * closed rather than open.
 */
function withoutScriptComments(html: string): string {
  return html.replace(
    INLINE_SCRIPT,
    (whole: string, open: string, body: string, close: string): string => {
      try {
        const { code } = transformSync(body, {
          loader: 'js',
          minifyWhitespace: true,
          legalComments: 'none',
          logLevel: 'silent',
        });
        return `${open}${code}${close}`;
      } catch {
        return whole;
      }
    },
  );
}

/**
 * Everything wrong with the built page as a *file*: a capability it must not
 * have, or a resource it would have to fetch to render.
 */
export function capabilityFindings(html: string): string[] {
  const findings: string[] = [];
  const scanned = withoutScriptComments(html);

  for (const [needle, why] of FORBIDDEN_CAPABILITIES) {
    if (scanned.includes(needle)) {
      findings.push(
        `the built reader contains \`${needle}\`, which ${why}. ADR 0064's reader ` +
          `needs nothing of ours and holds nothing of the User's.`,
      );
    }
  }

  for (const match of html.matchAll(EXTERNAL_REFERENCE)) {
    findings.push(
      `the built reader references an external resource (\`${match[0].trim()}\`). ` +
        `It must open from file:// with the network cable out.`,
    );
  }

  return findings;
}

/**
 * Whether the plaintext the reader yielded is the plaintext the exporter put
 * in — for every Vault Blob Type, not just the ones both happen to agree on.
 *
 * A missing type is reported as its own finding rather than folded into a
 * mismatch, because the two mean different things: a type the reader skipped
 * is data the User cannot get back at all, and that is precisely the omission
 * ADR 0053 exists to prevent and that dropped Tasks from hardened export in
 * #537.
 */
/** One Vault Blob Type section the reader yielded back. */
export interface OpenedSection {
  present: boolean;
  type: string;
  plaintext: unknown;
}

/** What `openEscapeCopy` hands back: the sections it opened. */
export interface OpenedEnvelope {
  sections: OpenedSection[];
}

export function sectionFindings({
  label,
  opened,
  expected,
}: {
  label: string;
  opened: OpenedEnvelope;
  expected: Record<string, unknown>;
}): string[] {
  const present = opened.sections.filter((section) => section.present);
  const expectedTypes = Object.keys(expected).sort();
  const openedTypes = present.map((section) => section.type).sort();

  if (openedTypes.join(',') !== expectedTypes.join(',')) {
    return [
      `${label}: the exporter put [${expectedTypes.join(', ')}] in the envelope, ` +
        `but the reader yielded [${openedTypes.join(', ')}]. A Vault Blob Type the ` +
        `reader skips is data the User cannot get back.`,
    ];
  }

  const findings: string[] = [];
  for (const section of present) {
    const want = JSON.stringify(expected[section.type]);
    const got = JSON.stringify(section.plaintext);
    if (want !== got) {
      findings.push(
        `${label}: the ${section.type} section did not round-trip. ` +
          `Expected ${want}, got ${got}.`,
      );
    }
  }
  return findings;
}

/**
 * Whether the reader was built for the schema version the exporter is
 * producing today.
 *
 * This is ADR 0064 decision 2 in one comparison: a reader pinned to a version
 * the exporter has moved past fails at the only moment anyone runs it, and
 * fails silently until then.
 */
export function schemaVersionFindings({
  exporterVersion,
  readerVersion,
}: {
  exporterVersion: number;
  readerVersion: number;
}): string[] {
  if (exporterVersion === readerVersion) return [];
  return [
    `the exporter produced schema version ${exporterVersion} and the reader ` +
      `was built for ${readerVersion}. This is exactly the drift ADR 0064 ` +
      `decision 2 exists to catch.`,
  ];
}

/**
 * Whether the published checksum is the checksum of the published file.
 *
 * The distribution answer is "a file you hold, with a number you check". A
 * number that does not match the file it sits beside trains Users to skip the
 * check, which costs more than publishing nothing would.
 */
export function checksumFindings({
  checksumFileText,
  digest,
  filename,
}: {
  checksumFileText: string;
  digest: string;
  filename: string;
}): string[] {
  const actual = checksumFileText.trim();
  const expected = `${digest}  ${filename}`;
  if (actual === expected) return [];
  return [
    `the checksum file says \`${actual}\` but the built reader hashes to ` +
      `\`${expected}\`. The number Users are told to verify must be the number ` +
      `this build produces.`,
  ];
}

/**
 * Whether every place that *names* the published artifacts agrees with what
 * the build actually publishes.
 *
 * Three files carry those two filenames and nothing reconciled them: the build
 * script, the vault page's constants — which is what the in-product prompt
 * tells a User to download — and the reader's own page, which tells a User
 * which checksum file to compare against. Renaming the artifact in one place
 * leaves the other two pointing at a file that is not there, and a User
 * following an instruction to check a checksum that does not exist is worse
 * off than one who was never told to check
 * ([ADR 0051](../../../docs/adr/0051-a-pinned-value-does-not-notice-that-its-meaning-moved.md)).
 *
 * Asserted rather than shared, because a `scope:web` library may not import a
 * repo script and a self-contained page may not import anything at all. The
 * names have to be written three times; they do not have to drift.
 *
 * One direction, and it covers both: every site must contain the name the
 * build publishes. A rename in the build leaves the other sites failing, and a
 * rename in a site leaves that site failing. There is deliberately no check
 * for a *stale* name — "does this file still mention the old one" needs the
 * old one to be written down somewhere, which is another pinned value with
 * exactly this problem.
 */
export interface PublishedNameSource {
  label: string;
  text: string;
  expect: readonly string[];
}

export function publishedNameFindings({
  sources,
}: {
  sources: readonly PublishedNameSource[];
}): string[] {
  const findings: string[] = [];

  for (const { label, text, expect } of sources) {
    for (const name of expect) {
      if (!text.includes(name)) {
        findings.push(
          `${label} does not name \`${name}\`, which is what the build ` +
            `publishes. Every place that tells a User which file to fetch or ` +
            `which checksum to compare has to name the one that exists.`,
        );
      }
    }
  }

  return findings;
}

/**
 * Whether every CSS custom property the built page *uses* is one the built
 * page also *defines*.
 *
 * A `var(--name)` naming nothing resolves to nothing. With a fallback it
 * silently becomes the fallback, so the page renders correctly, the token
 * indirection is decoration, and the real value is the hard-coded literal the
 * design-token rule exists to prevent. Without one the declaration is dropped
 * and the element renders unstyled. Both are invisible to a reader of the
 * source, which is what makes this worth asserting rather than noticing.
 *
 * The reader shipped with `--space-1`, `--space-2`, `--space-4` and
 * `--space-6` against a token pipeline that emits `--space-xs` through
 * `--space-xl`. Every spacing rule in the page was a literal wearing a token's
 * name. Same shape as the Tailwind classes that resolved to no CSS and shipped
 * the groceries pages unstyled
 * ([ADR 0065](../../../docs/adr/0065-tokens-json-is-the-single-source-of-web-colour.md)).
 *
 * Total by construction: the page is self-contained, so the set it may use is
 * exactly the set it carries. A property defined and never used is not a
 * finding — the token block is inlined whole, and most of it is for the app.
 */
export function customPropertyFindings(html: string): string[] {
  const defined = new Set(
    Array.from(html.matchAll(/(--[a-zA-Z0-9-]+)\s*:/gu), (m) => m[1]),
  );

  const missing = new Set<string>();
  for (const [, name] of html.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/gu)) {
    if (!defined.has(name)) missing.add(name);
  }

  return Array.from(
    missing,
    (name) =>
      `the built reader uses \`var(${name})\` and defines no \`${name}\`. It ` +
      `resolves to its fallback, or to nothing — either way the value that ` +
      `renders is not the token it is named after.`,
  );
}

/** The properties whose values are spacing, and nothing else. */
const SPACING_PROPERTIES =
  /(?:^|[;{])\s*((?:margin|padding)(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap)\s*:\s*([^;}]+)/gu;

/** A length this checker can compare: px or rem. Anything else is left alone. */
const LENGTH = /^(-?\d*\.?\d+)(px|rem)$/u;

const toPx = (value: string): number | null => {
  const match = LENGTH.exec(value);
  if (!match) return null;
  const size = Number(match[1]);
  return match[2] === 'rem' ? size * 16 : size;
};

/**
 * Whether the page spaces itself with a literal where a token for that exact
 * value already exists.
 *
 * Deliberately narrow, and the narrowness is what makes it usable. It fires
 * only when the value the author wrote is *exactly* a value the token block
 * already defines — which is the standard's own wording, "do not hard-code …
 * magic spacing values in components **when a token should exist**"
 * (`AGENTS.md`). A 6px gap on a scale of 4, 8, 16, 24, 32 is not reported,
 * because no token exists for it and inventing one to satisfy a checker is
 * worse than the literal.
 *
 * Zero is never reported: `margin: 0` is a reset, not a spacing decision, and
 * no token should stand in for it. Only `<style>` blocks are read, so a
 * CSS-shaped string inside the bundled script cannot be mistaken for a rule.
 *
 * This is the half the completeness check above cannot see. That one catches a
 * `var()` naming a token that does not exist; this one catches the token that
 * does exist being ignored. The reader shipped with both.
 */
export function spacingLiteralFindings(html: string): string[] {
  const styles = Array.from(
    html.matchAll(/<style>([\s\S]*?)<\/style>/gu),
    (m) => m[1],
  ).join('\n');

  const tokenPxByName = new Map<string, number>();
  for (const [, name, value] of styles.matchAll(
    /(--space-[a-z0-9-]+)\s*:\s*([^;]+);/gu,
  )) {
    const px = toPx(value.trim());
    if (px !== null && px !== 0) tokenPxByName.set(name, px);
  }
  if (tokenPxByName.size === 0) return [];

  const findings = new Set<string>();
  for (const [, property, declaration] of styles.matchAll(SPACING_PROPERTIES)) {
    if (declaration.includes('var(')) continue;
    for (const part of declaration.trim().split(/\s+/u)) {
      const px = toPx(part);
      if (px === null || px === 0) continue;
      for (const [name, tokenPx] of tokenPxByName) {
        if (tokenPx !== px) continue;
        findings.add(
          `the built reader writes \`${property}: ${declaration.trim()}\`, and ` +
            `\`${part}\` is exactly \`${name}\`. A token exists for that value, ` +
            `so the literal is the magic number AGENTS.md asks components not to carry.`,
        );
      }
    }
  }

  return Array.from(findings);
}
