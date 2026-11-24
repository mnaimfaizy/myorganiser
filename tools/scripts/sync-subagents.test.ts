import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import {
  CODEX_ROLE_DIRECTORY,
  codexAdapter,
  readCodexGrant,
} from './lib/codex-agent-adapter.ts';

test('generated TOML round-trips literal instructions and exact grants', () => {
  const body = [
    'Keep """ and \\n verbatim.',
    'Windows path C:\\Temp\\',
    'Quotes "and" markers',
  ].join('\n');
  const role = codexAdapter(
    'CodeExplorer',
    'Read and search',
    'fixture-model',
    body,
    { tools: ['read_source'] },
  );
  const parsed = parse(role);
  assert.equal(typeof parsed.developer_instructions, 'string');
  assert.ok(String(parsed.developer_instructions).endsWith(body));
  assert.equal(parsed.name, 'CodeExplorer');
  assert.equal(parsed.model, 'fixture-model');
  assert.deepEqual(parsed.features, {
    shell_tool: false,
    apps: false,
    plugins: false,
    memories: false,
    request_permissions_tool: false,
  });
  assert.deepEqual(readCodexGrant(role).tools, ['read_source']);
});

test('sync creates and checks every role, repairs drift and preserves legacy adapter bytes', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'codex-role-sync-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const dirs = [
    '.github/agents',
    '.claude/agents',
    '.cursor/agents',
    '.gemini/agents',
  ];
  for (const path of [
    ...dirs,
    'tools/config/agent-tool-map.json',
    'tools/config/agent-model-policy.json',
  ])
    cpSync(join(root, path), join(cwd, path), { recursive: true });
  function legacy() {
    return dirs.flatMap((dir) =>
      readdirSync(join(cwd, dir)).map((name) =>
        readFileSync(join(cwd, dir, name), 'utf8'),
      ),
    );
  }
  function run(script: string, flag: string, expected: number) {
    const r = spawnSync(
      process.execPath,
      [join(root, 'tools/scripts', script), flag],
      { cwd, encoding: 'utf8' },
    );
    assert.equal(r.status, expected, r.stderr + r.stdout);
    return r.stdout;
  }
  const before = legacy();
  const dir = join(cwd, CODEX_ROLE_DIRECTORY);
  const file = join(dir, 'explore.toml');
  run('sync-subagents.ts', '--check', 1);
  assert.equal(existsSync(dir), false);
  run('sync-subagents.ts', '--apply', 0);
  const original = readFileSync(file, 'utf8');
  assert.equal(
    readdirSync(dir).length,
    readdirSync(join(cwd, '.github/agents')).filter((n) =>
      n.endsWith('.agent.md'),
    ).length,
  );
  run('sync-agent-models.ts', '--check', 0);
  run('sync-subagents.ts', '--check', 0);
  writeFileSync(
    file,
    original.replace('model = "gpt-6-luna"', 'model = "wrong"'),
  );
  run('sync-agent-models.ts', '--check', 1);
  run('sync-agent-models.ts', '--apply', 0);
  assert.equal(readFileSync(file, 'utf8'), original);
  writeFileSync(
    file,
    original
      .replace('["read_source",', '["exec_command","read_source",')
      .replace('shell_tool = false', 'shell_tool = true'),
  );
  assert.match(run('sync-subagents.ts', '--check', 1), /exec_command/);
  writeFileSync(join(dir, 'stale.toml'), original);
  run('sync-subagents.ts', '--apply', 0);
  assert.equal(existsSync(join(dir, 'stale.toml')), false);
  assert.equal(readFileSync(file, 'utf8'), original);
  writeFileSync(file, 'invalid TOML [[');
  run('sync-subagents.ts', '--apply', 1);
  assert.equal(readFileSync(file, 'utf8'), 'invalid TOML [[');
  assert.deepEqual(legacy(), before);
});
