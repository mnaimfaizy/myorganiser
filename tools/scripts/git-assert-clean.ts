import { execSync } from 'node:child_process';

function run(command: string): string {
  return execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] }).toString(
    'utf8',
  );
}

// The caller names itself, because more than one gate has this shape: regenerate
// a derived artifact, then assert the tree did not move (ADR 0098).
const label = process.argv[2] ?? 'openapi-check';

const porcelain = run('git status --porcelain').trim();

if (porcelain.length > 0) {
  console.error(`[${label}] Working tree is not clean after generation.`);
  console.error(
    `[${label}] Commit the regenerated outputs or fix the pipeline.`,
  );
  console.error('--- git status --porcelain ---');
  console.error(porcelain);
  process.exit(1);
}

console.log(`[${label}] Working tree is clean.`);
