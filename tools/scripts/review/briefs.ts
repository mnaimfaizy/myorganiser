/**
 * Where each axis's brief lives, and the exact message that sends a sub-agent
 * to it (issue #1031, ADR 0123).
 *
 * Three readers need these and must not each keep a copy:
 * `check-review-rules.ts` asserts the brief files against the rule catalogue
 * and the skill against the template, and `transcript-facts.ts` recognises
 * an axis's dispatch in a reviewer transcript by them. A template the skill
 * states one way and the transcript reader expects another would report every
 * correct dispatch as steered.
 *
 * Keyed by finding axis, and deliberately not `satisfies Record<FindingAxis,
 * …>`: that would import the axes from `schema.ts`, which reaches `zod`, and
 * this module is read by jobs that run before anything is installed. So
 * `check-review-rules.ts` asserts the keys against `FINDING_AXES` instead.
 */
export const BRIEFS: Readonly<Record<string, string>> = Object.freeze({
  standards: '.agents/skills/code-review/STANDARDS_BRIEF.md',
  spec: '.agents/skills/code-review/SPEC_BRIEF.md',
});

/** Where the spec's text is handed to the Spec sub-agent. */
export const SPEC_FILE = 'tmp/code-review/spec.json';

/**
 * The dispatch template, one entry per line, as the skill prints it.
 * `<placeholders>` are the only variable parts.
 */
const FIRST_LINE = (brief: string): string =>
  `Read ${brief} first and follow it. It is your whole brief.`;
const DIFF_LINE = '- diff: git diff <fixed-point>...HEAD';
const HEAD_LINE = '- head: <head>';
const SPEC_LINE = `- spec: <ref>, text in ${SPEC_FILE}`;

/**
 * The one line the template ever gains: a retry after a rejected reply.
 * `<axis>` is the axis's own name.
 */
export const RETRY_LINE =
  '- retry: your first reply was rejected; the reasons are in tmp/code-review/<axis>.rejected.txt';

export const DISPATCH_TEMPLATES: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  standards: Object.freeze([
    FIRST_LINE(BRIEFS.standards),
    DIFF_LINE,
    HEAD_LINE,
  ]),
  spec: Object.freeze([
    FIRST_LINE(BRIEFS.spec),
    DIFF_LINE,
    HEAD_LINE,
    SPEC_LINE,
  ]),
});

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What each placeholder may be filled with. A fixed point is a ref or a SHA
 * and a head is a full SHA; neither holds whitespace, which is what keeps a
 * sentence from hiding inside one. A spec reference is an issue number or a
 * path, and stops at the comma the template puts after it.
 */
const PLACEHOLDERS: Readonly<Record<string, string>> = Object.freeze({
  '<fixed-point>': '\\S+',
  '<head>': '[0-9a-f]{40}',
  '<ref>': '[^,\\n]+',
});

const lineToPattern = (line: string, axis: string): string => {
  let pattern = escapeRegExp(line.replaceAll('<axis>', axis));
  for (const [name, filler] of Object.entries(PLACEHOLDERS))
    pattern = pattern.replaceAll(escapeRegExp(name), filler);
  return pattern;
};

/**
 * Whether a dispatch message is the template with its placeholders filled in
 * and nothing else — optionally followed by the retry line.
 *
 * @param axis the axis the dispatch is for
 * @param prompt the message as the main agent sent it
 */
export const isOnTemplate = (axis: string, prompt: unknown): boolean => {
  const lines = DISPATCH_TEMPLATES[axis];
  if (!lines || typeof prompt !== 'string') return false;
  const body = lines.map((line) => lineToPattern(line, axis)).join('\\n');
  const retry = `(?:\\n${lineToPattern(RETRY_LINE, axis)})?`;
  return new RegExp(`^${body}${retry}$`).test(
    prompt.replaceAll('\r\n', '\n').trim(),
  );
};

/**
 * The axis a dispatch message names by its first line, or `null`. Used when
 * the sub-agent never read its brief, so the read cannot say which axis the
 * main agent meant.
 */
export const axisNamedBy = (prompt: unknown): string | null => {
  if (typeof prompt !== 'string') return null;
  for (const [axis, path] of Object.entries(BRIEFS))
    if (prompt.includes(path)) return axis;
  return null;
};
