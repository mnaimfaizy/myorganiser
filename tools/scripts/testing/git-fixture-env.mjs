// Shared by Contract Suites that build a throwaway git fixture under a temp
// directory and run `git` there with only `cwd` pointed at it.
//
// Husky invokes a commit's checkers as a `git commit` hook, which exports
// GIT_DIR, GIT_INDEX_FILE, and other `GIT_*` variables for that hook process
// tree. `cwd` does not override an inherited GIT_DIR — git prefers the
// environment variable — so a fixture's `git init`/`git add` resolves
// against the real repository instead of its own temp one, and can corrupt
// its index (observed: `core.bare` flipped to `true`, the index replaced
// with the fixture's own few files). `tools/scripts/lib/sandcastle-worktree-repair.ts`
// carries the same fix under the name `gitEnvironment` for its own (production,
// not fixture-only) git calls; this is that same filter for test fixtures.
//
// Call this once per `git` call scoped to a fixture, as its `env` option.
export function cleanGitEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
}
