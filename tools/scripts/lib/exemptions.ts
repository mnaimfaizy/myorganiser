/**
 * The one reader for the reasoned exemption lists the doc and platform
 * checkers keep (`tools/config/*-exemptions.json`).
 *
 * Every list shares an envelope — a required file, valid JSON, a strict
 * `schemaVersion`, an `exemptions` array — and a rule that each entry carries
 * a written reason and is listed once. Checkers differ only in what names an
 * entry (`file` + `claim`, or a bare `path`) and in whether the named file
 * must still exist, so those are the two entry readers below.
 *
 * Every failure goes through the caller's `fail`, which never returns: the
 * message text is part of each checker's contract.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CheckerFail } from './doc-paths.ts';

/** One entry of a `file` + `claim` exemption list, once read and validated. */
export interface Exemption {
  file: string;
  claim: string;
  reason: string;
}

/** The file as it arrives: untrusted, read field by field by the entry readers. */
export interface ExemptionsFile {
  schemaVersion?: unknown;
  exemptions?: unknown;
}

export interface ReadExemptionsOptions {
  cwd: string;
  path: string;
  schemaVersion: number;
  fail: CheckerFail;
}

export function exemptionKey(file: string, claim: string): string {
  return `${file}\0${claim}`;
}

const trimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** Reads the envelope and returns its raw, unvalidated entries. */
export function readExemptionEntries({
  cwd,
  path,
  schemaVersion,
  fail,
}: ReadExemptionsOptions): unknown[] {
  const absolute = join(cwd, path);
  if (!existsSync(absolute)) {
    fail(`${path} not found — the exemption list is a required artifact`);
  }

  let parsed: ExemptionsFile;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8')) as ExemptionsFile;
  } catch (error) {
    return fail(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed?.schemaVersion !== schemaVersion) {
    fail(
      `${path}: expected "schemaVersion": ${schemaVersion}, found ${JSON.stringify(parsed?.schemaVersion)}`,
    );
  }
  const entries = parsed?.exemptions;
  if (!Array.isArray(entries)) {
    return fail(`${path}: expected an "exemptions" array`);
  }
  return entries;
}

/**
 * Reads a `file` + `claim` + `reason` list. With `requireFile`, an entry whose
 * documenting file no longer exists under `cwd` is a failure.
 */
export function readClaimExemptions(
  options: ReadExemptionsOptions & { requireFile?: boolean },
): Exemption[] {
  const { cwd, path, fail, requireFile = false } = options;
  const seen = new Set<string>();
  const exemptions: Exemption[] = [];
  readExemptionEntries(options).forEach((raw: unknown, index: number) => {
    const at = `${path}[${index}]`;
    const entry = (raw ?? {}) as Record<string, unknown>;
    const file = trimmed(entry.file);
    const claim = trimmed(entry.claim);
    const reason = trimmed(entry.reason);
    if (!file)
      fail(`${at}: entry names no documenting file (\`file\` is required)`);
    if (!claim) fail(`${at}: exemption for \`${file}\` names no claim`);
    if (!reason) {
      fail(
        `${at}: exemption for \`${file}\` → \`${claim}\` carries no written reason. ` +
          'An exemption is a decision somebody made, not a gap nobody saw.',
      );
    }
    const key = exemptionKey(file, claim);
    if (seen.has(key))
      fail(`${at}: \`${file}\` → \`${claim}\` is exempted twice`);
    seen.add(key);
    if (requireFile && !existsSync(join(cwd, file))) {
      fail(
        `${at}: documenting file \`${file}\` does not exist. An exemption ` +
          'naming a file that is gone is a hole nobody sees.',
      );
    }
    exemptions.push({ file, claim, reason });
  });
  return exemptions;
}

/** Reads a `path` + `reason` list; every path must still exist under `cwd`. */
export function readPathExemptions(
  options: ReadExemptionsOptions,
): Map<string, string> {
  const { cwd, path, fail } = options;
  const seen = new Set<string>();
  const exemptions = new Map<string, string>();
  readExemptionEntries(options).forEach((raw: unknown, index: number) => {
    const at = `${path}[${index}]`;
    const entry = (raw ?? {}) as Record<string, unknown>;
    const entryPath = trimmed(entry.path);
    const reason = trimmed(entry.reason);
    if (!entryPath) fail(`${at}: entry names no file (\`path\` is required)`);
    if (!reason) {
      fail(
        `${at}: exemption for \`${entryPath}\` carries no written reason. An ` +
          'exemption is a decision somebody made, not a gap nobody saw.',
      );
    }
    if (seen.has(entryPath)) fail(`${at}: \`${entryPath}\` is exempted twice`);
    seen.add(entryPath);
    if (!existsSync(join(cwd, entryPath))) {
      fail(
        `${at}: \`${entryPath}\` does not exist. An exemption naming a file ` +
          'that is gone is a hole nobody sees.',
      );
    }
    exemptions.set(entryPath, reason);
  });
  return exemptions;
}
