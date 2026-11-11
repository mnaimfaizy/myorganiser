/**
 * The real machine behind `CombineDeps`, for `tools/qa/qa-combine.ts` and
 * `tools/qa/qa-run.ts`. Kept apart from `qa-combine-executor.ts` so a test of
 * the executor never loads it: no unit test starts ffmpeg.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CombineDeps } from './qa-combine-executor.ts';

export function nodeCombineDeps(): CombineDeps {
  return {
    run(argv) {
      const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
      return {
        status: result.error ? null : result.status,
        stderr: result.error ? result.error.message : (result.stderr ?? ''),
      };
    },
    exists: existsSync,
    fileSize(path) {
      try {
        return statSync(path).size;
      } catch {
        return null;
      }
    },
    makeTempDir: () => mkdtempSync(join(tmpdir(), 'qa-combine-')),
    makeDir: (path) => void mkdirSync(path, { recursive: true }),
    writeFile: writeFileSync,
    removePath: (path) => rmSync(path, { recursive: true, force: true }),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
}
