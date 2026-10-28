#!/usr/bin/env node
// Refuses signing material and store credentials in the git index, so a
// commit cannot include them (PRD #956).
//
//   node tools/scripts/check-signing-material.ts
//
// This repository is public. A secret that reaches its history can only be
// rotated, never recalled — and the Android release keystore cannot even be
// rotated: it is the app's only signing identity (#972), so an installed
// Mobile Release accepts an update only from the key that signed it. The one
// safe outcome is that it is never committed.
//
// ASSERTS: the index — what the next commit will contain, and in CI what is
// already tracked — holds none of these:
//   - an Android keystore (`.jks`, `.keystore`), except a blob byte-identical
//     to the public React Native debug keystore every generated app ships;
//   - a `.p12` certificate;
//   - a `.p8` App Store Connect API key;
//   - a `.mobileprovision` profile;
//   - a Google service-account key, recognised by content under any filename:
//     a JSON document whose `type` is `service_account` and that carries a
//     `private_key`.
// Extensions match case-insensitively. The debug keystore is recognised by
// its blob id, not its name, so a release keystore renamed `debug.keystore`
// is still refused. No store upload is planned (ADR 0127); the `.p12`, `.p8`,
// `.mobileprovision`, and service-account kinds cost nothing to refuse.
//
// DOES NOT ASSERT anything about history. A secret already in an earlier
// commit is not made safe by removing it, and failing every later commit
// would not rotate it; that is an incident, not a gate.
//
// DOES NOT ASSERT anything about unstaged or untracked files. They reach no
// commit; keeping them out of `git add` is `.gitignore`'s job.
//
// DOES NOT RECOGNISE a binary kind by content. A keystore or certificate
// renamed to an unlisted extension passes: a PKCS#12 file is plain ASN.1 with
// no magic number to tell it from any other DER file, and guessing would fail
// innocent commits. Only service-account JSON, which is text and names its
// own kind, is read.
//
// Exit 0 = nothing forbidden is in the index. Exit 1 = a forbidden file is,
// and its path is named. Exit 2 = could not read the index.
import { execFileSync } from 'node:child_process';

import { spawnFailure } from './lib/spawn-failure.ts';

// `git hash-object` of the keystore `@nx/react-native` generates into every
// app (node_modules/@nx/react-native/src/generators/application/files/app/
// android/app/debug.keystore). Its password is `android` and it is published,
// so it signs nothing anybody trusts.
export const PUBLIC_DEBUG_KEYSTORE_BLOB =
  '364e105ed39fbfd62001429a68140672b06ec0de';

// A row's `exemptBlob` is the one blob of that kind the index may hold.
export const FORBIDDEN_EXTENSIONS = [
  {
    extension: '.jks',
    kind: 'Android keystore',
    exemptBlob: PUBLIC_DEBUG_KEYSTORE_BLOB,
  },
  {
    extension: '.keystore',
    kind: 'Android keystore',
    exemptBlob: PUBLIC_DEBUG_KEYSTORE_BLOB,
  },
  { extension: '.p12', kind: '.p12 certificate' },
  { extension: '.p8', kind: 'App Store Connect API key' },
  { extension: '.mobileprovision', kind: 'provisioning profile' },
];

const SERVICE_ACCOUNT_KIND = 'Google service-account key';

// What `git grep` narrows to before a candidate is parsed. Written with POSIX
// classes, so this file's own source never matches it.
const SERVICE_ACCOUNT_PATTERN =
  '"type"[[:space:]]*:[[:space:]]*"service_account"';

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

/** One file in the index: its path and the blob hash staged for it. */
export interface IndexEntry {
  path: string;
  blob: string;
}

/** `{ path, blob }` for every file in the index. */
export function readIndex(cwd: string): IndexEntry[] {
  return git(cwd, ['ls-files', '--stage', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [, blob] = line.slice(0, tab).split(' ');
      return { path: line.slice(tab + 1), blob };
    });
}

/** The forbidden kind an index entry's extension names, or null. */
export function forbiddenKind({ path, blob }: IndexEntry): string | null {
  const lower = path.toLowerCase();
  const match = FORBIDDEN_EXTENSIONS.find(({ extension }) =>
    lower.endsWith(extension),
  );
  if (!match || blob === match.exemptBlob) return null;
  return match.kind;
}

/** True when `text` is a Google service-account key. */
export function isServiceAccountKey(text: string): boolean {
  let parsed: unknown;
  try {
    // A UTF-8 byte order mark is valid in a file but not to JSON.parse.
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const key = parsed as { type?: unknown; private_key?: unknown };
  return key.type === 'service_account' && typeof key.private_key === 'string';
}

/** Indexed paths whose content is a service-account key, under any name. */
function serviceAccountPaths(cwd: string): string[] {
  let candidates: string;
  try {
    candidates = git(cwd, [
      'grep',
      '--cached',
      '-l',
      '-z',
      '-I',
      '-E',
      '-e',
      SERVICE_ACCOUNT_PATTERN,
    ]);
  } catch (error) {
    if (spawnFailure(error).status === 1) return []; // git grep: no match
    throw error;
  }
  return candidates
    .split('\0')
    .filter(Boolean)
    .filter((path) => isServiceAccountKey(git(cwd, ['show', `:${path}`])));
}

/** Every forbidden file in the index at `cwd`, as `{ path, kind }`. */
export function findSigningMaterial(
  cwd: string,
): { path: string; kind: string }[] {
  const findings: { path: string; kind: string }[] = [];
  for (const entry of readIndex(cwd)) {
    const kind = forbiddenKind(entry);
    if (kind) findings.push({ path: entry.path, kind });
  }
  for (const path of serviceAccountPaths(cwd)) {
    if (!findings.some((finding) => finding.path === path))
      findings.push({ path, kind: SERVICE_ACCOUNT_KIND });
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path));
}

if (process.argv[1] && process.argv[1].endsWith('check-signing-material.ts')) {
  let findings: ReturnType<typeof findSigningMaterial>;
  try {
    findings = findSigningMaterial(process.cwd());
  } catch (error) {
    console.error(`signing-material: could not read the index: ${error}`);
    process.exit(2);
  }
  if (findings.length === 0) {
    console.log('signing-material: no signing material in the index');
    process.exit(0);
  }
  console.error(
    'signing-material: refusing signing material or store credentials in the index:\n',
  );
  for (const { path, kind } of findings) console.error(`  - ${path} (${kind})`);
  console.error(
    '\nThis repository is public: anything committed can only be rotated, never' +
      ' recalled. Unstage it (`git restore --staged <path>`), keep it outside the' +
      ' repository, and see "Where secrets live" in' +
      ' docs/deployment/MOBILE_RELEASE_PROCESS.md.',
  );
  process.exit(1);
}
