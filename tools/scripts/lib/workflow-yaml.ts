/**
 * Slices a GitHub Actions workflow into the job and step blocks a checker or
 * Contract Suite wants to assert against.
 *
 * It exists for the reason `lib/glob.ts` gives for its own contents: a copy
 * of a rule is where the rule drifts, and this shape had already drifted
 * where it was written out by hand — one `stepNamed` matched a step name with
 * `indexOf`, so `- name: Lint` also matched `- name: Lint affected
 * projects`, and a suite asserting the wrong step's `if:` passes while
 * asserting nothing. That drift is why `stepNamed` here matches exactly.
 *
 * Hand-written copies of the shape remain elsewhere under `tools/scripts`.
 * Nothing asserts that this module is their only home, so it does not claim
 * to be one: retargeting a checker onto it is a deliberate change with that
 * checker's own gate to re-run, not a cleanup to do in passing.
 *
 * Text slicing rather than a YAML parse is deliberate, and matches the
 * existing checkers: these assertions are about the workflow as written —
 * which step carries which `if:`, in which job — and a parse throws away
 * the `if:` expression's exact text, which is the thing being pinned.
 *
 * Both functions throw rather than return null: a job or step that is not
 * there is a failed assertion, and the message naming it is the whole
 * point.
 */

/** Escapes a string for literal use inside a RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The body of one job, from its `<jobId>:` key to the next top-level job key.
 *
 * Anchored under `jobs:` so a key of the same name elsewhere in the file —
 * `on:`, a `with:` input — cannot be mistaken for the job.
 */
export function jobBlock(source: string, jobId: string): string {
  const jobsAt = source.search(/^jobs:\s*$/m);
  if (jobsAt === -1) throw new Error('workflow has no jobs:');
  const body = source.slice(jobsAt);
  const start = body.search(
    new RegExp(`^ {2}${escapeRegExp(jobId)}:\\s*$`, 'm'),
  );
  if (start === -1) throw new Error(`no job named ${jobId}`);
  const rest = body.slice(start + 1);
  const next = rest.search(/^ {2}[a-z0-9][a-z0-9-]*:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * The body of one step of `job`, matched on its **exact** name.
 *
 * Exact, because a prefix match is how a suite ends up asserting a
 * neighbouring step: the name is anchored to the whole `- name:` line, so a
 * step renamed by adding words fails here instead of silently matching.
 */
export function stepNamed(job: string, name: string): string {
  const header = new RegExp(`^ {6}- name: ${escapeRegExp(name)}\\s*$`, 'm');
  const match = header.exec(job);
  if (!match) throw new Error(`no step named exactly "${name}"`);
  const rest = job.slice(match.index);
  const next = rest.slice(1).search(/\n {6}- name: /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}
