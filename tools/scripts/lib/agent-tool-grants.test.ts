/**
 * Run with: yarn agents:sync:test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  type AgentOverride,
  type AgentToolMap,
  describeGrant,
  describeGrantChange,
  formatGrant,
  type Grant,
  grantsEqual,
  type HarnessConfig,
  INHERIT_ALL,
  parseCanonicalRoles,
  readGrant,
  renderGrant,
  validateToolMap,
  writeGrant,
} from './agent-tool-grants.ts';

const REAL_MAP: AgentToolMap = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'tools', 'config', 'agent-tool-map.json'),
    'utf8',
  ),
);

interface TestToolsHarness {
  grant: 'tools';
  tools: Record<string, string[]>;
}

interface TestReadonlyHarness {
  grant: 'readonly';
  writableRoles: string[];
}

interface TestMap {
  roles: Record<string, string>;
  harnesses: {
    claude: TestToolsHarness;
    gemini: TestToolsHarness;
    cursor: TestReadonlyHarness;
  };
  overrides: Record<string, Record<string, AgentOverride>>;
}

function map(
  overrides: Record<string, Record<string, AgentOverride>> = {},
): TestMap {
  return {
    roles: { read: '', search: '', edit: '', execute: '', 'graphify/*': '' },
    harnesses: {
      claude: {
        grant: 'tools',
        tools: {
          read: ['Read'],
          search: ['Glob', 'Grep'],
          edit: ['Edit', 'Write'],
          execute: ['Bash'],
          'graphify/*': ['mcp__graphify__query_graph'],
        },
      },
      gemini: {
        grant: 'tools',
        tools: {
          read: ['read_file'],
          search: ['glob', 'grep_search'],
          edit: ['replace', 'write_file'],
          execute: ['run_shell_command'],
          'graphify/*': ['mcp_graphify_*'],
        },
      },
      cursor: { grant: 'readonly', writableRoles: ['edit', 'execute'] },
    },
    overrides,
  };
}

// --- parseCanonicalRoles ------------------------------------------------------

test('parses an inline role list, including quoted entries', () => {
  const fm = "---\nname: X\ntools: [read, search, 'graphify/*']\n---\n";
  assert.deepEqual(parseCanonicalRoles(fm, 'explore'), [
    'read',
    'search',
    'graphify/*',
  ]);
});

test('parses double-quoted entries and stray whitespace', () => {
  const fm = '---\ntools: [ "read" ,execute ]\n---\n';
  assert.deepEqual(parseCanonicalRoles(fm, 'x'), ['read', 'execute']);
});

test('a canonical agent without a tools: line is a hard error naming it', () => {
  assert.throws(
    () => parseCanonicalRoles('---\nname: X\n---\n', 'audit'),
    /audit.*tools:/,
  );
});

// --- validateToolMap ----------------------------------------------------------

test('the real map is valid', () => {
  assert.doesNotThrow(() => validateToolMap(REAL_MAP));
});

test('a tools harness missing a vocabulary role is a hard error', () => {
  const m = map();
  delete m.harnesses.gemini.tools.execute;
  assert.throws(() => validateToolMap(m), /gemini.*execute/);
});

test('a tools harness mapping a role outside the vocabulary is a hard error', () => {
  const m = map();
  m.harnesses.claude.tools.teleport = ['Teleport'];
  assert.throws(() => validateToolMap(m), /claude.*teleport/);
});

test('a harness whose grant key disagrees with its frontmatter format is a hard error', () => {
  const m = map();
  // Deliberately mismatched: cursor's frontmatter format is `readonly`, so
  // giving it a `tools` grant here is the invalid state under test.
  (m.harnesses as Record<string, HarnessConfig>).cursor = {
    grant: 'tools',
    tools: m.harnesses.claude.tools,
  };
  assert.throws(() => validateToolMap(m), /cursor.*readonly/);
});

test('an override without a reason is a hard error', () => {
  const m = map({ audit: { claude: { tools: ['Read'] } } });
  assert.throws(() => validateToolMap(m), /audit.*claude.*reason/);
});

test('an override with a blank reason is a hard error', () => {
  const m = map({ audit: { claude: { tools: ['Read'], reason: '  ' } } });
  assert.throws(() => validateToolMap(m), /audit.*claude.*reason/);
});

test('an override for an unknown harness is a hard error', () => {
  const m = map({ audit: { copilot: { tools: ['x'], reason: 'why' } } });
  assert.throws(() => validateToolMap(m), /audit.*copilot/);
});

test('an override must carry the grant shape its harness uses', () => {
  const m = map({ audit: { cursor: { tools: ['x'], reason: 'why' } } });
  assert.throws(() => validateToolMap(m), /audit.*cursor.*readonly/);
});

// --- renderGrant --------------------------------------------------------------

test('renders roles to Claude tools in vocabulary order, not declaration order', () => {
  assert.deepEqual(
    renderGrant(['execute', 'read', 'edit', 'search'], 'claude', 'p', map()),
    { tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'] },
  );
});

test('renders roles to Gemini tool names', () => {
  assert.deepEqual(renderGrant(['read', 'graphify/*'], 'gemini', 'e', map()), {
    tools: ['read_file', 'mcp_graphify_*'],
  });
});

test('an unknown role is a hard error naming agent and role', () => {
  assert.throws(
    () => renderGrant(['read', 'teleport'], 'claude', 'audit', map()),
    /audit.*teleport/,
  );
});

test('Cursor is readonly when no writable role is declared', () => {
  assert.deepEqual(renderGrant(['read', 'search'], 'cursor', 'd', map()), {
    readonly: true,
  });
});

test('Cursor is not readonly when edit or execute is declared', () => {
  const m = map();
  assert.deepEqual(renderGrant(['read', 'execute'], 'cursor', 'c', m), {
    readonly: false,
  });
  assert.deepEqual(renderGrant(['edit'], 'cursor', 'c', m), {
    readonly: false,
  });
});

test('an override replaces the rendered grant for that agent and harness only', () => {
  const m = map({
    audit: { claude: { tools: ['Read', 'Bash'], reason: 'needs shell' } },
  });
  assert.deepEqual(renderGrant(['read'], 'claude', 'audit', m), {
    tools: ['Read', 'Bash'],
  });
  assert.deepEqual(renderGrant(['read'], 'gemini', 'audit', m), {
    tools: ['read_file'],
  });
  assert.deepEqual(renderGrant(['read'], 'claude', 'other', m), {
    tools: ['Read'],
  });
});

// The issue's validation table: hand-tuned files the map must reproduce unprompted.
const CLAUDE_GRANT_CASES: Array<[string[], string]> = [
  [['read', 'search', 'execute'], 'Read, Glob, Grep, Bash'],
  [['read', 'search', 'edit'], 'Read, Glob, Grep, Edit, Write'],
  [['read', 'search'], 'Read, Glob, Grep'],
  [
    ['read', 'search', 'graphify/*'],
    'Read, Glob, Grep, mcp__graphify__query_graph, mcp__graphify__get_neighbors, mcp__graphify__get_node, mcp__graphify__god_nodes, mcp__graphify__graph_stats',
  ],
  [
    ['read', 'edit', 'search', 'execute'],
    'Read, Glob, Grep, Edit, Write, Bash',
  ],
];

for (const [roles, tools] of CLAUDE_GRANT_CASES) {
  test(`the real map reproduces the hand-tuned Claude grant for [${roles}]`, () => {
    assert.deepEqual(renderGrant(roles, 'claude', 'x', REAL_MAP), {
      tools: tools.split(', '),
    });
  });
}

// --- readGrant / writeGrant ---------------------------------------------------

const CLAUDE_FM =
  '---\nname: Audit\ndescription: >\n  Reads things.\ntools: [Read, Glob, Grep, Edit, Write, Bash]\nmodel: haiku\n---\n';
const GEMINI_FM =
  '---\nname: audit\ndescription: >\n  Reads things.\nmodel: gemini-3.6-flash\ntools:\n  - read_file\n  - list_files\n---\n';
const CURSOR_FM =
  '---\nname: Audit\ndescription: Reads things.\nmodel: composer-2.5\n---\n';

test('reads an inline Claude tools list', () => {
  assert.deepEqual(readGrant(CLAUDE_FM, 'claude'), {
    tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
  });
});

test('reads a YAML block Gemini tools list', () => {
  assert.deepEqual(readGrant(GEMINI_FM, 'gemini'), {
    tools: ['read_file', 'list_files'],
  });
});

test('a missing tools key reads as null, not as an empty grant', () => {
  assert.equal(readGrant(CURSOR_FM, 'claude'), null);
});

test('Cursor reads absent readonly as false', () => {
  assert.deepEqual(readGrant(CURSOR_FM, 'cursor'), { readonly: false });
  assert.deepEqual(
    readGrant(CURSOR_FM.replace('---\n', '---\nreadonly: true\n'), 'cursor'),
    { readonly: true },
  );
});

test('rewrites only the Claude tools line', () => {
  const next = writeGrant(CLAUDE_FM, 'claude', { tools: ['Read', 'Bash'] });
  assert.equal(
    next,
    '---\nname: Audit\ndescription: >\n  Reads things.\ntools: [Read, Bash]\nmodel: haiku\n---\n',
  );
});

test('inserts a Claude tools line before model when absent', () => {
  const fm = '---\nname: A\ndescription: >\n  D.\nmodel: haiku\n---\n';
  assert.equal(
    writeGrant(fm, 'claude', { tools: ['Read'] }),
    '---\nname: A\ndescription: >\n  D.\ntools: [Read]\nmodel: haiku\n---\n',
  );
});

test('rewrites only the Gemini tools block, leaving keys after it intact', () => {
  const fm = GEMINI_FM.replace(
    '  - list_files\n',
    '  - list_files\ntemperature: 0.2\n',
  );
  assert.equal(
    writeGrant(fm, 'gemini', { tools: ['read_file', 'glob'] }),
    fm.replace('  - read_file\n  - list_files\n', '  - read_file\n  - glob\n'),
  );
});

test('appends a Gemini tools block when absent', () => {
  const fm = '---\nname: a\nmodel: m\n---\n';
  assert.equal(
    writeGrant(fm, 'gemini', { tools: ['read_file'] }),
    '---\nname: a\nmodel: m\ntools:\n  - read_file\n---\n',
  );
});

test('Cursor readonly true is written after model; false removes the key', () => {
  const on = writeGrant(CURSOR_FM, 'cursor', { readonly: true });
  assert.equal(
    on,
    '---\nname: Audit\ndescription: Reads things.\nmodel: composer-2.5\nreadonly: true\n---\n',
  );
  assert.equal(writeGrant(on, 'cursor', { readonly: false }), CURSOR_FM);
  assert.equal(writeGrant(on, 'cursor', { readonly: true }), on);
});

const GRANT_ROUNDTRIP_CASES: Array<[string, string, Grant]> = [
  [CLAUDE_FM, 'claude', { tools: ['Read', 'WebFetch'] }],
  [GEMINI_FM, 'gemini', { tools: ['glob', 'mcp_graphify_*'] }],
  [CURSOR_FM, 'cursor', { readonly: true }],
];

test('a written grant reads back equal', () => {
  for (const [fm, harness, grant] of GRANT_ROUNDTRIP_CASES) {
    assert.ok(
      grantsEqual(readGrant(writeGrant(fm, harness, grant), harness), grant),
    );
  }
});

// --- grantsEqual / describeGrantChange ----------------------------------------

test('grant equality is order-sensitive and null-safe', () => {
  assert.ok(grantsEqual({ tools: ['A', 'B'] }, { tools: ['A', 'B'] }));
  assert.ok(!grantsEqual({ tools: ['B', 'A'] }, { tools: ['A', 'B'] }));
  assert.ok(!grantsEqual(null, { tools: [] }));
  assert.ok(grantsEqual({ readonly: false }, { readonly: false }));
});

test('labels added tools as widening and removed tools as narrowing', () => {
  assert.deepEqual(
    describeGrantChange(
      { tools: ['Read', 'Edit', 'Bash'] },
      { tools: ['Read', 'WebFetch'] },
    ),
    { widened: ['WebFetch'], narrowed: ['Edit', 'Bash'], reordered: false },
  );
});

test('a pure reorder is neither widening nor narrowing', () => {
  assert.deepEqual(
    describeGrantChange({ tools: ['B', 'A'] }, { tools: ['A', 'B'] }),
    { widened: [], narrowed: [], reordered: true },
  );
});

test('Cursor gaining readonly narrows; losing it widens', () => {
  assert.deepEqual(
    describeGrantChange({ readonly: false }, { readonly: true }),
    { widened: [], narrowed: ['readonly'], reordered: false },
  );
  assert.deepEqual(
    describeGrantChange({ readonly: true }, { readonly: false }),
    { widened: ['readonly'], narrowed: [], reordered: false },
  );
});

// Claude Code and Gemini CLI both give an agent with no tools key every tool.
test('replacing a missing tools key narrows from inherit-all', () => {
  assert.deepEqual(describeGrantChange(null, { tools: ['Read'] }), {
    widened: [],
    narrowed: [INHERIT_ALL],
    reordered: false,
  });
});

test('formatGrant renders each harness shape, and false readonly as nothing', () => {
  assert.equal(
    formatGrant('claude', { tools: ['Read', 'Bash'] }),
    'tools: [Read, Bash]\n',
  );
  assert.equal(
    formatGrant('gemini', { tools: ['glob'] }),
    'tools:\n  - glob\n',
  );
  assert.equal(formatGrant('cursor', { readonly: true }), 'readonly: true\n');
  assert.equal(formatGrant('cursor', { readonly: false }), '');
});

test('describeGrant renders every grant shape, including a missing one', () => {
  assert.equal(describeGrant({ tools: ['Read', 'Bash'] }), '[Read, Bash]');
  assert.equal(describeGrant({ readonly: true }), 'readonly: true');
  assert.equal(describeGrant(null), INHERIT_ALL);
});
