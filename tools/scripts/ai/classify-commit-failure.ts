/**
 * Classify `git commit` / Husky output so the orchestrator can retry the
 * narrowest check. Keep the trailer format stable — agents parse it.
 */

const NX_RUN_LINT = /> nx run ([a-zA-Z0-9._-]+):lint\b/g;
const FAILED_LINT_TASK = /^- ([a-zA-Z0-9._-]+):lint\b/gm;

const ALLOWED_ENV_SUFFIXES = new Set(['example', 'sample', 'template', 'dist']);

export type CommitFailureReason = 'lint' | 'format' | 'hook' | 'unknown';

export interface ClassifiedCommitFailure {
  reason: CommitFailureReason;
  projects: string[];
  hint: string;
}

export interface CommitFailureTrailerFields {
  // Broader than `CommitFailureReason`: `commit-change.ts` also reports
  // reasons `classifyCommitFailure` never returns, such as `empty-index` and
  // `secret`, through the same trailer format.
  reason: string;
  hint: string;
  projects?: string[];
  paths?: string[];
}

export function normalizeRepoPath(filePath: string): string {
  return String(filePath).replaceAll('\\', '/');
}

export function isBlockedSecretPath(filePath: string): boolean {
  const normalized = normalizeRepoPath(filePath);
  const base = normalized.split('/').pop() ?? normalized;

  if (base === '.env') {
    return true;
  }

  const envMatch = /^\.env\.(.+)$/i.exec(base);
  if (envMatch && !ALLOWED_ENV_SUFFIXES.has(envMatch[1].toLowerCase())) {
    return true;
  }

  if (base.toLowerCase() === 'credentials.json') {
    return true;
  }

  if (/\.(pem|p12|pfx|keystore)$/i.test(base)) {
    return true;
  }

  if (/^id_(rsa|dsa|ecdsa|ed25519)$/i.test(base)) {
    return true;
  }

  return false;
}

export function findBlockedSecretPaths(filePaths: readonly string[]): string[] {
  const blocked: string[] = [];
  const seen = new Set<string>();

  for (const filePath of filePaths) {
    if (!isBlockedSecretPath(filePath)) {
      continue;
    }

    const normalized = normalizeRepoPath(filePath);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    blocked.push(normalized);
  }

  return blocked;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function collectMatches(pattern: RegExp, text: string): string[] {
  pattern.lastIndex = 0;
  const values: string[] = [];
  let match = pattern.exec(text);
  while (match) {
    values.push(match[1]);
    match = pattern.exec(text);
  }
  return values;
}

export function extractLintProjects(
  output: string | null | undefined,
): string[] {
  const text = output ?? '';
  return uniqueSorted([
    ...collectMatches(NX_RUN_LINT, text),
    ...collectMatches(FAILED_LINT_TASK, text),
  ]);
}

function hintForLint(projects: readonly string[]): string {
  if (projects.length === 1) {
    return `yarn nx lint ${projects[0]}`;
  }

  if (projects.length > 1) {
    return projects.map((project) => `yarn nx lint ${project}`).join(' && ');
  }

  return 'corepack yarn affected:lint --uncommitted --outputStyle=static';
}

export function classifyCommitFailure(
  output: string | null | undefined,
): ClassifiedCommitFailure {
  const text = output ?? '';
  const projects = extractLintProjects(text);
  const hasLint = projects.length > 0 || /eslint/i.test(text);
  const hasFormat = /format:write|prettier/i.test(text);

  if (hasLint) {
    return {
      reason: 'lint',
      projects,
      hint: hintForLint(projects),
    };
  }

  if (hasFormat) {
    return {
      reason: 'format',
      projects: [],
      hint: 'corepack yarn format:write --uncommitted',
    };
  }

  if (/husky|pre-commit/i.test(text)) {
    return {
      reason: 'hook',
      projects: [],
      hint: 'Read the hook output above, fix the reported check, then retry corepack yarn ai:commit --message-file <path>.',
    };
  }

  return {
    reason: 'unknown',
    projects: [],
    hint: 'Read the git/husky output above, fix the reported issue, then retry corepack yarn ai:commit --message-file <path>.',
  };
}

export function formatCommitFailureTrailer({
  reason,
  hint,
  projects = [],
  paths = [],
}: CommitFailureTrailerFields): string {
  const lines = ['---', 'ai:commit: failed', `reason: ${reason}`];

  if (projects.length > 0) {
    lines.push(`projects: ${projects.join(', ')}`);
  }

  if (paths.length > 0) {
    lines.push(`paths: ${paths.join(', ')}`);
  }

  lines.push(`hint: ${hint}`, '---', '');
  return lines.join('\n');
}
