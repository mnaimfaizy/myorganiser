#!/usr/bin/env node
// Starts, stops and reports on the local QA stack: web, backend and a
// database for one QA session (ADR 0147 decisions 2 and 9).
//
//   node tools/qa/qa-stack.ts start --worktree <path> --change-kind fix|feature
//        --merge-base <sha> --head <sha> [--with-before | --before-only]
//        [--database-url <url>]
//   node tools/qa/qa-stack.ts stop
//   node tools/qa/qa-stack.ts status
//
// The stack runs on web 4300, backend 3300 and its own Postgres container on
// 127.0.0.1:5499, never on the Maintainer's 4200/3000/5453. It refuses a
// database that is not local, the primary checkout, a worktree with
// uncommitted changes, and a port already in use. It seeds the QA Accounts
// once, at start; `yarn qa:switch` moves it from Before to After. State and
// the generated environment live in tmp/qa/stack/, never committed.
//
// Exit 0 = done (status: up and serving its commit), 1 = a refusal, a failed
// step or a served-commit mismatch (status: not up, or not serving it),
// 2 = bad invocation or a missing dependency. The rules are
// tools/qa/lib/qa-stack.ts and tools/qa/lib/qa-switch.ts; the steps run in
// tools/qa/lib/qa-stack-executor.ts.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeQaDeps } from './lib/qa-node-deps.ts';
import { runQaStack } from './lib/qa-stack-executor.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.exit(await runQaStack(process.argv.slice(2), nodeQaDeps(repoRoot)));
