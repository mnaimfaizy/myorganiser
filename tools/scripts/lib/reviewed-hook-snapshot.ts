import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** A separately reviewed manifest, never read from the agent's writable tree. */
export interface ReviewedHookManifest {
  version: 1;
  roots: string[];
  files: Array<{ path: string; sha256: string; dependencies: string[] }>;
}

function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    path
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

/**
 * Validate the reviewed inventory and declared dependency closure and hash every
 * file. This does not establish that the declaration contains every executable
 * dependency, that the mount is immutable, or that Codex loads the hooks.
 * Callers must prove those separately; this function is not a launch approval.
 */
export function verifyReviewedHookSnapshot(
  directory: string,
  manifest: ReviewedHookManifest,
): void {
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.roots) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('Invalid reviewed hook manifest.');
  }
  const files = new Map<string, ReviewedHookManifest['files'][number]>();
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      !validPath(entry.path) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Array.isArray(entry.dependencies) ||
      files.has(entry.path)
    )
      throw new Error('Invalid reviewed hook file entry.');
    files.set(entry.path, entry);
  }
  if (manifest.roots.length === 0 || files.size === 0) {
    throw new Error('Reviewed hook manifest has no roots or files.');
  }
  const visited = new Set<string>();
  const pending: unknown[] = [...manifest.roots];
  while (pending.length) {
    const path = pending.pop();
    if (typeof path !== 'string' || !validPath(path) || !files.has(path)) {
      throw new Error('Reviewed hook dependency is missing or invalid.');
    }
    if (visited.has(path)) continue;
    visited.add(path);
    pending.push(...files.get(path)!.dependencies);
  }
  if (visited.size !== files.size)
    throw new Error('Reviewed hook manifest has unreachable files.');

  const root = realpathSync(directory);
  for (const entry of files.values()) {
    let current = root;
    for (const part of entry.path.split('/')) {
      current = resolve(current, part);
      if (lstatSync(current).isSymbolicLink())
        throw new Error('Reviewed hook snapshot contains a symlink.');
    }
    const actual = realpathSync(current);
    const fromRoot = relative(root, actual);
    if (
      !fromRoot ||
      fromRoot === '..' ||
      fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot)
    ) {
      throw new Error('Reviewed hook file escapes its snapshot.');
    }
    if (!lstatSync(actual).isFile())
      throw new Error('Reviewed hook entry is not a file.');
    const digest = createHash('sha256')
      .update(readFileSync(actual))
      .digest('hex');
    if (digest !== entry.sha256)
      throw new Error(`Reviewed hook file changed: ${entry.path}`);
  }
}

/** Inventory verification alone is never evidence that Codex enforces it. */
export function assertReviewedHookEnforcement(): never {
  throw new Error(
    'Reviewed hook enforcement has not been established; refusing Codex dispatch.',
  );
}
