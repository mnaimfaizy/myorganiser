import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLOUD_PERMISSION_REQUEST_HOOK,
  runHookRaw,
  shellPayload,
} from './hook-harness.ts';

describe('cloud-permission-request hook', () => {
  const cloudEnv = { CLAUDE_CODE_REMOTE: 'true' };

  describe('non-cloud session (env unset)', () => {
    it('should stay silent for an approvable push', () => {
      const result = runHookRaw(
        CLOUD_PERMISSION_REQUEST_HOOK,
        shellPayload('Bash', 'git push -u origin chore/1-test'),
        {
          env: { CLAUDE_CODE_REMOTE: undefined },
        },
      );

      assert.equal(result.status, 0);
      assert.equal(result.stdout, '');
    });
  });

  describe('cloud session — approvable commands', () => {
    const approvableCases: [toolName: string, command: string][] = [
      // git push with Bash
      ['Bash', 'git push -u origin chore/1-test'],
      ['Bash', 'git push origin feat/123:feat/123'],
      [
        'Bash',
        'corepack yarn ai:create-pr --title MyPR --body-file body.txt --merge-base abc123',
      ],
      ['Bash', 'yarn ai:create-pr --title t --body-file b --merge-base m'],
      ['Bash', 'git push --set-upstream origin feature-branch'],
      ['Bash', 'git push -u origin refs/heads/chore/1-test'],
      // git push with PowerShell
      ['PowerShell', 'git push -u origin chore/1-test'],
      ['PowerShell', 'git push origin feat/a:feat/a'],
    ];

    for (const [toolName, command] of approvableCases) {
      it(`should approve ${toolName} command: ${command}`, () => {
        const result = runHookRaw(
          CLOUD_PERMISSION_REQUEST_HOOK,
          shellPayload(toolName, command),
          { env: cloudEnv },
        );

        assert.equal(result.status, 0);
        assert.ok(result.stdout.includes('PermissionRequest'));
        assert.ok(result.stdout.includes('allow'));
      });
    }
  });

  describe('cloud session — commands that stay silent (no approval)', () => {
    const silentCases: [command: string][] = [
      // Protected branches and refs
      ['git push origin main'],
      ['git push origin master'],
      ['git push origin HEAD'],
      ['git push origin MAIN'],
      ['git push origin release/v1.0.0'],
      ['git push origin refs/heads/main'],
      ['git push origin refs/heads/MASTER'],
      ['git push origin refs/tags/v1.0'],
      ['git push origin refs/tags/v1.0.0'],

      // Push with refspec to protected
      ['git push origin chore/1-x:main'],
      ['git push origin feature:refs/tags/v1.0'],

      // Force push
      ['git push --force-with-lease origin feature'],
      ['git push origin +feature'],

      // Bare and incomplete
      ['git push'],
      ['git push origin'],

      // Non-origin remote
      ['git push upstream feature'],

      // Compound commands
      ['git push origin chore/1-x && echo done'],
      ['git push origin feature | cat'],
      ['git push origin feature; echo hi'],
      ['git push origin feature\necho hi'],

      // Command substitution
      ['git push origin $(echo feature)'],
      ['git push origin `echo feature`'],

      // Quoting with compound
      ['git push origin "feature" && other'],

      // Multiple colons in refspec
      ['git push origin feature:dest:extra'],
    ];

    for (const [command] of silentCases) {
      it(`should stay silent: ${command}`, () => {
        const result = runHookRaw(
          CLOUD_PERMISSION_REQUEST_HOOK,
          shellPayload('Bash', command),
          { env: cloudEnv },
        );

        assert.equal(result.status, 0);
        assert.equal(result.stdout, '');
      });
    }
  });

  describe('non-Bash/PowerShell tools and edge cases', () => {
    const nonShellCases: [toolName: string, toolInput: object][] = [
      ['Read', { file_path: 'src/app.ts' }],
      ['Write', { file_path: 'src/app.ts', content: 'code' }],
    ];

    for (const [toolName, toolInput] of nonShellCases) {
      it(`should stay silent for ${toolName} tool`, () => {
        const result = runHookRaw(
          CLOUD_PERMISSION_REQUEST_HOOK,
          { tool_name: toolName, tool_input: toolInput },
          { env: cloudEnv },
        );

        assert.equal(result.status, 0);
        assert.equal(result.stdout, '');
      });
    }
  });
});
