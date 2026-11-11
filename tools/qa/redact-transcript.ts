#!/usr/bin/env node
// Redacts a Request Transcript for the QA Report (ADR 0147 decision 7).
//
//   node tools/qa/redact-transcript.ts --input <file.json | ->
//
// Input is the calls a scenario made and what came back, Before and After;
// the shape is documented in tools/qa/lib/redact-transcript.ts. Output is one
// collapsed `<details>` block on stdout, ready to paste into the QA Report.
//
// Every field is allow-listed: safe fields pass through, credentials, cookies,
// tokens and authorization headers are withheld, and Ciphertext is shortened.
// URL-typed strings (path, query, location, anything that starts like a URL)
// are decoded and split into parameters; each parameter name is judged by the
// same allow-list. Any other field or parameter name refuses the whole
// transcript, naming where on stderr (`<path> key #n`, `<path> parameter #n`,
// `<path> (an @ in a URL)`) and
// never a value or an unrecognised name; nothing is written to stdout.
//
// Exit 0 = rendered, 1 = refused (an unknown field or parameter), 2 = bad invocation or
// malformed input. This does not capture traffic: the caller supplies the
// calls.
import { readFileSync } from 'node:fs';

import {
  TranscriptInputError,
  parseTranscriptInput,
  redactTranscript,
  renderTranscript,
} from './lib/redact-transcript.ts';

const USAGE =
  'usage: node tools/qa/redact-transcript.ts --input <file.json | ->';

function fail(message: string): never {
  console.error(`qa:redact: ${message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
const inputFlag = args.indexOf('--input');
const inputPath = inputFlag === -1 ? undefined : args[inputFlag + 1];
const extra = args.filter(
  (arg, index) => index !== inputFlag && index !== inputFlag + 1,
);
if (!inputPath || extra.length > 0) fail(USAGE);

let input: unknown;
try {
  input = JSON.parse(readFileSync(inputPath === '-' ? 0 : inputPath, 'utf8'));
} catch (error) {
  if (error instanceof SyntaxError) fail('input is not valid JSON');
  fail(`cannot read input "${inputPath}"`);
}

try {
  parseTranscriptInput(input);
} catch (error) {
  if (error instanceof TranscriptInputError) fail(error.message);
  throw error;
}

const result = redactTranscript(input);
if (!result.ok) {
  console.error(
    `qa:redact: refused - ${result.refusedPaths.length} problem(s), each named by position (a field or parameter not recognised as safe, an @ in a URL, or a URL that will not finish decoding):\n`,
  );
  for (const path of result.refusedPaths) console.error(`  - ${path}`);
  console.error(
    '\nNothing was rendered. If a field is safe, add it to the allow-list in tools/qa/lib/redact-transcript.ts; otherwise remove it from the calls.',
  );
  process.exit(1);
}

// No process.exit here: a pipe drains asynchronously, and exiting would cut a
// long transcript off at the pipe buffer.
process.stdout.write(renderTranscript(result.transcript));
process.exitCode = 0;
