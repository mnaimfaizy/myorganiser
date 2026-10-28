#!/usr/bin/env node
// Builds the standalone Escape Copy reader: one self-contained HTML file, plus
// the checksum published beside it (ADR 0064).
//
//   node tools/scripts/build-escape-copy-reader.ts [--out-dir <dir>]
//
// The reader is bundled from `apps/escape-copy-reader/src/main.ts`, which is a
// page shell around `openEscapeCopy` in `@myorganiser/vault-core` — the same
// module, the same envelope schema and the same crypto the exporter runs. That
// is the point of building it rather than writing it: a reader carrying its
// own copy of the crypto would be a second implementation of the one thing
// that must never disagree with the first, and it would disagree silently.
//
// Deliberately NOT minified. The distribution answer is "a file you hold, with
// a published checksum", and a User told to check a checksum is entitled to
// read what they checked. The file is a few hundred KB either way.
//
// Nothing is fetched at run time and nothing is fetched at build time: the
// design tokens are inlined from `libs/design-tokens/src/generated/tokens.css`
// so the page has no stylesheet link and no font URL.
//
// `tools/scripts/check-escape-copy-reader.ts` is the gate over the output.
// This script only builds; it asserts nothing.
//
// Exit 0 = built. Exit 1 = the build failed.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { errorMessage } from './lib/error-message.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const READER_APP_ROOT = 'apps/escape-copy-reader';
export const READER_ENTRY = `${READER_APP_ROOT}/src/main.ts`;
export const READER_SHELL = `${READER_APP_ROOT}/src/index.html`;
export const DESIGN_TOKENS_CSS = 'libs/design-tokens/src/generated/tokens.css';
export const DEFAULT_OUT_DIR = 'dist/escape-copy-reader';
export const READER_FILENAME = 'myorganiser-escape-copy-reader.html';
export const CHECKSUM_FILENAME = 'SHA256SUMS.txt';

const TOKENS_PLACEHOLDER = '/* @@DESIGN_TOKENS@@ */';
const BUNDLE_PLACEHOLDER = '/* @@READER_BUNDLE@@ */';

/**
 * Splices the bundled script and the design tokens into the page shell.
 *
 * Exported so the gate can rebuild the same page from parts without shelling
 * out, and so the placeholder contract is asserted in one place: a shell that
 * lost a placeholder would otherwise produce a reader with no script in it,
 * which looks like a working file until somebody opens it.
 */
export function composeReaderHtml({
  shell,
  tokensCss,
  bundleJs,
  stamp,
}: {
  shell: string;
  tokensCss: string;
  bundleJs: string;
  stamp: string;
}): string {
  const placeholders: [string, string][] = [
    ['design tokens', TOKENS_PLACEHOLDER],
    ['reader bundle', BUNDLE_PLACEHOLDER],
  ];
  for (const [name, placeholder] of placeholders) {
    if (!shell.includes(placeholder)) {
      throw new Error(
        `${READER_SHELL} no longer contains the ${name} placeholder ${placeholder}`,
      );
    }
  }

  return shell
    .replace(TOKENS_PLACEHOLDER, () => tokensCss.trim())
    .replace(BUNDLE_PLACEHOLDER, () => `${stamp}\n${bundleJs}`);
}

export function stampFor({
  schemaVersion,
  builtFrom,
}: {
  schemaVersion: number;
  builtFrom: string;
}): string {
  return (
    `// MyOrganiser Escape Copy reader — envelope schema version ${schemaVersion}.\n` +
    `// Bundled from ${builtFrom}. Open this file from disk; it needs no network.`
  );
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The envelope schema version this reader understands, read off the source. */
export function currentSchemaVersion(root: string = workspaceRoot): number {
  const source = readFileSync(
    join(root, 'libs/vault-core/src/lib/vaultExportEnvelope.ts'),
    'utf8',
  );
  const match = source.match(
    /CURRENT_VAULT_EXPORT_SCHEMA_VERSION\s*=\s*(\d+)/u,
  );
  if (!match) {
    throw new Error(
      'Could not read CURRENT_VAULT_EXPORT_SCHEMA_VERSION from vaultExportEnvelope.ts',
    );
  }
  return Number(match[1]);
}

export interface BuiltEscapeCopyReader {
  htmlPath: string;
  checksumPath: string;
  html: string;
  digest: string;
  schemaVersion: number;
}

export async function buildEscapeCopyReader({
  root = workspaceRoot,
  outDir = DEFAULT_OUT_DIR,
}: {
  root?: string;
  outDir?: string;
} = {}): Promise<BuiltEscapeCopyReader> {
  const { build } = await import('esbuild');

  const result = await build({
    entryPoints: [join(root, READER_ENTRY)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    legalComments: 'inline',
    charset: 'utf8',
    tsconfig: join(root, 'tsconfig.base.json'),
    absWorkingDir: root,
    logLevel: 'silent',
  });

  const bundleJs = result.outputFiles[0].text;
  const schemaVersion = currentSchemaVersion(root);
  const html = composeReaderHtml({
    shell: readFileSync(join(root, READER_SHELL), 'utf8'),
    tokensCss: readFileSync(join(root, DESIGN_TOKENS_CSS), 'utf8'),
    bundleJs,
    stamp: stampFor({ schemaVersion, builtFrom: READER_ENTRY }),
  });

  const absoluteOutDir = resolve(root, outDir);
  mkdirSync(absoluteOutDir, { recursive: true });

  const htmlPath = join(absoluteOutDir, READER_FILENAME);
  writeFileSync(htmlPath, html, 'utf8');

  const digest = sha256(html);
  const checksumPath = join(absoluteOutDir, CHECKSUM_FILENAME);
  writeFileSync(checksumPath, `${digest}  ${basename(htmlPath)}\n`, 'utf8');

  return { htmlPath, checksumPath, html, digest, schemaVersion };
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const outIndex = process.argv.indexOf('--out-dir');
  const outDir = outIndex === -1 ? DEFAULT_OUT_DIR : process.argv[outIndex + 1];

  try {
    const built = await buildEscapeCopyReader({ outDir });
    const sizeKb = Math.round(Buffer.byteLength(built.html, 'utf8') / 1024);
    console.log(
      `escape-copy-reader: built ${built.htmlPath} (${sizeKb} KB, envelope schema v${built.schemaVersion})`,
    );
    console.log(`escape-copy-reader: sha256 ${built.digest}`);
    console.log(`escape-copy-reader: wrote ${built.checksumPath}`);
  } catch (error) {
    console.error(
      `escape-copy-reader: build failed\n\n  ${errorMessage(error)}`,
    );
    process.exit(1);
  }
}
