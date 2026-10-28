import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  SECRET_SCAN_HOOK,
  expectAllowed,
  expectDenied,
  shellPayload,
} from './hook-harness.ts';

/**
 * Every credential-shaped fixture is assembled from fragments at runtime. A
 * literal one would trip this very hook when the file is written, and would
 * also trip repository and CI secret scanning.
 */
const AWS_ACCESS_KEY = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('');
const GITHUB_TOKEN = ['ghp', '_', 'a'.repeat(36)].join('');
const PRIVATE_KEY_MARKER = ['-----BEGIN ', 'RSA PRIVATE KEY', '-----'].join('');

// Fixture for testing the literal credential-like value pattern (28 chars).
// Assembled from fragments to avoid triggering secret scanning in this file.
const PASSPHRASE_FIXTURE = [
  'pass',
  'phrase = ',
  "'",
  'correct horse battery staple',
  "'",
].join('');

// Compute REPO_ROOT: this suite is at tools/scripts/copilot-hooks/secret-scan.test.ts,
// so 3 levels up from its directory reaches the repository root.
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

describe('secret-scan hook', () => {
  describe('credential detection', () => {
    it('should deny a command containing an AWS access key', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        shellPayload('Bash', `echo ${AWS_ACCESS_KEY}`),
        /secret|credential/i,
      );
    });

    it('should deny a command containing a GitHub token', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        shellPayload('Bash', `echo ${GITHUB_TOKEN}`),
        /github|secret|token/i,
      );
    });

    it('should deny a command containing a private key marker', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        shellPayload('Bash', `echo "${PRIVATE_KEY_MARKER}"`),
        /private key/i,
      );
    });

    it('should deny credential material passed through a Write tool call', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            file_path: 'src/config.ts',
            content: `export const key = '${AWS_ACCESS_KEY}';`,
          },
        },
        /secret|credential/i,
      );
    });
  });

  describe('benign input', () => {
    it('should allow a plain echo', () => {
      expectAllowed(SECRET_SCAN_HOOK, shellPayload('Bash', 'echo hello world'));
    });

    it('should allow a Write tool call with ordinary source content', () => {
      expectAllowed(SECRET_SCAN_HOOK, {
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/app/page.tsx',
          content: 'export default function Page() { return null; }',
        },
      });
    });
  });

  describe('reviewer answer sheet exemption', () => {
    // Case 1: Write to tmp/code-review with absolute path
    it('should allow credential-like fixture in Write to tmp/code-review with absolute path', () => {
      expectAllowed(SECRET_SCAN_HOOK, {
        tool_name: 'Write',
        tool_input: {
          file_path: join(
            REPO_ROOT,
            'tmp',
            'code-review',
            'obligations.answers.json',
          ),
          content: `{"answer": "${PASSPHRASE_FIXTURE}"}`,
        },
      });
    });

    // Case 2: Write to tmp/code-review with relative path and cwd
    it('should allow credential-like fixture in Write to tmp/code-review with relative path and cwd', () => {
      expectAllowed(SECRET_SCAN_HOOK, {
        tool_name: 'Write',
        tool_input: {
          file_path: 'tmp/code-review/report.json',
          content: `{"citation": "${PASSPHRASE_FIXTURE}"}`,
        },
        cwd: REPO_ROOT,
      });
    });

    // Case 3: Write to tmp/code-review with backslashes and mixed case
    it('should allow fixture in Write to tmp/code-review with normalized path separators and case', () => {
      const normalPath = join(REPO_ROOT, 'tmp', 'code-review', 'report.json');
      const mixedCasePath = normalPath.replace(/\//g, '\\').toUpperCase();
      expectAllowed(SECRET_SCAN_HOOK, {
        tool_name: 'Write',
        tool_input: {
          file_path: mixedCasePath,
          content: `{"data": "${PASSPHRASE_FIXTURE}"}`,
        },
      });
    });

    // Case 4: Edit with file_path inside tmp/code-review
    it('should allow credential-like fixture in Edit to tmp/code-review', () => {
      expectAllowed(SECRET_SCAN_HOOK, {
        tool_name: 'Edit',
        tool_input: {
          file_path: join(REPO_ROOT, 'tmp', 'code-review', 'answers.json'),
          old_string: '"answer": ""',
          new_string: `"answer": "${PASSPHRASE_FIXTURE}"`,
        },
      });
    });

    // Case 5: Write with credential fixture outside tmp/code-review
    it('should deny credential-like fixture in Write outside tmp/code-review', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            file_path: join(REPO_ROOT, 'src', 'config.ts'),
            content: `const x = "${PASSPHRASE_FIXTURE}";`,
          },
        },
        /credential|literal/i,
      );
    });

    // Case 6a: Shell command with credential fixture
    it('should deny credential-like fixture in shell command', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        shellPayload('Bash', `echo "${PASSPHRASE_FIXTURE}"`),
        /credential|literal/i,
      );
    });

    // Case 6b: Shell command with fixture even when output redirects to tmp/code-review
    it('should deny credential-like fixture in shell command even with tmp/code-review redirect', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        shellPayload(
          'Bash',
          `echo "${PASSPHRASE_FIXTURE}" > ${join(REPO_ROOT, 'tmp', 'code-review', 'output.json')}`,
        ),
        /credential|literal/i,
      );
    });

    // Case 7a: GitHub token in tmp/code-review (proves only literal credential pattern exempt)
    it('should deny GitHub token even in tmp/code-review', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            file_path: join(REPO_ROOT, 'tmp', 'code-review', 'answers.json'),
            content: `{"token": "${GITHUB_TOKEN}"}`,
          },
        },
        /github|token/i,
      );
    });

    // Case 7b: Private key marker in tmp/code-review
    it('should deny private key marker even in tmp/code-review', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            file_path: join(REPO_ROOT, 'tmp', 'code-review', 'answers.json'),
            content: `{"key": "${PRIVATE_KEY_MARKER}"}`,
          },
        },
        /private key/i,
      );
    });

    // Case 8: Path traversal attack with ..
    it('should deny credential-like fixture with path traversal outside tmp/code-review', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            file_path: join(
              REPO_ROOT,
              'tmp',
              'code-review',
              '..',
              '..',
              'apps',
              'x.ts',
            ),
            content: `const x = "${PASSPHRASE_FIXTURE}";`,
          },
        },
        /credential|literal/i,
      );
    });

    // Case 9: Sibling directory tmp/code-review-evil
    it('should deny credential-like fixture in sibling tmp/code-review-evil', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            file_path: join(
              REPO_ROOT,
              'tmp',
              'code-review-evil',
              'report.json',
            ),
            content: `{"data": "${PASSPHRASE_FIXTURE}"}`,
          },
        },
        /credential|literal/i,
      );
    });

    // Case 10a: Path with tmp/code-review substring inside apps
    it('should deny credential-like fixture in apps/tmp/code-review', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            file_path: join(
              REPO_ROOT,
              'apps',
              'tmp',
              'code-review',
              'report.json',
            ),
            content: `{"data": "${PASSPHRASE_FIXTURE}"}`,
          },
        },
        /credential|literal/i,
      );
    });

    // Case 10b: Relative path with cwd pointing outside REPO_ROOT
    it('should deny credential-like fixture in relative tmp/code-review with cwd outside repo root', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            file_path: 'tmp/code-review/report.json',
            content: `{"data": "${PASSPHRASE_FIXTURE}"}`,
          },
          cwd: join(REPO_ROOT, 'apps'),
        },
        /credential|literal/i,
      );
    });

    // Case 11: Write with no file_path
    it('should deny credential-like fixture when Write has no file_path', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            content: `const x = "${PASSPHRASE_FIXTURE}";`,
          },
        },
        /credential|literal/i,
      );
    });

    // Case 12: Path is the directory itself (no file)
    it('should deny credential-like fixture when path is tmp/code-review directory itself', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            file_path: join(REPO_ROOT, 'tmp', 'code-review'),
            content: `const x = "${PASSPHRASE_FIXTURE}";`,
          },
        },
        /credential|literal/i,
      );
    });

    // Case 13: Non-Write/Edit tool with file_path inside tmp/code-review
    it('should deny credential-like fixture in non-Write/Edit tool even with file_path inside tmp/code-review', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Bash',
          tool_input: {
            command: `echo "${PASSPHRASE_FIXTURE}"`,
            file_path: join(REPO_ROOT, 'tmp', 'code-review', 'output.json'),
          },
        },
        /credential|literal/i,
      );
    });

    // Case 14: MultiEdit with destination inside tmp/code-review
    it('should allow credential-like fixture in MultiEdit to tmp/code-review', () => {
      expectAllowed(SECRET_SCAN_HOOK, {
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: join(REPO_ROOT, 'tmp', 'code-review', 'report.json'),
          edits: [
            {
              old_string: 'a',
              new_string: PASSPHRASE_FIXTURE,
            },
          ],
        },
      });
    });

    // Case 15: Write with multiple destinations, one inside and one outside tmp/code-review
    it('should deny credential-like fixture in Write with mixed destinations (some outside)', () => {
      expectDenied(
        SECRET_SCAN_HOOK,
        {
          tool_name: 'Write',
          tool_input: {
            files: [
              join(REPO_ROOT, 'tmp', 'code-review', 'inside.json'),
              join(REPO_ROOT, 'src', 'config.ts'),
            ],
            content: `const x = "${PASSPHRASE_FIXTURE}";`,
          },
        },
        /credential/i,
      );
    });
  });
});
