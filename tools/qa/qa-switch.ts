#!/usr/bin/env node
// Moves the running QA stack to a Pull Request's Before (merge-base) or
// After (head), and confirms the commit it serves (ADR 0147 decision 2).
//
//   node tools/qa/qa-switch.ts --worktree <path> --to before|after
//
// Planned before anything runs: stop the services, check out, install if
// yarn.lock changed, migrate forward, start the services, check the served
// commit. Before always runs ahead of After, so a switch back to Before is
// refused rather than rolling the database back; the QA Accounts are not
// re-seeded, so Before and After share the same data. Moving to the side
// already served only re-checks it.
//
// Exit 0 = serving the side asked for, 1 = a refusal, a failed step, or a
// served-commit mismatch (run no scenario), 2 = bad invocation or a missing
// dependency. The plan is tools/qa/lib/qa-switch.ts.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeQaDeps } from './lib/qa-node-deps.ts';
import { runQaSwitch } from './lib/qa-stack-executor.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.exit(await runQaSwitch(process.argv.slice(2), nodeQaDeps(repoRoot)));
