import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { screenContext } from './codex-context-guard.ts';

// The child receives data returned by these fixed invocations. No command or
// revision supplied by the child is executed by the host.
export function captureRoleContext(
  root: string,
  role: 'Commit',
  explicitBase?: string,
  guardRoot?: string,
): { staged_status: string; staged_diff: string };
export function captureRoleContext(
  root: string,
  role: string,
  explicitBase?: string,
  guardRoot?: string,
):
  | { staged_status: string; staged_diff: string }
  | {
      branch_summary: string;
      merge_base: string;
      branch_commits: string;
      branch_diff: string;
      issues: Record<string, string>;
      files: Record<string, string>;
    };
export function captureRoleContext(
  root: string,
  role: string,
  explicitBase?: string,
  guardRoot = root,
) {
  const env = {
    ...process.env,
    GIT_PAGER: 'cat',
    GIT_EXTERNAL_DIFF: '',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
  function run(command: string, args: string[]): string;
  function run(
    command: string,
    args: string[],
    allowFailure: true,
  ): string | null;
  function run(
    command: string,
    args: string[],
    allowFailure = false,
  ): string | null {
    const result = spawnSync(command, args, {
      cwd: root,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      if (allowFailure) return null;
      throw new Error(`Unable to capture ${command} ${args[0]}`);
    }
    return result.stdout;
  }
  function git(...args: string[]) {
    return run('git', ['--no-pager', ...args]);
  }
  if (role === 'Commit') {
    const status = () =>
      git(
        'diff',
        '--cached',
        '--name-status',
        '--no-ext-diff',
        '--no-textconv',
      );
    const diff = () =>
      git('diff', '--cached', '--no-ext-diff', '--no-textconv');
    const stagedStatus = status();
    const stagedDiff = diff();
    if (status() !== stagedStatus || diff() !== stagedDiff)
      throw new Error('The index changed while capturing Commit context');
    const context = { staged_status: stagedStatus, staged_diff: stagedDiff };
    const paths = git(
      'diff',
      '--cached',
      '--name-only',
      '-z',
      '--no-ext-diff',
      '--no-textconv',
    )
      .split('\0')
      .filter(Boolean);
    screenContext(guardRoot, context, paths);
    return context;
  }
  if (role !== 'PrAuthor') throw new Error('Unsupported role context');
  const head = git('rev-parse', '--verify', 'HEAD').trim();
  const branch = git('branch', '--show-current').trim();
  if (!branch) throw new Error('Cannot determine branch');
  const remote = run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], true);
  const base =
    explicitBase ||
    remote?.trim().replace(/^refs\/remotes\/origin\//, '') ||
    'main';
  if (
    base.startsWith('-') ||
    run('git', ['check-ref-format', '--branch', base], true) === null
  ) {
    throw new Error('Invalid base branch');
  }
  const remoteBase = run(
    'git',
    ['rev-parse', '--verify', `refs/remotes/origin/${base}^{commit}`],
    true,
  );
  const baseRef = remoteBase
    ? `refs/remotes/origin/${base}`
    : `refs/heads/${base}`;
  const mergeBase = git('merge-base', baseRef, 'HEAD').trim();
  if (!/^[0-9a-f]{40,64}$/i.test(mergeBase))
    throw new Error('Invalid merge base');
  const commits = git(
    'log',
    '--reverse',
    '--no-merges',
    '--format=%s%n%b%n---',
    `${mergeBase}..HEAD`,
  );
  const diff = git(
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    `${mergeBase}...HEAD`,
  );
  const stat = git(
    'diff',
    '--stat',
    '--no-ext-diff',
    '--no-textconv',
    `${mergeBase}...HEAD`,
  );
  const issues: Record<string, string> = {};
  const references = [
    ...new Set(
      [...`${branch}\n${commits}`.matchAll(/#(\d+)|(?:^|\/)\w+\/(\d+)-/gm)].map(
        (match) => match[1] || match[2],
      ),
    ),
  ].slice(0, 25);
  for (const number of references) {
    issues[number] =
      run(
        'gh',
        ['issue', 'view', number, '--json', 'number,title,state,labels,body'],
        true,
      ) ?? 'Issue details were not fetched.';
  }
  const files: Record<string, string> = {};
  const changed = git(
    'diff',
    '--name-only',
    '-z',
    '--no-ext-diff',
    `${mergeBase}...HEAD`,
  )
    .split('\0')
    .filter(Boolean);
  for (const name of [
    ...new Set([...changed, 'tools/config/github-labels.json']),
  ]) {
    const guard = spawnSync(
      process.execPath,
      [join(guardRoot, 'tools/scripts/copilot-hooks/pre-tool-use.ts')],
      {
        cwd: root,
        input: JSON.stringify({ toolName: 'read', toolArgs: { path: name } }),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
        maxBuffer: 8192,
      },
    );
    let decision;
    try {
      decision = JSON.parse(guard.stdout).permissionDecision;
    } catch {
      throw new Error('Unable to verify read policy');
    }
    if (guard.status === 2 && decision === 'deny') continue;
    if (guard.status !== 0 || decision !== 'allow')
      throw new Error('Unable to verify read policy');
    const content = run('git', ['--no-pager', 'show', `HEAD:${name}`], true);
    if (content !== null && content.length <= 1048576) files[name] = content;
  }
  if (
    git('rev-parse', '--verify', 'HEAD').trim() !== head ||
    git('branch', '--show-current').trim() !== branch ||
    git('merge-base', baseRef, 'HEAD').trim() !== mergeBase
  ) {
    throw new Error('The branch changed while capturing PrAuthor context');
  }
  const context = {
    branch_summary: JSON.stringify({ branch, base, stat }),
    merge_base: mergeBase,
    branch_commits: commits,
    branch_diff: diff,
    issues,
    files,
  };
  screenContext(guardRoot, context, changed);
  return context;
}
