import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function guard(root: string, script: string, payload: unknown) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'tools/scripts/copilot-hooks', script)],
    {
      cwd: root,
      input: JSON.stringify(payload),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 8192,
    },
  );
  let decision;
  try {
    decision = JSON.parse(result.stdout).permissionDecision;
  } catch {
    throw new Error('Context guard did not return a valid decision');
  }
  if (result.status !== 0 || decision !== 'allow')
    throw new Error('Context rejected by repository secret or read guard');
}

export function screenContext(
  root: string,
  context: unknown,
  paths: string[] = [],
) {
  for (const path of paths) {
    guard(root, 'pre-tool-use.ts', { toolName: 'read', toolArgs: { path } });
  }
  guard(root, 'secret-scan.ts', {
    toolName: 'write',
    toolArgs: { content: context },
  });
}
