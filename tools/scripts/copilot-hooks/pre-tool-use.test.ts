import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PRE_TOOL_USE_HOOK,
  expectAllowed,
  expectDenied,
  runHook,
  shellPayload,
} from './hook-harness.ts';

const ENV_FILE = '.env';
const ENV_EXAMPLE = '.env.example';
const GENERATED_SPEC = 'libs/api-specs/src/api-specs.openapi.yaml';
const GENERATED_CLIENT = 'libs/app-api-client/src/index.ts';
const GENERATED_SWAGGER = 'apps/backend/src/swagger/swagger.json';
const ORDINARY_SOURCE = 'src/app/page.tsx';
const API_CLIENT_README = 'libs/app-api-client/README.md';
const API_SPECS_AGENTS = 'libs/api-specs/AGENTS.md';

// Assembled from fragments so this file never contains a literal key filename
// that its own repo-wide scanners would flag.
const PRIVATE_SSH_KEY = `keys/${['id', 'rsa'].join('_')}`;

describe('pre-tool-use hook', () => {
  describe('read guard for read tools', () => {
    it('should deny reading an environment file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Read', tool_input: { file_path: ENV_FILE } },
        /environment/i,
      );
    });

    it('should allow reading the environment example file', () => {
      expectAllowed(PRE_TOOL_USE_HOOK, {
        tool_name: 'Read',
        tool_input: { file_path: ENV_EXAMPLE },
      });
    });

    it('should deny reading an SSH configuration directory', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Read', tool_input: { file_path: '~/.ssh/config' } },
        /ssh|key material/i,
      );
    });

    it('should deny reading a private SSH key', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Read', tool_input: { file_path: PRIVATE_SSH_KEY } },
        /private ssh key/i,
      );
    });

    it('should deny reading a pem bundle', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Read', tool_input: { file_path: 'certs/server.pem' } },
        /key or certificate/i,
      );
    });

    it('should deny reading a key file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Read', tool_input: { file_path: 'certs/tls.key' } },
        /key or certificate/i,
      );
    });

    it('should allow reading an ordinary source file', () => {
      expectAllowed(PRE_TOOL_USE_HOOK, {
        tool_name: 'Read',
        tool_input: { file_path: ORDINARY_SOURCE },
      });
    });

    it('should allow reading generated code that is only write-protected', () => {
      expectAllowed(PRE_TOOL_USE_HOOK, {
        tool_name: 'Read',
        tool_input: { file_path: GENERATED_SPEC },
      });
    });

    it('should deny a grep whose search path is an environment file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        {
          tool_name: 'Grep',
          tool_input: { pattern: 'token', path: ENV_FILE },
        },
        /environment/i,
      );
    });
  });

  describe('read guard for shell commands', () => {
    it('should deny reading an environment file through the shell', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `cat ${ENV_FILE}`),
        /environment/i,
      );
    });

    it('should allow reading the environment example file through the shell', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `cat ${ENV_EXAMPLE}`),
      );
    });

    it('should deny an environment read that appears mid-command', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `cat ${ENV_FILE} | head -5`),
        /environment/i,
      );
    });

    it('should deny reading a private SSH key through the shell', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `cat ${PRIVATE_SSH_KEY}`),
        /private ssh key/i,
      );
    });

    it('should deny reading a pem bundle from PowerShell', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('PowerShell', 'Get-Content certs/api.pem'),
        /key or certificate/i,
      );
    });
  });

  describe('write guard', () => {
    it('should deny redirecting output into an environment file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `echo x > ${ENV_FILE}`),
        /environment/i,
      );
    });

    it('should deny a Write tool call targeting an environment file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        {
          tool_name: 'Write',
          tool_input: { file_path: ENV_FILE, content: 'x' },
        },
        /environment/i,
      );
    });

    it('should deny an Edit tool call targeting the generated OpenAPI spec', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        {
          tool_name: 'Edit',
          tool_input: {
            file_path: GENERATED_SPEC,
            old_string: 'a',
            new_string: 'b',
          },
        },
        /openapi|generated/i,
      );
    });

    it('should deny appending into the generated API client', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `echo x >> ${GENERATED_CLIENT}`),
        /api client|generated/i,
      );
    });

    it('should allow deleting a Library README next to the generated API client', () => {
      expectAllowed(PRE_TOOL_USE_HOOK, {
        tool_name: 'Delete',
        tool_input: { path: API_CLIENT_README },
      });
    });

    it('should allow editing an Agent Guide next to the synced OpenAPI spec', () => {
      expectAllowed(PRE_TOOL_USE_HOOK, {
        tool_name: 'Write',
        tool_input: { file_path: API_SPECS_AGENTS, content: 'x' },
      });
    });

    it('should allow a Write tool call targeting an ordinary source file', () => {
      expectAllowed(PRE_TOOL_USE_HOOK, {
        tool_name: 'Write',
        tool_input: { file_path: ORDINARY_SOURCE, content: 'x' },
      });
    });

    it('should allow redirecting output into an ordinary source file', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', 'echo hi > src/foo.ts'),
      );
    });

    // Heredoc bodies are skipped by the path guard, so the header line is the
    // only thing standing between an agent and a hand-edited generated file.
    it('should deny a heredoc writing into generated Swagger output', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          [`cat > ${GENERATED_SWAGGER} <<'EOF'`, '{}', 'EOF'].join('\n'),
        ),
        /swagger|generated/i,
      );
    });

    it('should deny a heredoc writing into an environment file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          [`cat > ${ENV_FILE} <<'EOF'`, 'TOKEN=x', 'EOF'].join('\n'),
        ),
        /environment/i,
      );
    });
  });

  describe('false-positive regressions', () => {
    it('should allow a grep whose search pattern is the word secrets', () => {
      expectAllowed(PRE_TOOL_USE_HOOK, {
        tool_name: 'Grep',
        tool_input: { pattern: 'secrets', path: 'src' },
      });
    });

    it('should allow a glob whose pattern matches key files', () => {
      expectAllowed(PRE_TOOL_USE_HOOK, {
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.key' },
      });
    });

    it('should allow a shell grep for the word secrets', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', 'grep -r "secrets" src/'),
      );
    });

    it('should allow dot-key property access in shell code', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', 'node -e "return obj.key"'),
      );
    });

    it('should allow ordinary directory listing', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', 'ls .cursor/ .gemini/'),
      );
    });

    it('should allow running the test suite', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', 'yarn nx test tools'),
      );
    });

    it('should allow a plain echo', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', 'echo "--- section ---"'),
      );
    });

    // A heredoc body is content, not a destination. Writing a commit message
    // that cites a generated path was blocked as if it edited that path.
    it('should allow a heredoc whose body mentions a generated directory', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          [
            "cat > /tmp/commit-msg.txt <<'EOF'",
            'chore(openapi): regenerate specs',
            '',
            `- Added ${GENERATED_SWAGGER} to .prettierignore`,
            'EOF',
          ].join('\n'),
        ),
      );
    });

    it('should allow a heredoc body that names an environment file', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          [
            "cat > docs/setup.md <<'EOF'",
            `Copy ${ENV_EXAMPLE} to ${ENV_FILE} and fill in the values.`,
            'EOF',
          ].join('\n'),
        ),
      );
    });

    it('should allow an indented heredoc terminator', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          [
            'cat > /tmp/notes.txt <<-EOF',
            `  see ${GENERATED_SPEC}`,
            '  EOF',
            'echo done',
          ].join('\n'),
        ),
      );
    });

    // The body is skipped, but the command continues after the terminator —
    // a write after the heredoc must still be inspected.
    it('should deny a protected write that follows a heredoc body', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          [
            "cat > /tmp/notes.txt <<'EOF'",
            'harmless prose',
            'EOF',
            `echo x > ${GENERATED_SWAGGER}`,
          ].join('\n'),
        ),
        /swagger|generated/i,
      );
    });

    // A bare `/>/` write test read `2>/dev/null` as a redirect, so discarding
    // stderr while *reading* a protected path was denied outright.
    it('should allow reading a protected path while discarding stderr', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `sed -n '1,20p' ${GENERATED_SPEC} 2>/dev/null`),
      );
    });

    it('should allow reading a protected path while discarding stderr in PowerShell', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('PowerShell', `Get-Content ${GENERATED_CLIENT} 2>$null`),
      );
    });

    it('should allow a comparison operator near a protected path', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          `node -e "if (a >= b) require('./${GENERATED_SPEC}')"`,
        ),
      );
    });

    it('should still deny a real redirect into a protected path', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `echo broken > ${GENERATED_SPEC}`),
        /openapi spec/i,
      );
    });

    it('should still deny an append redirect into a protected path', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `cat fragment >> ${GENERATED_CLIENT}`),
        /generated api client/i,
      );
    });
  });

  describe('fail-open behavior', () => {
    it('should allow the call when stdin carries no payload', () => {
      const outcome = runHook(PRE_TOOL_USE_HOOK, '');

      assert.equal(outcome.status, 0);
      assert.equal(outcome.decision, 'allow');
    });
  });

  // Sandcastle sets MYORGANISER_SANDBOX=1 in its image. The workflow guards
  // exist to stop hand-edits during chat and local development; inside a
  // disposable container they only block legitimate work. In run #408 they
  // rejected every `git restore` the agent tried after a botched regeneration,
  // so it committed a deletion it could not undo. Secret guards do not lift:
  // the container holds live credentials and the transcript leaves the host.
  describe('sandbox mode', () => {
    const sandbox = { sandbox: true };

    it('should allow editing the generated API client', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Edit', tool_input: { file_path: GENERATED_CLIENT } },
        sandbox,
      );
    });

    it('should allow editing the synced OpenAPI spec', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Edit', tool_input: { file_path: GENERATED_SPEC } },
        sandbox,
      );
    });

    it('should allow restoring a generated path, the recovery #408 could not run', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `git restore ${GENERATED_CLIENT}`),
        sandbox,
      );
    });

    it('should still deny writing an environment file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Edit', tool_input: { file_path: ENV_FILE } },
        /environment/i,
        sandbox,
      );
    });

    it('should still deny reading an environment file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Read', tool_input: { file_path: ENV_FILE } },
        /environment/i,
        sandbox,
      );
    });

    it('should still deny reading private key material', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Read', tool_input: { file_path: PRIVATE_SSH_KEY } },
        /key/i,
        sandbox,
      );
    });

    it('should keep the workflow guards active outside the sandbox', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        { tool_name: 'Edit', tool_input: { file_path: GENERATED_CLIENT } },
        /generated api client/i,
      );
    });
  });
});
