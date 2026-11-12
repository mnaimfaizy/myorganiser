import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  formatGateHandoff,
  formatGateSkipNote,
  gateLogDigest,
  gateLogFileName,
  gateLogTail,
  GATE_PINNED_LINE_CHARS,
  GATE_PINNED_LINES,
  GATE_TAIL_LINE_CHARS,
  GATE_TAIL_LINES,
  GATE_TAIL_TOTAL_CHARS,
  sanitizeGateLabel,
  teeRunnerArgs,
} from './sandcastle-gate-log.ts';

const FIXED = new Date('2026-11-13T09:05:07.123Z');
const STAMP = '20261113T090507Z';

// ---------------------------------------------------------------------------
// Labels and file names
// ---------------------------------------------------------------------------

test('an issue label loses its leading hash in the file name', () => {
  assert.equal(sanitizeGateLabel('#1474'), '1474');
  assert.equal(gateLogFileName('#1474', FIXED), `1474--${STAMP}.log`);
});

test('a branch label turns its slash into a hyphen', () => {
  assert.equal(sanitizeGateLabel('feat/prd-slug'), 'feat-prd-slug');
  assert.equal(
    gateLogFileName('feat/prd-slug', FIXED),
    `feat-prd-slug--${STAMP}.log`,
  );
});

test('a label with no safe characters falls back to "gate"', () => {
  assert.equal(sanitizeGateLabel('!!!'), 'gate');
  assert.equal(sanitizeGateLabel('#'), 'gate');
  assert.equal(sanitizeGateLabel(''), 'gate');
  assert.equal(gateLogFileName('!!!', FIXED), `gate--${STAMP}.log`);
});

test('the stamp is the UTC time in YYYYMMDDTHHMMSSZ form, without milliseconds', () => {
  assert.equal(
    gateLogFileName('#1', new Date('2027-01-02T03:04:05.999Z')),
    '1--20270102T030405Z.log',
  );
});

// ---------------------------------------------------------------------------
// Bounded tail
// ---------------------------------------------------------------------------

test('empty or missing output gives an empty tail', () => {
  assert.deepEqual(gateLogTail(''), []);
  assert.deepEqual(gateLogTail(undefined as unknown as string), []);
});

test('output shorter than the line cap keeps every non-empty line', () => {
  assert.deepEqual(gateLogTail('one\ntwo\n\nthree\n'), ['one', 'two', 'three']);
});

test('output longer than the line cap keeps only the last lines', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const tail = gateLogTail(lines.join('\n'));
  assert.equal(tail.length, GATE_TAIL_LINES);
  assert.equal(tail[0], 'line 6');
  assert.equal(tail.at(-1), 'line 20');
});

test('blank and whitespace-only lines are dropped', () => {
  assert.deepEqual(gateLogTail('a\n\n   \n\t\nb'), ['a', 'b']);
});

test('ANSI colour codes are stripped before the tail is taken', () => {
  assert.deepEqual(
    gateLogTail('\u001b[31mERROR\u001b[0m: \u001b[1mbad\u001b[22m'),
    ['ERROR: bad'],
  );
});

test('a line wider than the per-line cap is cut and ends with an ellipsis', () => {
  const [line] = gateLogTail('x'.repeat(250));
  assert.equal(line.length, GATE_TAIL_LINE_CHARS);
  assert.equal(line, `${'x'.repeat(GATE_TAIL_LINE_CHARS - 1)}…`);
});

test('when the folded tail is over the total cap, the END of the output is kept', () => {
  // Each line is 149 chars; with the 3-char joiner each costs 152. Nine fit
  // under the 1500-char total; the tenth would push it over.
  const lines = Array.from(
    { length: GATE_TAIL_LINES },
    (_, i) => `${String(i).padStart(2, '0')}-${'x'.repeat(146)}`,
  );
  const tail = gateLogTail(lines.join('\n'));
  assert.equal(tail.length, 9);
  assert.ok(
    tail[0].startsWith('06-'),
    `first kept line was ${tail[0].slice(0, 5)}`,
  );
  assert.ok(
    tail.at(-1)!.startsWith('14-'),
    'the last line of the output is kept',
  );
});

test('a budget trims the tail from the top, and a zero budget still keeps the last line', () => {
  assert.deepEqual(gateLogTail('a\nb\nc', 5), ['c']);
  assert.deepEqual(gateLogTail('a\nb\nc', 0), ['c']);
  assert.deepEqual(gateLogTail('a\nb\nc', 100), ['a', 'b', 'c']);
});

// ---------------------------------------------------------------------------
// Pinned error lines
// ---------------------------------------------------------------------------

/** Lines with no error marker: they fill the tail window and push earlier lines above it. */
const quietLines = (count: number): string[] =>
  Array.from(
    { length: count },
    (_, i) => `note ${String(i + 1).padStart(2, '0')}: checking module`,
  );

test('an error line far above a run of trailing warnings is pinned', () => {
  const output = [
    'ERROR: the real cause',
    ...Array.from({ length: 20 }, (_, i) => `warning: unused ${i + 1}`),
  ].join('\n');
  const digest = gateLogDigest(output);
  assert.deepEqual(digest.pinned, ['ERROR: the real cause']);
  assert.equal(digest.tail.length, GATE_TAIL_LINES);
  assert.equal(digest.tail.at(-1), 'warning: unused 20');
});

test('an error line inside the tail window is not pinned a second time', () => {
  const output = ['ERROR: early', ...quietLines(20), 'ERROR: late one'].join(
    '\n',
  );
  const digest = gateLogDigest(output);
  assert.deepEqual(digest.pinned, ['ERROR: early']);
  assert.deepEqual(
    digest.tail.filter((line) => line === 'ERROR: late one'),
    ['ERROR: late one'],
  );
});

test('at most three earlier error lines are pinned, the first three in output order', () => {
  const output = [
    ...Array.from({ length: 6 }, (_, i) => `ERROR: earlier ${i + 1}`),
    ...quietLines(15),
  ].join('\n');
  const { pinned } = gateLogDigest(output);
  assert.equal(pinned.length, GATE_PINNED_LINES);
  assert.deepEqual(pinned, [
    'ERROR: earlier 1',
    'ERROR: earlier 2',
    'ERROR: earlier 3',
  ]);
});

test('"Found 0 errors" and plain warning lines are not pinned', () => {
  const output = [
    'Found 0 errors',
    'warning: plain line',
    ...quietLines(20),
  ].join('\n');
  assert.deepEqual(gateLogDigest(output).pinned, []);
});

test('a ✖ line, a FAIL line and a capitalised Error line are pinned', () => {
  const output = [
    '✖ 2 problems',
    'FAIL src/a.spec.ts',
    'Error: cannot find module',
    ...quietLines(20),
  ].join('\n');
  assert.deepEqual(gateLogDigest(output).pinned, [
    '✖ 2 problems',
    'FAIL src/a.spec.ts',
    'Error: cannot find module',
  ]);
});

test('a repeated error line is pinned once, and the next distinct one still gets a slot', () => {
  const output = [
    'ERROR: same',
    'ERROR: same',
    'ERROR: other',
    'ERROR: same',
    ...quietLines(15),
  ].join('\n');
  assert.deepEqual(gateLogDigest(output).pinned, [
    'ERROR: same',
    'ERROR: other',
  ]);
});

test('a pinned line wider than 240 characters is cut with an ellipsis; a 100-character one is intact', () => {
  const wide = `ERROR ${'a'.repeat(394)}`; // 400 characters
  const narrow = `ERROR ${'b'.repeat(94)}`; // 100 characters
  const [cut, intact] = gateLogDigest(
    [wide, narrow, ...quietLines(20)].join('\n'),
  ).pinned;
  assert.equal(cut.length, GATE_PINNED_LINE_CHARS);
  assert.equal(cut, `${wide.slice(0, GATE_PINNED_LINE_CHARS - 1)}…`);
  assert.equal(intact, narrow);
});

test('a pinned line of exactly 240 characters is kept whole; 241 is cut', () => {
  const exact = `ERROR ${'b'.repeat(234)}`; // 240 characters
  const over = `ERROR ${'c'.repeat(235)}`; // 241 characters
  const { pinned } = gateLogDigest([exact, over, ...quietLines(20)].join('\n'));
  assert.equal(pinned[0], exact);
  assert.equal(pinned[1].length, GATE_PINNED_LINE_CHARS);
  assert.ok(pinned[1].endsWith('…'));
});

test('pinned lines and the tail together stay within the total cap, and the tail keeps a line', () => {
  const output = [
    ...['A', 'B', 'C'].map((tag) => `ERROR ${tag} ${'x'.repeat(400)}`),
    ...Array.from(
      { length: GATE_TAIL_LINES },
      (_, i) => `tail ${i + 1} ${'y'.repeat(300)}`,
    ),
  ].join('\n');
  const { pinned, tail } = gateLogDigest(output);
  assert.equal(pinned.length, GATE_PINNED_LINES);
  assert.ok(tail.length >= 1, 'the tail keeps at least its last line');
  assert.equal(tail.at(-1)?.slice(0, 7), 'tail 15');
  const text = [...pinned, ...tail].join(' ⏎ ');
  assert.ok(
    text.length <= GATE_TAIL_TOTAL_CHARS,
    `pinned and tail text was ${text.length} characters`,
  );
});

// ---------------------------------------------------------------------------
// Handoff text
// ---------------------------------------------------------------------------

const LOG_PATH = '.sandcastle/logs/gate/1474--20261113T090507Z.log';

test('a PASS names the log and never carries the output', () => {
  const line = formatGateHandoff({
    ok: true,
    targets: 'lint test build',
    logPath: LOG_PATH,
    output: 'SECRET-OUTPUT-LINE',
  });
  assert.equal(line, `gate PASS (lint test build); gate log: ${LOG_PATH}`);
  assert.ok(!line.includes('SECRET-OUTPUT-LINE'));
});

test('a FAIL carries the path, the rejection, and the tail folded into one line', () => {
  const line = formatGateHandoff({
    ok: false,
    targets: 'lint test build',
    logPath: LOG_PATH,
    output: 'Compiling\nERROR: bad thing\ndone\n',
  });
  assert.equal(
    line,
    `gate FAILED (lint test build) — the agent's work was committed; ` +
      `the HOST GATE rejected it; gate log: ${LOG_PATH}; ` +
      'last 3 lines: Compiling ⏎ ERROR: bad thing ⏎ done',
  );
  assert.ok(!line.includes('\n'), 'the handoff is a single line');
});

test('a FAIL with empty output has no "last" clause', () => {
  const line = formatGateHandoff({
    ok: false,
    targets: 'lint test build',
    logPath: LOG_PATH,
    output: '',
  });
  assert.equal(
    line,
    `gate FAILED (lint test build) — the agent's work was committed; ` +
      `the HOST GATE rejected it; gate log: ${LOG_PATH}`,
  );
});

test('a handoff without a log path never mentions a gate log', () => {
  const pass = formatGateHandoff({ ok: true, targets: 'test' });
  const fail = formatGateHandoff({
    ok: false,
    targets: 'test',
    output: 'boom',
  });
  assert.equal(pass, 'gate PASS (test)');
  assert.ok(!pass.includes('gate log:'));
  assert.ok(!fail.includes('gate log:'));
  assert.ok(fail.endsWith('last 1 lines: boom'));
});

test('a FAIL with a pinned error line carries an error-lines clause before the tail, on one line', () => {
  const tail = Array.from(
    { length: GATE_TAIL_LINES },
    (_, i) => `filler ${String(i + 1).padStart(2, '0')}`,
  );
  const line = formatGateHandoff({
    ok: false,
    targets: 'test',
    logPath: LOG_PATH,
    output: ['ERROR: root', ...tail].join('\r\n') + '\r\n',
  });
  assert.equal(
    line,
    `gate FAILED (test) — the agent's work was committed; ` +
      `the HOST GATE rejected it; gate log: ${LOG_PATH}; ` +
      `error lines: ERROR: root; ` +
      `last ${GATE_TAIL_LINES} lines: ${tail.join(' ⏎ ')}`,
  );
  assert.ok(!line.includes('\n'), 'the handoff is a single line');
});

test('a FAIL whose only marker sits inside the tail has no error-lines clause', () => {
  const line = formatGateHandoff({
    ok: false,
    targets: 'test',
    output: [...quietLines(20), 'ERROR: only in the tail'].join('\n'),
  });
  assert.ok(!line.includes('error lines:'), line);
  assert.ok(line.includes('ERROR: only in the tail'));
});

test('the skip note is one line that ends with a newline and carries the reason', () => {
  const note = formatGateSkipNote('Docker is not running');
  assert.equal(note, 'gate did not run a container: Docker is not running\n');
  assert.equal(note.split('\n').length, 2, 'exactly one newline, at the end');
});

// ---------------------------------------------------------------------------
// Tee runner (spawns real child processes; each test has its own temp dir)
// ---------------------------------------------------------------------------

const makeDir = (t: { after: (fn: () => void) => void }, name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `gate-log-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const runTee = (logPath: string | undefined, command: string, args: string[]) =>
  spawnSync(process.execPath, teeRunnerArgs(logPath, command, args), {
    encoding: 'utf8',
  });

test('the child output reaches the terminal and the log, stdout and stderr alike', (t) => {
  const dir = makeDir(t, 'copy');
  const logPath = join(dir, 'run.log');
  const result = runTee(logPath, process.execPath, [
    '-e',
    "process.stdout.write('to-out\\n'); process.stderr.write('to-err\\n');",
  ]);

  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('to-out'), 'stdout carries child stdout');
  assert.ok(result.stderr.includes('to-err'), 'stderr carries child stderr');
  const saved = readFileSync(logPath, 'utf8');
  assert.ok(saved.includes('to-out'), 'log carries child stdout');
  assert.ok(saved.includes('to-err'), 'log carries child stderr');
});

test("the runner exits with the child's exit code", (t) => {
  const dir = makeDir(t, 'exit');
  const result = runTee(join(dir, 'run.log'), process.execPath, [
    '-e',
    'process.exit(3)',
  ]);
  assert.equal(result.status, 3);
});

test('child arguments that look like options reach the child, not the runner', (t) => {
  const dir = makeDir(t, 'argv');
  const childScript = join(dir, 'child.js');
  writeFileSync(
    childScript,
    'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
  );
  const result = runTee(join(dir, 'run.log'), process.execPath, [
    childScript,
    '--rm',
    '--some=value',
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, JSON.stringify(['--rm', '--some=value']));
});

test('an unwritable log path still runs the child: its output and exit code survive, with one warning', (t) => {
  const dir = makeDir(t, 'unwritable');
  const logPath = join(dir, 'missing-dir', 'run.log');
  const result = runTee(logPath, process.execPath, [
    '-e',
    "console.log('child-still-prints'); process.exit(4);",
  ]);

  assert.equal(result.status, 4);
  assert.ok(result.stdout.includes('child-still-prints'));
  const warnings = result.stderr.split('not saving the gate log').length - 1;
  assert.equal(
    warnings,
    1,
    `expected one warning, stderr was: ${result.stderr}`,
  );
});

test('an empty log path runs the child without a warning and without a file', (t) => {
  const dir = makeDir(t, 'nolog');
  const result = runTee('', process.execPath, [
    '-e',
    "console.log('quiet-child');",
  ]);

  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('quiet-child'));
  assert.ok(!result.stderr.includes('not saving the gate log'));
  assert.deepEqual(readdirSync(dir), []);
});

test('a command that cannot start exits 127', () => {
  const result = runTee(undefined, '/nonexistent/gate-log-test-binary', []);
  assert.equal(result.status, 127);
});

test('SIGTERM to the runner stops a long-sleeping child promptly', async (t) => {
  const dir = makeDir(t, 'sigterm');
  // The child reports its pid first, so the test knows whom to look for.
  const runner = spawn(
    process.execPath,
    teeRunnerArgs(join(dir, 'run.log'), process.execPath, [
      '-e',
      'console.log(process.pid); setInterval(() => {}, 1000);',
    ]),
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const pids: number[] = [];
  t.after(() => {
    if (runner.exitCode === null && runner.signalCode === null) {
      runner.kill('SIGKILL');
    }
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  });

  const childPid = await new Promise<number>((resolve, reject) => {
    let buf = '';
    runner.stdout.setEncoding('utf8');
    runner.stdout.on('data', (chunk: string) => {
      buf += chunk;
      const match = buf.match(/(\d+)\n/);
      if (match) resolve(Number(match[1]));
    });
    runner.on('error', reject);
    runner.on('exit', (code) =>
      reject(new Error(`runner exited before the child started: ${code}`)),
    );
  });

  pids.push(childPid);
  const exited = new Promise<number | null>((resolve) =>
    runner.on('exit', (code) => resolve(code)),
  );
  const started = Date.now();
  runner.kill('SIGTERM');
  const code = await exited;
  const elapsed = Date.now() - started;

  assert.equal(code, 1, 'a child killed by a signal makes the runner exit 1');
  assert.ok(elapsed < 5000, `runner took ${elapsed}ms to stop`);
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});
