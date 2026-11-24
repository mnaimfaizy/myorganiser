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
