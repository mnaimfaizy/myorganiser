/**
 * Bundles `libs/web/vault/src/qa/mintQaVault.ts` for Node and returns its exports,
 * the way `check-escape-copy-reader.mjs` runs its own harness.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function loadQaVaultMint(workspaceRoot: string): Promise<unknown> {
  const { build } = await import('esbuild');
  const scratchDir = mkdtempSync(join(tmpdir(), 'qa-vault-mint-'));
  const outfile = join(scratchDir, 'mint.cjs');
  try {
    await build({
      entryPoints: [
        join(workspaceRoot, 'libs/web/vault/src/qa/mintQaVault.ts'),
      ],
      bundle: true,
      // CommonJS for the reason `check-escape-copy-reader.mjs` gives: the
      // `web-vault` sources reach axios, whose `require` calls esbuild's ESM
      // output cannot run.
      format: 'cjs',
      platform: 'node',
      target: 'node22',
      tsconfig: join(workspaceRoot, 'tsconfig.base.json'),
      absWorkingDir: workspaceRoot,
      outfile,
      logLevel: 'silent',
    });
    return createRequire(import.meta.url)(outfile);
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}
