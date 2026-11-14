#!/usr/bin/env node
// Runs a QA Plan's scenario scripts on Before and After in real Chromium
// (ADR 0147 decisions 1-5 and 7).
//
//   node tools/qa/qa-run.ts --worktree <path> --change-kind fix|feature
//        --merge-base <sha> --head <sha> --scenarios <dir under tmp/qa/>
//        --out <dir under tmp/qa/> [--with-before]
//
// Each `*.ts` in --scenarios exports `{ id, capture, run }`, where `capture`
// is the plan's `Capture:` line (video, screenshot, transcript or none); a
// video or screenshot scenario also declares `title` and
// `expected: { before, after }` and calls `step()` for each still, and a
// video scenario declares `tab`, the tab its MP4 follows. The
// runner starts the QA stack (`yarn qa:stack:start`), runs every scenario on
// Before then, after `yarn qa:switch`, on After for a fix (After only for a
// feature, re-running on a fresh merge-base stack only what failed). Every
// run records a video, a final screenshot and its backend calls; it keeps
// what the `Capture:` line asks for, and a failed run's video locally. Then
// it grades (`qa:grade`), renders each screen scenario's Storyboard PNG in
// Chromium from its steps, makes each video scenario's annotated MP4 of the
// tab it names (`tab`), redacts each Request Transcript (`qa:redact`), and
// writes `<out>/run.json`,
// marking what may be offered for upload. The stack is left up for judgement
// checks; stop it with `yarn qa:stack:stop`.
//
// Exit 0 = graded and not QA failed, every kept file made; 1 = QA failed,
// the stack or a switch failed closed (no scenario ran on that side), or a
// kept file could not be made; 2 = bad invocation, a malformed script, a
// missing Chromium or ffmpeg, or a stack start that reports one. The rules
// are tools/qa/lib/qa-run.ts; the steps run in tools/qa/lib/qa-run-executor.ts.
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { makeAnnotatedVideo } from './lib/qa-combine-executor.ts';
import { nodeQaDeps } from './lib/qa-node-deps.ts';
import {
  chromiumMissing,
  chromiumRunner,
  qaAccountLookup,
} from './lib/qa-run-browser.ts';
import { type RunDeps, runQaRun } from './lib/qa-run-executor.ts';
import { runQaStack, runQaSwitch } from './lib/qa-stack-executor.ts';
import { storyboardRenderer } from './lib/storyboard-render.ts';
import { nodeAnnotateDeps } from './lib/video-overlay-render.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const qaDeps = nodeQaDeps(repoRoot);

const deps: RunDeps = {
  repoRoot,
  stack: (argv) => runQaStack(argv, qaDeps),
  switchStack: (argv) => runQaSwitch(argv, qaDeps),
  renderStoryboard: storyboardRenderer(repoRoot),
  annotateVideo: (plan) => makeAnnotatedVideo(plan, nodeAnnotateDeps(repoRoot)),
  chromiumMissing,
  // The annotated MP4 reads each recording's length with ffprobe, which ships with ffmpeg.
  ffmpegMissing: () =>
    ['ffmpeg', 'ffprobe'].some(
      (program) =>
        qaDeps.run([program, '-version'], { cwd: repoRoot }).status !== 0,
    ),
  listScenarioFiles(dir) {
    try {
      return readdirSync(dir)
        .filter((name) => name.endsWith('.ts'))
        .sort()
        .map((name) => join(dir, name));
    } catch {
      return [];
    }
  },
  loadScenario: async (file) =>
    ((await import(pathToFileURL(file).href)) as { default?: unknown }).default,
  runScenario: chromiumRunner(qaAccountLookup(repoRoot)),
  makeDir: (path) => void mkdirSync(path, { recursive: true }),
  moveFile: (from, to) => renameSync(from, to),
  // Owner-only (0600): a refused transcript's calls file holds QA Account data.
  writeFile: (path, text) => qaDeps.writeFile(path, text),
  removePath: (path) => rmSync(path, { recursive: true, force: true }),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

process.exit(await runQaRun(process.argv.slice(2), deps));
