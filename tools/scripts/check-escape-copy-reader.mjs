#!/usr/bin/env node
// Asserts that the standalone Escape Copy reader still opens a freshly
// produced envelope, and still needs nothing of ours to do it (ADR 0064).
//
//   node tools/scripts/check-escape-copy-reader.mjs
//
// ADR 0064 decides two things this checks. That an Escape Copy is readable by
// a tool requiring no MyOrganiser server, no session and no Google account —
// and that a gate asserts the tool still opens a freshly produced envelope,
// because "a reader pinned to a schema version the exporter has moved past is
// worse than no reader: it fails at the only moment anyone runs it, and it
// fails silently until then".
//
// Five things are asserted, and none of them is a file comparison:
//
//   1. **The exporter's output opens.** The envelope is produced here and now
//      by `exportVault` — the function the Export button and the Drive backup
//      both call — never read from a fixture, which would only ever be as
//      current as the last person to remember it. The reader must yield back
//      the exact plaintext that went in, for every Vault Blob Type, under
//      both a passphrase and a Recovery Key — and must refuse a wrong one,
//      because a reader that yields nothing reads to a User as an empty vault.
//   2. **The reader was built for the schema the exporter is producing.** One
//      comparison, and it is ADR 0064 decision 2 whole.
//   3. **The reader spaces itself from the tokens, in both directions.** Every
//      CSS custom property it uses is one it also defines — a `var(--name)`
//      naming nothing takes its fallback, which makes the token indirection
//      decoration over a literal, and it renders correctly while doing so,
//      which is why nobody sees it. And no spacing literal it writes is a
//      value the token block already defines. The reader shipped with both
//      halves wrong.
//   4. **The reader needs nothing of ours.** The built page is searched for
//      any way to reach the network — `fetch`, `XMLHttpRequest`, `WebSocket`,
//      `navigator.sendBeacon`, `EventSource`, a dynamic `import()` — for an
//      external `src`/`href`, and for browser storage, which a page holding
//      somebody's vault passphrase has no business touching. Script comments
//      are removed before the search: prose is not a capability. A reader that
//      phones home is not an escape hatch, and the property is invisible until
//      the day it matters.
//   5. **The published checksum is the checksum of the published file**, and
//      every place that names those files names the ones the build publishes —
//      the vault page's constants, which is what the in-product prompt tells a
//      User to download, and the reader's own page, which tells them which
//      checksum file to compare against. The number a User is told to verify
//      has to be a number this build produces, and the file they are told to
//      fetch has to be one that is there, or checking teaches them to stop.
//
// What runs is the **built artifact**, not the source: the HTML is built, its
// inlined script is evaluated in a bare Node context with Web Crypto and no
// DOM, and the envelope is opened through the handle that script exposes. An
// assertion against the sources would pass while the thing we publish is
// broken, which is the failure mode ADR 0043 is about.
//
// The judgments themselves live in tools/scripts/lib/escape-copy-reader-gate.mjs
// so the contract suite can exercise each one against a fixture instead of
// building a 500 KB page per assertion; this file is IO.
//
// Not asserted: that the page *renders*. The DOM glue is covered by
// `apps/escape-copy-reader`'s jsdom suite; running a browser here would cost
// more than it buys and would not make the crypto any more opened.
//
// Exit 0 = the reader opens what the exporter produces. Exit 1 = it does not,
// or it gained a capability it must not have. Exit 2 = the check could not run.
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

import {
  CHECKSUM_FILENAME,
  READER_FILENAME,
  READER_SHELL,
  buildEscapeCopyReader,
  sha256,
} from './build-escape-copy-reader.mjs';
import {
  capabilityFindings,
  checksumFindings,
  customPropertyFindings,
  publishedNameFindings,
  spacingLiteralFindings,
  schemaVersionFindings,
  sectionFindings,
} from './lib/escape-copy-reader-gate.mjs';

/** Where else the published filenames are written down. */
const VAULT_PAGE_CONSTANTS =
  'libs/web/pages/vault/src/constants/escapeCopyReader.ts';

const workspaceRoot = process.cwd();

/**
 * The two secrets that are well-formed and are not this copy's.
 *
 * Derived from the real ones rather than written down, and returned from a
 * function rather than assigned inline. Both halves matter. Flipping one
 * base64 character of the Recovery Key keeps it importable as a 32-byte AES
 * key, so the refusal being asserted is a failed *unwrap* rather than a
 * rejected input shape — the second would pass even on a reader that ignored
 * the key entirely. And keeping the passphrase out of a `value:` literal
 * keeps a secret scanner from reading the gate's own negative case as a
 * committed password, which is what GitGuardian did to the first spelling of
 * this: nothing here is a secret, and nothing here should look like one.
 */
function notThisCopysSecrets(fresh) {
  const head = fresh.recoveryKey[0] === 'A' ? 'B' : 'A';
  return [
    { kind: 'passphrase', value: ['wrong', fresh.passphrase].join('-') },
    { kind: 'recovery-key', value: head + fresh.recoveryKey.slice(1) },
  ];
}

const findings = [];
const finding = (message) => findings.push(message);
const record = (list) => findings.push(...list);

const fail = (message, error) => {
  console.error(`escape-copy-reader: ${message}`);
  if (error) console.error(`\n  ${error.stack ?? error.message ?? error}`);
  process.exit(2);
};

/**
 * Evaluates the built page's script in a bare context and hands back the
 * reader handle it exposes.
 *
 * No `document` is installed, which is also an assertion: the page shell's
 * bootstrap is guarded on `document` existing, and a reader that reached the
 * DOM unconditionally would throw here rather than quietly become untestable.
 */
function loadReaderFromHtml(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/u);
  if (!match) {
    throw new Error('The built reader carries no inline <script>.');
  }

  const sandbox = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    btoa: (data) => Buffer.from(data, 'binary').toString('base64'),
    atob: (data) => Buffer.from(data, 'base64').toString('binary'),
    console,
  };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(match[1], sandbox, { filename: READER_FILENAME });

  const reader = sandbox['MyOrganiserEscapeCopyReader'];
  if (!reader?.openEscapeCopy) {
    throw new Error(
      'The built reader exposes no MyOrganiserEscapeCopyReader.openEscapeCopy handle.',
    );
  }
  return reader;
}

/** Builds and imports the fresh-envelope harness, which runs the real exporter. */
async function mintFreshEnvelope(scratchDir) {
  const { build } = await import('esbuild');
  const outfile = join(scratchDir, 'mint.cjs');

  await build({
    entryPoints: [
      join(
        workspaceRoot,
        'apps/escape-copy-reader/src/gate/mintFreshEscapeCopy.ts',
      ),
    ],
    bundle: true,
    // CommonJS, not ESM. The `web-vault` barrel reaches the generated API
    // client, which reaches axios and its CommonJS dependencies; esbuild's ESM
    // output turns their `require` calls into a stub that throws "Dynamic
    // require of \"util\" is not supported". Nothing here is shipped, so the
    // output format is free to be whatever runs.
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    tsconfig: join(workspaceRoot, 'tsconfig.base.json'),
    absWorkingDir: workspaceRoot,
    outfile,
    logLevel: 'silent',
  });

  const module = createRequire(import.meta.url)(outfile);
  return module.mintFreshEscapeCopy();
}

let scratchDir;
let built;
let fresh;

try {
  built = await buildEscapeCopyReader({
    root: workspaceRoot,
    outDir: 'dist/escape-copy-reader',
  });
} catch (error) {
  fail('the reader could not be built', error);
}

try {
  scratchDir = mkdtempSync(join(tmpdir(), 'escape-copy-reader-'));
  fresh = await mintFreshEnvelope(scratchDir);
} catch (error) {
  fail('a fresh envelope could not be produced by the exporter', error);
} finally {
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
}

record(
  schemaVersionFindings({
    exporterVersion: fresh.schemaVersion,
    readerVersion: built.schemaVersion,
  }),
);

// A page that carries no script, or whose script exposes no reader, is a
// broken reader rather than a check that could not run: the artifact was
// built, it was read, and it does not open anything. Reported as a finding —
// exit 1 — which is what the header promises for drift.
let reader = null;
try {
  reader = loadReaderFromHtml(built.html);
} catch (error) {
  finding(`the built reader could not be loaded: ${error.message ?? error}`);
}

for (const secret of reader
  ? [
      { kind: 'passphrase', value: fresh.passphrase },
      { kind: 'recovery-key', value: fresh.recoveryKey },
    ]
  : []) {
  try {
    const opened = await reader.openEscapeCopy({ text: fresh.text, secret });
    record(
      sectionFindings({
        label: `opened with the ${secret.kind}`,
        opened,
        expected: fresh.expected,
      }),
    );
  } catch (error) {
    finding(
      `the reader could not open a freshly produced envelope with the ` +
        `${secret.kind}: ${error.message ?? error}`,
    );
  }
}

// A wrong secret must be refused rather than silently yielding nothing, which
// would read to a User as "my vault was empty". Both secrets, because they
// unwrap through different paths — one derives a key, one imports raw bytes —
// and a reader could plausibly refuse one and wave the other through.
for (const wrong of reader ? notThisCopysSecrets(fresh) : []) {
  try {
    await reader.openEscapeCopy({ text: fresh.text, secret: wrong });
    finding(
      `the reader opened a freshly produced envelope with a wrong ${wrong.kind}.`,
    );
  } catch {
    // Expected.
  }
}

record(capabilityFindings(built.html));

record(customPropertyFindings(built.html));

record(spacingLiteralFindings(built.html));

record(
  publishedNameFindings({
    sources: [
      {
        label: `the vault page's constants (${VAULT_PAGE_CONSTANTS})`,
        text: readFileSync(join(workspaceRoot, VAULT_PAGE_CONSTANTS), 'utf8'),
        expect: [READER_FILENAME, CHECKSUM_FILENAME],
      },
      {
        label: `the reader's own page (${READER_SHELL})`,
        text: readFileSync(join(workspaceRoot, READER_SHELL), 'utf8'),
        // The page names the checksum file it tells a User to compare
        // against; it has no reason to name itself.
        expect: [CHECKSUM_FILENAME],
      },
    ],
  }),
);

record(
  checksumFindings({
    checksumFileText: readFileSync(built.checksumPath, 'utf8'),
    digest: sha256(built.html),
    filename: READER_FILENAME,
  }),
);

if (findings.length) {
  console.error('escape-copy-reader: the reader does not hold up (ADR 0064)\n');
  for (const item of findings) console.error(`  - ${item}`);
  console.error(
    `\nThe reader is built from ${resolve('apps/escape-copy-reader/src/main.ts')}` +
      ' and opens through `openEscapeCopy` in libs/vault-core.',
  );
  process.exit(1);
}

console.log(
  `escape-copy-reader: a freshly produced envelope (schema v${fresh.schemaVersion}) ` +
    `opens with both the passphrase and the Recovery Key, all ` +
    `${Object.keys(fresh.expected).length} Vault Blob Types round-trip, and the ` +
    `built page reaches neither the network nor storage.`,
);
