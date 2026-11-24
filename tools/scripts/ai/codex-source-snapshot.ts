import { spawnSync } from 'node:child_process';
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
import { TextDecoder } from 'node:util';

// Capture a bounded, immutable view before starting the restricted child.
// A failed guard, changing file or exceeded bound aborts the whole capture.
export function captureSource(
  rootDirectory: string,
  guardDirectory: string,
  destination: string,
) {
  const root = realpathSync(rootDirectory);
  const files: Array<[string, string]> = [];
  let visited = 0;
  let totalBytes = 0;
  const guard = resolve(
    guardDirectory,
    'tools/scripts/copilot-hooks/pre-tool-use.ts',
  );

  function isInside(path: string) {
    const remainder = relative(root, realpathSync(path));
    return (
      !isAbsolute(remainder) &&
      remainder !== '..' &&
      !remainder.startsWith(`..${sep}`)
    );
  }

  function canRead(path: string) {
    const result = spawnSync(process.execPath, [guard], {
      cwd: guardDirectory,
      input: JSON.stringify({ toolName: 'read', toolArgs: { path } }),
      encoding: 'utf8',
      timeout: 4000,
      maxBuffer: 8192,
      windowsHide: true,
    });
    let decision;
    try {
      decision = JSON.parse(result.stdout).permissionDecision;
    } catch {
      throw new Error('Could not verify repository read policy');
    }
    if (result.status === 0 && decision === 'allow') return true;
    if (result.status === 2 && decision === 'deny') return false;
    throw new Error('Could not verify repository read policy');
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
