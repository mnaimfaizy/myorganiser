import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The first entry in Git's worktree list is the primary checkout. */
export function graphifyIndexPath(checkout: string): string {
  const fields = execFileSync(
    'git',
    ['worktree', 'list', '--porcelain', '-z'],
    {
      cwd: checkout,
      encoding: 'utf8',
    },
  ).split('\0');
  const primary = fields[0]?.match(/^worktree (.+)$/s)?.[1];
  if (!primary) throw new Error('Git did not report a primary worktree');

  // A bare repository has no primary checkout to hold the graph.
  return join(
    fields[1] === 'bare' ? checkout : primary,
    'graphify-out',
    'graph.json',
  );
}

function launch(): void {
  const checkout = fileURLToPath(new URL('../../', import.meta.url));
  // Graphify reports an absent graph at tool-call time and includes its path.
  const server = spawn('graphify-mcp', [graphifyIndexPath(checkout)], {
    stdio: 'inherit',
    windowsHide: true,
  });
  server.on('error', (error) => {
    console.error(
      `Could not start Graphify MCP. Install graphifyy[mcp] and put graphify-mcp on PATH: ${error.message}`,
    );
    process.exitCode = 1;
  });
  server.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

if (import.meta.main) {
  launch();
}
