#!/usr/bin/env node
// Re-renders one scenario's QA Artifact from a `qa:run` output folder's saved
// step records (PRD #1544, #1550), so presentation can be iterated on without
// re-running Before and After.
//
//   node tools/qa/qa-combine.ts --run <qa:run --out folder> --scenario <id>
//
// Writes the scenario's Storyboard PNG, and its annotated MP4 for a `video`
// scenario, to `<folder>/combined/`, from `<folder>/steps/<id>.json`, the
// stills and the recordings `qa:run` kept; it calls the code `qa:run` does,
// so the files are the same. A bare `--before/--after` file pair is refused.
// Needs Playwright's Chromium, and the system ffmpeg for a `video` scenario.
// Secrets are not saved with a run, so only the Bearer/JWT half of the
// caption check is redone: an exact-secret check cannot be redone here.
//
// Combining is not uploading: only a combined file may be offered for upload
// (tools/qa/lib/upload-eligibility.ts), and the Maintainer chooses.
//
// Exit 0 = rendered (the files are printed as JSON), 1 = the render failed
// (nothing is rendered; the one move limit is in lib/qa-combine-executor.ts),
// 2 = bad invocation, a missing input, a scenario
// `qa:run` refused for caption privacy, or a missing dependency. The rules
// are tools/qa/lib/qa-combine.ts; the steps run in lib/qa-combine-executor.ts.
import { readFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeAnnotatedVideo, runCombine } from './lib/qa-combine-executor.ts';
import { nodeCombineDeps } from './lib/qa-combine-node-deps.ts';
import { chromiumMissing } from './lib/qa-run-browser.ts';
import { storyboardRenderer } from './lib/storyboard-render.ts';
import { nodeAnnotateDeps } from './lib/video-overlay-render.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

process.exit(
  await runCombine(process.argv.slice(2), {
    ...nodeCombineDeps(),
    readFile: (path) => readFileSync(path, 'utf8'),
    movePath: (from, to) => renameSync(from, to),
    renderStoryboard: storyboardRenderer(repoRoot),
    annotateVideo: (plan) =>
      makeAnnotatedVideo(plan, nodeAnnotateDeps(repoRoot)),
    chromiumMissing,
  }),
);
