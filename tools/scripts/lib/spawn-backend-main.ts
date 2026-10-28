import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

export function requireBackendBuild(mainPath: string): void {
  if (existsSync(mainPath)) return;

  console.error(`Backend build output not found at: ${mainPath}`);
  console.error('Run: yarn build:backend');
  process.exit(1);
}

/**
 * Serve the built API and keep this process alive until that child exits.
 * Signals sent to this process are forwarded so a caller such as Playwright
 * can stop the server.
 */
export function spawnBackendMain(
  mainPath: string,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const child = spawn(process.execPath, [mainPath], {
    stdio: 'inherit',
    env,
  });

  const stop = () => {
    child.kill();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  return child;
}
