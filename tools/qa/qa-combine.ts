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
import { runCombine } from './lib/qa-combine-executor.ts';
import { nodeCombineDeps } from './lib/qa-combine-node-deps.ts';

process.exit(runCombine(process.argv.slice(2), nodeCombineDeps()));
