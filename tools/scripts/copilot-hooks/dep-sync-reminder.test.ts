/**
 * Tests for the dep-sync-reminder hook.
 *
 * Uses Node's built-in test runner (node --test).
 * Run with: node --test tools/scripts/copilot-hooks/dep-sync-reminder.test.ts
 *
 * Imports the real module rather than re-typing its regexes and message loop.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  SHELL_TOOL_NAMES,
  buildDepSyncMessages,
  extractCommand,
  isPackageMutation,
  shouldEmitReminder,
} from './dep-sync-reminder.ts';

const DEP_SYNC_LINE =
  'package.json may have changed — run /dep-sync to update TECH_STACK.md.';

function makeTmp() {
  return mkdtempSync(join(process.cwd(), 'tmp-'));
}

function writeInstalled(repoDir: string, lead: string, version: string) {
  const dir = join(repoDir, 'node_modules', lead);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
}

function writeReport(
  briefDir: string,
  lead: string,
  baseline: string,
  checkedAndClear: { claim: string; holdsFor: string }[],
) {
  mkdirSync(briefDir, { recursive: true });
  writeFileSync(
    join(briefDir, `${lead}-report.json`),
    JSON.stringify({
      schemaVersion: 1,
      date: '2026-09-17',
      commit: 'abc123',
      ecosystems: [{ lead, baseline, checkedAndClear }],
    }),
  );
}

function shellPayload(toolName: string, command: string) {
  return { tool_name: toolName, tool_input: { command } };
}

// ── Package-mutation detection ─────────────────────────────────────────

test('dep-sync-reminder: treats yarn/npm/pnpm mutations as package mutations', () => {
  assert.equal(isPackageMutation('yarn add lodash'), true);
  assert.equal(isPackageMutation('npm install'), true);
  assert.equal(isPackageMutation('pnpm remove lodash'), true);
});

test('dep-sync-reminder: ignores non-package commands', () => {
  assert.equal(isPackageMutation('yarn build'), false);
  assert.equal(isPackageMutation('yarn test'), false);
  assert.equal(isPackageMutation('git commit'), false);
  assert.equal(isPackageMutation('ls -la'), false);
});

test('dep-sync-reminder: emits only for shell tools on a package mutation', () => {
  assert.equal(
    shouldEmitReminder(shellPayload('bash', 'yarn add lodash')),
    true,
  );
  assert.equal(
    shouldEmitReminder(shellPayload('powershell', 'npm install')),
    true,
  );
  assert.equal(
    shouldEmitReminder(shellPayload('write', 'yarn add lodash')),
    false,
  );
  assert.equal(
    shouldEmitReminder(shellPayload('edit', 'yarn add lodash')),
    false,
  );
});

test('dep-sync-reminder: recognizes every harness shell tool name', () => {
  const toolNames = [
    'bash',
    'command',
    'execute',
    'powershell',
    'run',
    'runterminalcommand',
    'shell',
  ];

  for (const toolName of toolNames) {
    assert.equal(
      SHELL_TOOL_NAMES.has(toolName),
      true,
      `Tool name "${toolName}" should be recognized as a shell tool`,
    );
    assert.equal(
      shouldEmitReminder(shellPayload(toolName, 'yarn add lodash')),
      true,
    );
  }
});

test('dep-sync-reminder: reads the command from each supported input key', () => {
  assert.equal(extractCommand('yarn add lodash'), 'yarn add lodash');
  assert.equal(
    extractCommand({ command: 'yarn add lodash' }),
    'yarn add lodash',
  );
  assert.equal(extractCommand({ cmd: 'npm install' }), 'npm install');
  assert.equal(
    extractCommand({ script: 'pnpm remove lodash' }),
    'pnpm remove lodash',
  );
  assert.equal(extractCommand({ shell: 'yarn upgrade' }), 'yarn upgrade');
  assert.equal(extractCommand(null), '');
  assert.equal(extractCommand(undefined), '');
  assert.equal(extractCommand({}), '');
  assert.equal(extractCommand([]), '');

  assert.equal(
    shouldEmitReminder({
      tool_name: 'bash',
      tool_input: { cmd: 'npm install' },
    }),
    true,
  );
});

// ── Message building (real suggestion lookup) ──────────────────────────

test('dep-sync-reminder: emits only the DepSync line when no Ecosystem has moved', () => {
  const tmpDir = makeTmp();
  try {
    writeFileSync(
      join(tmpDir, 'upstream-brief.config.json'),
      JSON.stringify({
        ecosystems: [{ lead: 'test-pkg' }],
        brief_dir: 'brief',
      }),
    );
    const messages = buildDepSyncMessages(tmpDir);
    assert.deepEqual(messages, [DEP_SYNC_LINE]);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('dep-sync-reminder: appends an upstream-brief line after DepSync when a Baseline has moved', () => {
  const tmpDir = makeTmp();
  const briefDir = join(tmpDir, 'brief');
  try {
    writeFileSync(
      join(tmpDir, 'upstream-brief.config.json'),
      JSON.stringify({ ecosystems: [{ lead: 'nx' }], brief_dir: 'brief' }),
    );
    writeInstalled(tmpDir, 'nx', '22.8.0');
    writeReport(briefDir, 'nx', '22.7.7', []);

    const messages = buildDepSyncMessages(tmpDir);
    assert.equal(messages[0], DEP_SYNC_LINE);
    assert.equal(
      messages[1],
      'Run /upstream-brief nx — its Baseline has moved.',
    );
    assert.equal(messages.length, 2);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('dep-sync-reminder: fail-open keeps the DepSync line when suggestion lookup throws', () => {
  const messages = buildDepSyncMessages('/unused', () => {
    throw new Error('Mock resolver failure');
  });
  assert.deepEqual(messages, [DEP_SYNC_LINE]);
});
