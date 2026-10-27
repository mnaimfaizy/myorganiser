import { describe, it } from 'node:test';
import {
  POST_TOOL_USE_HOOK,
  expectContext,
  expectNoContext,
  shellPayload,
} from './hook-harness.ts';

const CONTROLLER = 'apps/backend/src/controllers/AuthController.ts';
const SCHEMA_DIR = 'apps/backend/src/prisma/schema';
const SCHEMA_FILE = `${SCHEMA_DIR}/user.prisma`;
const ORDINARY_FILE = 'libs/web-ui/src/lib/button.tsx';

describe('post-tool-use hook', () => {
  describe('contract reminders on real writes', () => {
    it('should remind about the API contract when a controller is written', () => {
      expectContext(
        POST_TOOL_USE_HOOK,
        { tool_name: 'Write', tool_input: { file_path: CONTROLLER } },
        /openapi:sync/,
      );
    });

    it('should remind about Prisma when a schema file is edited', () => {
      expectContext(
        POST_TOOL_USE_HOOK,
        {
          tool_name: 'Edit',
          tool_input: { file_path: SCHEMA_FILE, new_string: 'x' },
        },
        /generate-types/,
      );
    });

    it('should remind when a shell command redirects into a controller', () => {
      expectContext(
        POST_TOOL_USE_HOOK,
        shellPayload('Bash', `echo x > ${CONTROLLER}`),
        /openapi:sync/,
      );
    });

    it('should remind when a shell command edits a schema in place', () => {
      expectContext(
        POST_TOOL_USE_HOOK,
        shellPayload('Bash', `sed -i 's/a/b/' ${SCHEMA_FILE}`),
        /generate-types/,
      );
    });

    it('should emit both reminders when a call touches both areas', () => {
      const context = shellPayload('Bash', `cp ${CONTROLLER} ${SCHEMA_FILE}`);
      expectContext(POST_TOOL_USE_HOOK, context, /openapi:sync/);
      expectContext(POST_TOOL_USE_HOOK, context, /generate-types/);
    });
  });

  // The hook fired on `ls`, on `cat`, and on writing a document that merely
  // quoted a controller path. Each of those trains the agent to ignore it.
  describe('silence on reads and on content that only mentions a path', () => {
    it('should stay silent when a directory is listed', () => {
      expectNoContext(
        POST_TOOL_USE_HOOK,
        shellPayload('Bash', `ls ${SCHEMA_DIR}`),
      );
    });

    it('should stay silent when a controller is read', () => {
      expectNoContext(
        POST_TOOL_USE_HOOK,
        shellPayload('Bash', `cat ${CONTROLLER}`),
      );
    });

    it('should stay silent when a path is grepped', () => {
      expectNoContext(
        POST_TOOL_USE_HOOK,
        shellPayload('Bash', `grep -n token ${CONTROLLER}`),
      );
    });

    it('should stay silent when stderr is discarded from a read', () => {
      expectNoContext(
        POST_TOOL_USE_HOOK,
        shellPayload('Bash', `wc -l ${CONTROLLER} 2>/dev/null`),
      );
    });

    it('should stay silent when written content merely mentions a controller', () => {
      expectNoContext(POST_TOOL_USE_HOOK, {
        tool_name: 'Write',
        tool_input: {
          file_path: 'docs/authentication/notes.md',
          content: `The handler lives in ${CONTROLLER} and is worth reading.`,
        },
      });
    });

    it('should stay silent when an edit replaces a string naming a schema path', () => {
      expectNoContext(POST_TOOL_USE_HOOK, {
        tool_name: 'Edit',
        tool_input: {
          file_path: ORDINARY_FILE,
          old_string: `see ${SCHEMA_FILE}`,
          new_string: `see ${SCHEMA_DIR}/vault.prisma`,
        },
      });
    });

    it('should stay silent for an ordinary source write', () => {
      expectNoContext(POST_TOOL_USE_HOOK, {
        tool_name: 'Write',
        tool_input: {
          file_path: ORDINARY_FILE,
          content: 'export const a = 1;',
        },
      });
    });

    it('should stay silent for a non-mutating tool', () => {
      expectNoContext(POST_TOOL_USE_HOOK, {
        tool_name: 'Read',
        tool_input: { file_path: CONTROLLER },
      });
    });
  });
});
