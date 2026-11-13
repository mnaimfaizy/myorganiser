/**
 * The real machine behind `CombineDeps`, for `tools/qa/qa-combine.ts` and
 * `tools/qa/qa-run.ts`. Kept apart from `qa-combine-executor.ts` so a test of
 * the executor never loads it: no unit test starts ffmpeg. The annotated
 * MP4's machine, which also needs Chromium, is `nodeAnnotateDeps` in
 * `video-overlay-render.ts`, so the `qa:combine` CLI never loads a browser.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';

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
    makeDir: (path) => void mkdirSync(path, { recursive: true }),
    removePath: (path) => rmSync(path, { recursive: true, force: true }),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
}
