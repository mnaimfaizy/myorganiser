import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { describe, it } from 'node:test';
import {
  PRE_TOOL_USE_HOOK,
  CODEX_HOOK_ARGS,
  codexPayload,
  SECRET_SCAN_HOOK,
  runHookRaw,
  expectDenied,
  shellPayload,
} from './hook-harness.ts';

const ENV_FILE = '.env';

describe('Codex guard approval flow', () => {
  const commands = [
    codexPayload('Bash', 'git status --short'),
    codexPayload('Bash', 'Set-Content notes.md example'),
    codexPayload(
      'apply_patch',
      '*** Begin Patch\n*** Add File: notes.md\n+example\n*** End Patch',
    ),
  ];

  for (const hook of [PRE_TOOL_USE_HOOK, SECRET_SCAN_HOOK]) {
    it('leaves routine tools to Codex approvals for ' + basename(hook), () => {
      for (const event of commands) {
        const result = runHookRaw(hook, event, { args: CODEX_HOOK_ARGS });
        assert.deepEqual(result, { status: 0, stdout: '', stderr: '' });
      }
    });
  }
});

describe('--defer flag behavior', () => {
  describe('pre-tool-use hook with --defer', () => {
    it('should exit 0 with empty stdout on benign command', () => {
      const result = runHookRaw(PRE_TOOL_USE_HOOK, shellPayload('Bash', 'ls'), {
        args: ['--defer'],
      });

      assert.equal(result.status, 0);
      assert.equal(result.stdout, '');
    });

    it('should still deny a Write to a protected file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        {
          tool_name: 'Write',
          tool_input: { file_path: ENV_FILE, content: 'x' },
        },
        /environment/i,
        { args: ['--defer'] },
      );
    });

    it('should exit 0 with explicit allow JSON without --defer', () => {
      const result = runHookRaw(PRE_TOOL_USE_HOOK, shellPayload('Bash', 'ls'));

      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes('permissionDecision'));
      assert.ok(result.stdout.includes('allow'));
    });
  });

  describe('secret-scan hook with --defer', () => {
    it('should exit 0 with empty stdout on benign command', () => {
      const result = runHookRaw(
        SECRET_SCAN_HOOK,
        shellPayload('Bash', 'echo hello world'),
        { args: ['--defer'] },
      );

      assert.equal(result.status, 0);
      assert.equal(result.stdout, '');
    });
  });
});

describe('Antigravity guard approval flow', () => {
  const antigravityEvents = [
    {
      conversationId: 'conv-1',
      workspacePaths: [process.cwd()],
      hookEventName: 'PreToolUse',
      cwd: process.cwd(),
      stepIdx: 1,
      toolCall: {
        id: 'call-1',
        name: 'run_command',
        args: { CommandLine: 'git status --short' },
      },
    },
    {
      conversationId: 'conv-1',
      workspacePaths: [process.cwd()],
      hookEventName: 'PreToolUse',
      cwd: process.cwd(),
      stepIdx: 2,
      toolCall: {
        id: 'call-2',
        name: 'write_file',
        args: { Path: 'src/notes.md', Content: 'hello' },
      },
    },
    {
      conversationId: 'conv-1',
      workspacePaths: [process.cwd()],
      hookEventName: 'PreToolUse',
      cwd: process.cwd(),
      stepIdx: 3,
      toolCall: {
        id: 'call-3',
        name: 'edit_file',
        args: { Path: 'src/notes.md', Target: 'hello', Replacement: 'world' },
      },
    },
    {
      conversationId: 'conv-1',
      workspacePaths: [process.cwd()],
      hookEventName: 'PreToolUse',
      cwd: process.cwd(),
      stepIdx: 4,
      toolCall: {
        id: 'call-4',
        name: 'read_file',
        args: { Path: 'src/notes.md' },
      },
    },
  ];

  for (const hook of [PRE_TOOL_USE_HOOK, SECRET_SCAN_HOOK]) {
    it(
      'returns {} on routine tools under --antigravity --defer for ' +
        basename(hook),
      () => {
        for (const event of antigravityEvents) {
          const result = runHookRaw(hook, event, {
            args: ['--antigravity', '--defer'],
          });
          assert.deepEqual(result, { status: 0, stdout: '{}', stderr: '' });
        }
      },
    );

    it(
      'returns {"decision":"allow"} on routine tools under --antigravity without --defer for ' +
        basename(hook),
      () => {
        const result = runHookRaw(hook, antigravityEvents[0], {
          args: ['--antigravity'],
        });
        assert.deepEqual(result, {
          status: 0,
          stdout: '{"decision":"allow"}',
          stderr: '',
        });
      },
    );
  }

  it('still denies a protected write with exit 0 JSON under --antigravity --defer', () => {
    const result = runHookRaw(
      PRE_TOOL_USE_HOOK,
      {
        conversationId: 'conv-1',
        workspacePaths: [process.cwd()],
        hookEventName: 'PreToolUse',
        cwd: process.cwd(),
        stepIdx: 5,
        toolCall: {
          id: 'call-5',
          name: 'write_file',
          args: { Path: ENV_FILE, Content: 'SECRET=1' },
        },
      },
      { args: ['--antigravity', '--defer'] },
    );
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout) as {
      decision?: string;
      reason?: string;
    };
    assert.equal(parsed.decision, 'deny');
    assert.match(parsed.reason ?? '', /environment/i);
  });
});
