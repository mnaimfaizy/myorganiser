/**
 * Detaches a Contract Suite's git fixtures from whatever repository started it.
 *
 * A git hook exports `GIT_DIR`, `GIT_INDEX_FILE` and friends for the repository
 * it runs in, and every child process inherits them. A suite that builds a
 * scratch repository with `git init` in a temp directory therefore does not get
 * one when Husky runs it: git honours `GIT_DIR` over `cwd`, so `init`
 * reinitialises the hook's repository and every fixture `add`, `commit` and
 * `config` after it writes there. From a linked worktree, `GIT_DIR` is
 * `.git/worktrees/<name>`, which `git init` guesses is bare — it sets
 * `core.bare = true` in the primary checkout's shared config, and the primary
 * checkout stops working ("this operation must be run in a work tree").
 * Slice #1327's pre-commit run of its own suite did exactly that, and wrote
 * `a <a@example.com>` "init" commits onto its slice branch.
 *
 * `isolateGitEnvironment()` strips every `GIT_*` variable from this process, so
 * each git call a suite makes — and each checker it spawns, which runs git in
 * the fixture too — finds its repository from `cwd`. A suite that runs
 * `git init` calls it once at module top level, before any test runs;
 * `git-environment.test.ts` fails a suite that does not.
 *
 * Production code that must keep the rest of its environment uses the per-spawn
 * form instead (`gitEnvironment` in `sandcastle-worktree-repair.ts`).
 */

/** Deletes every inherited `GIT_*` variable from `process.env`. */
export function isolateGitEnvironment(): void {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('GIT_')) delete process.env[name];
  }
}
