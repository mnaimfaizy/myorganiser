/**
 * Temp workspace with `tools/scripts/*.ts` stubs that exit 0.
 * Shared by `gate-manifest.test.ts` and `run-assertion-gates.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';

export function createGateManifestWorkspace(
  t: TestContext,
  {
    prefix = 'gate-manifest-',
    scripts = ['tools/scripts/check-a.ts', 'tools/scripts/check-b.ts'],
  }: { prefix?: string; scripts?: string[] } = {},
): string {
  const workspace = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  for (const script of scripts) {
    mkdirSync(join(workspace, dirname(script)), { recursive: true });
    writeFileSync(join(workspace, script), 'process.exit(0);\n');
  }
  return workspace;
}
