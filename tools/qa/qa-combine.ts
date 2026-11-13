#!/usr/bin/env node
// Stacks a Before and an After file side by side: interim until #1550, which
// makes this command re-render a scenario's Storyboard and MP4 from a run's
// saved step records and refuses a bare file pair.
//
//   node tools/qa/qa-combine.ts --before <file> --after <file> --out <path> [--height <px>]
//
// A screenshot pair (.png/.jpg) becomes `<out>.png`, a video pair
// (.webm/.mp4/.mov) `<out>.mp4`, Before on the left, unlabelled (PRD
// #1544). Both sides are scaled
// to `--height` (default 720, even). Wraps the system ffmpeg; it is not an
// npm dependency. `yarn qa:run` makes a video scenario's annotated MP4 itself.
//
// Combining is not uploading: only a combined file may be offered for upload
// (tools/qa/lib/upload-eligibility.ts), and the Maintainer chooses.
//
// Exit 0 = combined (the file is printed as JSON), 1 = ffmpeg failed
// (nothing is left behind), 2 = bad invocation, a missing input, or ffmpeg
// not installed (never a result). The rules are tools/qa/lib/qa-combine.ts;
// the steps run in lib/qa-combine-executor.ts.
import { runCombine } from './lib/qa-combine-executor.ts';
import { nodeCombineDeps } from './lib/qa-combine-node-deps.ts';

process.exit(runCombine(process.argv.slice(2), nodeCombineDeps()));
