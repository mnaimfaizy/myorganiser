import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import {
  PRE_TOOL_USE_HOOK,
  CODEX_HOOK_ARGS,
  codexPayload,
  expectCodexDenial,
  runHookRaw,
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
  describe('Codex tools', () => {
    it('blocks a PowerShell write to generated code', () => {
      expectCodexDenial(
        PRE_TOOL_USE_HOOK,
        codexPayload(
          'Bash',
          'Set-Content libs\\app-api-client\\src\\index.ts example',
        ),
        /generated api client/i,
      );
    });

    it('blocks a patch targeting a generated path relative to a nested workdir', () => {
      const patch = [
        '*** Begin Patch',
        '*** Add File: src/synthetic.ts',
        '+example',
        '*** End Patch',
      ].join('\r\n');
      expectCodexDenial(
        PRE_TOOL_USE_HOOK,
        codexPayload(
          'apply_patch',
          patch,
          join(process.cwd(), 'libs', 'app-api-client'),
        ),
        /generated api client/i,
      );
    });

    it('blocks moving a file into a protected directory', () => {
      const patch = [
        '*** Begin Patch',
        '*** Update File: src/example.ts',
        '*** Move to: libs/app-api-client/src/example.ts',
        '*** End Patch',
      ].join('\n');
      expectCodexDenial(
        PRE_TOOL_USE_HOOK,
        codexPayload('apply_patch', patch),
        /generated api client/i,
      );
    });

    it('defers on a patch that mentions generated code in its content', () => {
      const patch = [
        '*** Begin Patch',
        '*** Add File: notes.md',
        '+*** Update File: libs/app-api-client/src/index.ts',
        '*** End Patch',
      ].join('\n');
      const result = runHookRaw(
        PRE_TOOL_USE_HOOK,
        codexPayload('apply_patch', patch),
        {
          args: CODEX_HOOK_ARGS,
        },
      );
      assert.deepEqual(result, { status: 0, stdout: '', stderr: '' });
    });
  });

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

  describe('env accessor in code is not an environment file (#1640)', () => {
    const ACCESSOR_COMMANDS = [
      'node -e "console.log(process.env.HOME)"',
      `node -e "console.log(process.env['HOME'])"`,
      'node -e "console.log(Object.keys(process.env))"',
      'node -e "console.log(import.meta.env.MODE)"',
      'node -e "console.log(Deno.env.get(\'X\'))"',
      'node -e "console.log(PROCESS.ENV.HOME)"',
      'cat tools/scripts/lib/sandcastle-provider-env.ts',
    ];
    const ACCESSOR_WRITES = [
      `sed -i 's/a/process.env.X/' tools/scripts/lib/sandcastle-provider-env.ts`,
      `echo "const x = process.env.X;" > tools/scripts/lib/sandcastle-provider-env.ts`,
      `echo "import.meta.env.MODE" >> src/app/page.tsx`,
    ];

    it('should allow shell reads whose text mentions the env accessor', () => {
      for (const command of ACCESSOR_COMMANDS) {
        expectAllowed(PRE_TOOL_USE_HOOK, shellPayload('Bash', command));
      }
    });

    it('should allow shell writes whose text mentions the env accessor', () => {
      for (const command of ACCESSOR_WRITES) {
        expectAllowed(PRE_TOOL_USE_HOOK, shellPayload('Bash', command));
        expectAllowed(PRE_TOOL_USE_HOOK, shellPayload('PowerShell', command));
      }
    });

    it('should allow structured paths to an env-named source file', () => {
      for (const tool_name of ['Read', 'Edit', 'Write']) {
        expectAllowed(PRE_TOOL_USE_HOOK, {
          tool_name,
          tool_input: {
            file_path: 'tools/scripts/lib/sandcastle-provider-env.ts',
            content: 'const x = process.env.X;',
          },
        });
      }
    });

    it('should still deny a read of the accessor next to a real env file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `node -e "process.env.X" && cat ${ENV_FILE}`),
        /environment/i,
      );
    });

    it('should still deny the env example next to a real env file', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `cat ${ENV_EXAMPLE} ${ENV_FILE}`),
        /environment/i,
      );
    });
  });

  describe('a path argument named like an env accessor is an environment file', () => {
    const ACCESSOR_FILES = [
      'process.env',
      'import.meta.env',
      'Deno.env',
      'Bun.env',
    ].flatMap((name) => [name, `config/${name}`, `config\\${name}`]);

    const patchFor = (target: string) =>
      [
        '*** Begin Patch',
        `*** Add File: ${target}`,
        '+example',
        '*** End Patch',
      ].join('\n');

    it('should deny a read tool given an accessor-named file path', () => {
      for (const path of ACCESSOR_FILES) {
        for (const tool_input of [{ file_path: path }, path]) {
          expectDenied(
            PRE_TOOL_USE_HOOK,
            { tool_name: 'Read', tool_input },
            /environment/i,
          );
        }
      }
    });

    it('should deny a search whose path or glob is an accessor-named file', () => {
      for (const path of ACCESSOR_FILES) {
        for (const tool_input of [{ path }, { glob: path }]) {
          expectDenied(
            PRE_TOOL_USE_HOOK,
            { tool_name: 'Grep', tool_input },
            /environment/i,
          );
        }
      }
    });

    it('should deny a write tool given an accessor-named file path', () => {
      for (const path of ACCESSOR_FILES) {
        for (const tool_input of [{ file_path: path, content: 'x' }, path]) {
          expectDenied(
            PRE_TOOL_USE_HOOK,
            { tool_name: 'Write', tool_input },
            /environment/i,
          );
        }
      }
    });

    it('should deny a Codex patch that targets an accessor-named file', () => {
      for (const path of ACCESSOR_FILES) {
        expectCodexDenial(
          PRE_TOOL_USE_HOOK,
          codexPayload('apply_patch', patchFor(path)),
          /environment/i,
        );
      }
    });

    it('should deny a structured patch input that targets an accessor-named file', () => {
      for (const path of ACCESSOR_FILES) {
        for (const tool_input of [{ path }, { command: patchFor(path) }]) {
          expectDenied(
            PRE_TOOL_USE_HOOK,
            { tool_name: 'apply_patch', tool_input },
            /environment/i,
          );
        }
      }
    });

    it('should allow a shell tool given the accessor in a plain command string', () => {
      for (const tool_name of ['Bash', 'Execute', 'Run']) {
        expectAllowed(PRE_TOOL_USE_HOOK, {
          tool_name,
          tool_input: 'node -e "console.log(process.env.PATH)"',
        });
      }
    });

    it('should allow a patch whose content mentions the env accessor', () => {
      expectAllowed(PRE_TOOL_USE_HOOK, {
        tool_name: 'apply_patch',
        tool_input: {
          command: [
            '*** Begin Patch',
            '*** Add File: src/synthetic.ts',
            '+const x = process.env.X;',
            '*** End Patch',
          ].join('\n'),
        },
      });
    });
  });

  describe('real environment file reads stay denied (#1640)', () => {
    const ENV_PATHS = [
      '.env',
      '.env.local',
      'apps/backend/.env',
      'apps\\backend\\.env',
      'foo.env',
      // Only process, import.meta, Deno and Bun are exempt accessor roots, so
      // names that merely contain ".env." stay refused.
      'prod.env.bak',
      'backend.env.local',
      'foo.env.bak',
      'config/process.env',
      // Accepted false positive: a non-listed accessor looks like a file name.
      'ctx.env.X',
    ];

    it('should deny structured reads of each env path', () => {
      for (const file_path of ENV_PATHS) {
        expectDenied(
          PRE_TOOL_USE_HOOK,
          { tool_name: 'Read', tool_input: { file_path } },
          /environment/i,
        );
      }
    });

    it('should deny shell reads of each env path', () => {
      for (const file_path of ENV_PATHS) {
        for (const command of [
          `cat ${file_path}`,
          `type ${file_path}`,
          `Get-Content ${file_path}`,
          `Get-Content -Path "${file_path}"`,
        ]) {
          expectDenied(
            PRE_TOOL_USE_HOOK,
            shellPayload('Bash', command),
            /environment/i,
          );
        }
      }
    });
  });

  describe('real environment file writes stay denied (#1640)', () => {
    const ENV_PATHS = [
      '.env',
      '.env.local',
      'apps/backend/.env',
      'foo.env',
      'prod.env.bak',
      'backend.env.local',
      'foo.env.bak',
      'config/process.env',
      // Accepted false positive: a non-listed accessor looks like a file name.
      'ctx.env.X',
    ];

    it('should deny structured writes of each env path', () => {
      for (const file_path of ENV_PATHS) {
        for (const tool_name of ['Write', 'Edit']) {
          expectDenied(
            PRE_TOOL_USE_HOOK,
            { tool_name, tool_input: { file_path, content: 'x' } },
            /environment/i,
          );
        }
      }
    });

    it('should deny shell writes of each env path', () => {
      for (const file_path of ENV_PATHS) {
        for (const command of [
          `echo x > ${file_path}`,
          `cp x ${file_path}`,
          `sed -i s/a/b/ ${file_path}`,
        ]) {
          expectDenied(
            PRE_TOOL_USE_HOOK,
            shellPayload('Bash', command),
            /environment/i,
          );
        }
      }
    });

    it('should allow writing the env example file', () => {
      expectAllowed(PRE_TOOL_USE_HOOK, {
        tool_name: 'Write',
        tool_input: { file_path: ENV_EXAMPLE, content: 'X=' },
      });
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `echo X= > ${ENV_EXAMPLE}`),
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

  describe('Sign-off Issue guard (ADR 0151)', () => {
    // A Sign-off Issue's body starts with this marker (signoff-issue.ts); a
    // check id is `<pr>:<12 hex>` (signoff-gate.ts).
    const SIGNED_OFF_BODY =
      '<!-- signoff-issue -->\\n- [x] sign in on staging `1590:3f9a0c1d2e4b`';
    const WAIVER = 'waive: 1590:3f9a0c1d2e4b — checked by hand';

    /** Runs `check` with a temporary body file holding `content`. */
    function withBodyFile(content: string, check: (path: string) => void) {
      const dir = mkdtempSync(join(tmpdir(), 'signoff-guard-'));
      const bodyFile = join(dir, 'body.md');
      writeFileSync(bodyFile, content);
      try {
        check(bodyFile);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it('blocks a Sign-off Issue body file relative to the Codex tool cwd', () => {
      withBodyFile(SIGNED_OFF_BODY, (bodyFile) => {
        expectCodexDenial(
          PRE_TOOL_USE_HOOK,
          codexPayload(
            'Bash',
            'gh issue edit 1600 --body-file body.md',
            dirname(bodyFile),
          ),
          /sign-off issue/i,
        );
      });
    });

    it('blocks a Codex waiver passed through a quoted body-file path', () => {
      withBodyFile('', (bodyFile) => {
        const waiverFile = join(dirname(bodyFile), 'waiver body.md');
        writeFileSync(waiverFile, WAIVER);
        expectCodexDenial(
          PRE_TOOL_USE_HOOK,
          codexPayload(
            'Bash',
            "gh issue comment 1600 --body-file 'waiver body.md'",
            dirname(bodyFile),
          ),
          /waive/i,
        );
      });
    });

    it('defers on an ordinary Codex issue write with a body file', () => {
      withBodyFile('Ordinary update', (bodyFile) => {
        const event = codexPayload(
          'Bash',
          'gh issue edit 1599 --body-file body.md',
          dirname(bodyFile),
        );
        const result = runHookRaw(PRE_TOOL_USE_HOOK, event, {
          args: CODEX_HOOK_ARGS,
        });
        assert.deepEqual(result, { status: 0, stdout: '', stderr: '' });
      });
    });

    it('should deny an agent editing a Sign-off Issue body to tick a check', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `gh issue edit 1600 --body "${SIGNED_OFF_BODY}"`),
        /sign-off issue/i,
      );
    });

    it('should deny an agent posting a waiver comment', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', `gh issue comment 1600 --body "${WAIVER}"`),
        /waive/i,
      );
    });

    for (const command of [
      `gh -R o/r issue comment 1600 --body "${WAIVER}"`,
      `gh --repo=o/r issue comment 1600 --body "${WAIVER}"`,
      `GH_REPO=o/r gh issue comment 1600 --body "${WAIVER}"`,
      `env GH_REPO=o/r gh issue comment 1600 --body "${WAIVER}"`,
      `/opt/homebrew/bin/gh issue comment 1600 --body "${WAIVER}"`,
      `{ gh issue comment 1600 --body "${WAIVER}"; }`,
      `! gh issue comment 1600 --body "${WAIVER}"`,
      `if true; then gh issue comment 1600 --body "${WAIVER}"; fi`,
    ]) {
      it(`should deny a waiver comment written as \`${command.slice(0, 32)}…\``, () => {
        expectDenied(
          PRE_TOOL_USE_HOOK,
          shellPayload('Bash', command),
          /waive/i,
        );
      });
    }

    it('should allow an issue body that quotes the waiver form', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          `gh issue create --title "Waivers" --body "The form:\\n${WAIVER}"`,
        ),
      );
    });

    it('should allow an agent editing an unrelated issue body', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          'gh issue edit 1599 --body "- [x] Fix the login copy"',
        ),
      );
    });

    it('should allow an agent reading a Sign-off Issue', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          'gh issue view 1600 --json body -q .body | grep "<!-- signoff-issue -->"',
        ),
      );
    });

    it('should deny a Sign-off Issue body passed in a body file', () => {
      withBodyFile(SIGNED_OFF_BODY.replaceAll('\\n', '\n'), (bodyFile) => {
        expectDenied(
          PRE_TOOL_USE_HOOK,
          shellPayload('Bash', `gh issue edit 1600 --body-file ${bodyFile}`),
          /sign-off issue/i,
        );
      });
    });

    it('should deny a waiver sent through gh api from a file', () => {
      withBodyFile(`${WAIVER}\n`, (bodyFile) => {
        expectDenied(
          PRE_TOOL_USE_HOOK,
          shellPayload(
            'Bash',
            `gh api repos/o/r/issues/1600/comments -F body=@${bodyFile}`,
          ),
          /waive/i,
        );
      });
    });

    it('should deny a waiver piped to gh through a heredoc', () => {
      expectDenied(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          `cd repo && gh issue comment 1600 --body-file - <<'EOF'\n${WAIVER}\nEOF`,
        ),
        /waive/i,
      );
    });

    it('should allow a comment that mentions waiving mid-sentence', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          'gh issue comment 1599 --body "The Maintainer can waive: see ADR 0151."',
        ),
      );
    });

    it('should allow a command that only quotes a gh call, such as a test fixture', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          `python3 - <<'PY'\nfixture = 'gh issue comment 1600 --body "${WAIVER}"'\nPY`,
        ),
      );
    });

    // A tick built at run time never shows the marker in the command, so an
    // issue body read and written back in one command is refused whole.
    const TICK = String.raw`sed 's/\[ \]/[x]/'`;
    for (const command of [
      `gh issue edit 42 --body "$(gh issue view 42 --json body -q .body | ${TICK})"`,
      `gh issue view 42 --json body -q .body | ${TICK} | gh issue edit 42 --body-file -`,
      `gh api -X PATCH repos/o/r/issues/42 -f body="$(gh api repos/o/r/issues/42 -q .body | ${TICK})"`,
    ]) {
      it(`should deny rewriting an issue body from its own text: \`${command.slice(0, 40)}…\``, () => {
        expectDenied(
          PRE_TOOL_USE_HOOK,
          shellPayload('Bash', command),
          /rewrit/i,
        );
      });
    }

    it('should allow an issue body built from a local file at run time', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload('Bash', 'gh issue edit 1599 --body "$(cat notes.md)"'),
      );
    });

    it('should allow an issue body write to an issue path from a local file', () => {
      expectAllowed(
        PRE_TOOL_USE_HOOK,
        shellPayload(
          'Bash',
          'gh api -X PATCH repos/o/r/issues/1599 -f body="$(cat notes.md)"',
        ),
      );
    });

    for (const script of [
      'node tools/scripts/ci/merge-train.ts',
      'corepack yarn release:cut',
      'corepack yarn release:signoff-close',
    ]) {
      it(`should allow the script path \`${script}\``, () => {
        expectAllowed(PRE_TOOL_USE_HOOK, shellPayload('Bash', script));
      });
    }
  });
});
