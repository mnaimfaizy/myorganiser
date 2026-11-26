import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

// The read hook's own rules, from the guarded worktree, evaluated in this
// process: one hook process per directory entry took minutes per launch.
// A policy that cannot be loaded or does not answer aborts the capture.
export async function loadReadPolicy(guardDirectory: string) {
  const module = resolve(
    guardDirectory,
    'tools/scripts/copilot-hooks/read-policy.ts',
  );
  let policy: { inspectReadNode?: (node: unknown) => unknown };
  try {
    policy = await import(pathToFileURL(module).href);
  } catch {
    throw new Error('Could not verify repository read policy');
  }
  const inspect = policy.inspectReadNode;
  if (typeof inspect !== 'function')
    throw new Error('Could not verify repository read policy');
  return (path: string): boolean => {
    const reason = inspect({ path });
    if (reason === null) return true;
    if (typeof reason === 'string' && reason) return false;
    throw new Error('Could not verify repository read policy');
  };
}

// Capture a bounded, immutable view before starting the restricted child.
// A failed guard, changing file or exceeded bound aborts the whole capture.
export async function captureSource(
  rootDirectory: string,
  guardDirectory: string,
  destination: string,
) {
  const root = realpathSync.native(rootDirectory);
  const files: Array<[string, string]> = [];
  let visited = 0;
  let totalBytes = 0;
  const canRead = await loadReadPolicy(guardDirectory);

  function isInside(path: string) {
    const remainder = relative(root, realpathSync.native(path));
    return (
      !isAbsolute(remainder) &&
      remainder !== '..' &&
      !remainder.startsWith(`..${sep}`)
    );
  }

  function walk(directory: string) {
    if (!isInside(directory)) throw new Error('Directory outside worktree');
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 50000) throw new Error('Source traversal limit exceeded');
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink() || !isInside(path)) continue;
      const name = relative(root, path).split(sep).join('/');
      if (!canRead(name)) continue;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const before = lstatSync(path, { bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.size > 1048576n)
        continue;
      const descriptor = openSync(path, 'r');
      try {
        const opened = fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          opened.nlink !== 1n ||
          opened.ino !== before.ino ||
          opened.dev !== before.dev ||
          opened.size !== before.size ||
          !isInside(path)
        ) {
          throw new Error('Source changed during capture');
        }
        const bytes = Buffer.alloc(Number(opened.size));
        if (readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length)
          throw new Error('Source changed during capture');
        if (bytes.includes(0)) continue;
        let content;
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          continue;
        }
        totalBytes += bytes.length;
        if (totalBytes > 64 * 1024 * 1024)
          throw new Error('Source snapshot size limit exceeded');
        files.push([name, content]);
      } finally {
        closeSync(descriptor);
      }
    }
  }

  walk(root);
  writeFileSync(destination, JSON.stringify(files), {
    flag: 'wx',
    mode: 0o600,
  });
  return files.map(([name]) => name);
}
