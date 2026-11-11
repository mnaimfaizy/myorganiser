#!/usr/bin/env node
// Combines a Before and an After QA Artifact into one (ADR 0147 decision 5).
//
//   node tools/qa/qa-combine.ts --before <file> --after <file> --out <path> [--height <px>]
//
// A screenshot pair (.png/.jpg) becomes `<out>.png`, one labelled
// side-by-side image. A video pair (.webm/.mp4/.mov) becomes `<out>.mp4`, one
// side-by-side video, and `<out>.gif`, a preview held under 2 MiB so it can
// show inline in a QA Report. Both sides are scaled to `--height` (default
// 720, even). Wraps the system ffmpeg; it is not an npm dependency.
//
// Combining is not uploading: only a combined file may be offered for upload
// (tools/qa/lib/upload-eligibility.ts), and the Maintainer chooses.
//
// Exit 0 = combined (the files are printed as JSON), 1 = ffmpeg failed or no
// GIF fits the cap (nothing is left behind), 2 = bad invocation, a missing
// input, or ffmpeg not installed (never a result). The rules are
// tools/qa/lib/qa-combine.ts; the steps run in lib/qa-combine-executor.ts.
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

import { type CombineDeps, runCombine } from './lib/qa-combine-executor.ts';

const deps: CombineDeps = {
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

process.exit(runCombine(process.argv.slice(2), deps));
