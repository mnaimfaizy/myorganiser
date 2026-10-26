#!/usr/bin/env node
// Asserts that the reviewer's tool allowlist and the repository's project
// settings agree: every instructed command is permitted, none is intercepted
// by an ask or deny rule, no Bash grant is wholly or partly retracted by one
// of those rules, and every file grant is one Claude Code consults and
// anchors where the session started.
//
//   node tools/scripts/check-review-tool-allowlist.ts [--print]
//
// Both sides are files. The instruction side is
// `.agents/skills/code-review/SKILL.md`, the two brief files beside it that
// the sub-agents read (`STANDARDS_BRIEF.md`, `SPEC_BRIEF.md`), and
// `docs/review/REVIEW_CHECKLIST.md`; the permission side is the `--allowedTools` list in
// `.github/actions/code-reviewer/action.yml`, which is what the reviewer's
// harness enforces in CI. Nothing here reads a transcript: a transcript
// artifact expires after seven days, so a check that depended on one could not
// be run against the tree at any later commit.
//
// This is the Meta-Gate's own reasoning — a checker nothing runs is not a gate
// — applied to the allowlist: an instruction the reviewer is refused
// permission to follow is an instruction nothing can carry out. It is not
// free, either. In golden replay run 45 the guard case
// `groceries-blob-type-without-fanouts` died at `error_max_turns` with 26
// permission denials against 81 turns — roughly a third of the budget spent
// being told no, and no report written at all, so the run measured nothing
// (docs/research/2026-09-10-the-answer-sheet-is-inert.md).
//
// What counts as an instruction, and why it is drawn this wide:
//
//   - Every command line in a fenced `bash`/`sh`/`shell`/`console` block.
//   - Every inline code span that reads as a command, in prose and inside any
//     other fence: its first token is a program (`yarn`, `git`, `sed`, …) and
//     it carries an argument, or it is a package.json script name.
//     `openapi:check` is how the checklist names the gate the reviewer must
//     run, and a rule that only understood a leading `yarn` would miss the one
//     obligation that instructs running anything.
//   - A script written as a *shape* rather than a name — "the `*:check`
//     gates" — expanded to every script it names. It is the broadest
//     instruction either document gives, and reading it as prose would leave
//     this gate reporting only whichever literal spellings happen to be
//     written down nearby.
//
// A checklist entry's `Why this exists` paragraph is skipped — that block is
// one of the four things the checklist says an entry answers, and it is the
// one written in the past tense. `openapi:sync` appears there because a
// release once skipped it, which is a fact about 2026 and not a command
// anybody is being handed.
//
// Under-reporting is the failure this gate exists to close, so the reading is
// deliberately broad and the suppressions are written down instead. Both
// documents have two readers — a terminal session and a CI job — and they also
// name machinery by its script name (`review:publish`, `review:spec`) while
// telling the reviewer not to run it. `NOT_THE_REVIEWERS_TO_RUN` records that
// judgement once, with a reason each, and an entry that stops matching
// anything is an error rather than a silent no-op.
//
// Matching is token-wise, not string-prefix. `Bash(sed -n:*)` permits a
// command whose first two tokens are exactly `sed` and `-n`; it permits
// nothing about `sed '1,20p' file`, which is the shape that leaves an entry
// carrying a flag matching nothing anyone was told to run. A token the
// instruction leaves as a placeholder (`<project>`, `$BRANCH`) matches
// anything, because the document did not fix it.
//
// A trailing ` *` is the same prefix rule as `:*` and also matches the bare
// command, and a `*` anywhere else matches any text, spaces included — Claude
// Code's documented rule syntax, which `.claude/settings.json` is written in.
// Reading ` *` as a literal last token, as this checker once did, made every
// rule in that form catch only commands of exactly its own length: the
// interception direction under-reported, the failure this gate exists to rule
// out, and it still printed OK.
//
// The permission side is two files, not one, and that is the whole of what
// golden replay run 46 cost a fifth of its turn budget to learn. `--allowedTools`
// adds *allow* rules; the repository's own `.claude/settings.json` is loaded as
// project settings by the same session, and Claude Code evaluates `deny`, then
// `ask`, then `allow`. An `ask` match therefore beats an `--allowedTools` grant
// — and in a headless run there is nobody to ask, so it resolves as a refusal.
// That is the asymmetry: `git worktree add` matches no `ask` rule and ran,
// while `git worktree remove` matches `Bash(git worktree remove:*)` in the
// settings' `ask` list and was refused eleven times under the same
// `Bash(git worktree:*)` grant. `node -e` is the same mechanism on an unrelated
// command, refused while `Bash(node:*)` was granted
// (docs/research/2026-09-22-a-project-ask-rule-is-a-refusal-in-ci.md, ADR 0099).
//
// So this checker asserts four directions, and all four are needed:
//
//   1. Every instructed command is *permitted* by `--allowedTools`. An
//      instruction nothing grants is an instruction nothing can carry out.
//   2. No instructed command is *intercepted* by an `ask` or `deny` rule in
//      `.claude/settings.json`. A grant an interposed rule overrides is a
//      permission the reviewer does not actually have, which is exactly the
//      gap direction 1 passed straight through for two runs.
//   3. No `--allowedTools` Bash grant is *retracted*, wholly or partly, by an
//      `ask` or `deny` rule in `.claude/settings.json`. Direction 2 only sees
//      a command a document instructs. A grant the reviewer reaches for on
//      its own is refused the same way, and direction 2 stays green because
//      nobody was told to run it. The refusal is the mechanism ADR 0099
//      records: an ask rule outranks the grant, and a headless run has nobody
//      to answer it. "Wholly" means the rule
//      matches every command the grant permits (`Bash(find:*)` against the
//      same rule). "Partly" means it matches a narrower form, which is the
//      damaging case: `Bash(node:*)` still looks granted while
//      `Bash(node -e:*)` takes the inline-script form out from under it.
//      Matching is the same token-wise reading as direction 2, so
//      `git merge-base` is not `git merge`. A pair can be exempted, with a
//      written reason, when the rule has to stay and the grant is still the
//      one the reviewer should have; an exemption that matches no live pair
//      is stale and the check cannot run.
//   4. Every path-scoped file grant in `--allowedTools` is *anchored*, and is
//      written on a tool Claude Code consults. A bare `Edit(tmp/x/**)` is
//      relative to the session's current directory, and the Bash tool keeps a
//      `cd`: golden replay run 35716439899 changed into its worktree and was
//      then refused every write to its own report under a grant that named
//      the path (issue #880, ADR 0118). `Edit(/tmp/x/**)` anchors at the
//      primary working directory instead. File permissions are checked
//      against `Edit(path)` and `Read(path)` rules only, so a `Write(path)`
//      rule is accepted and never consulted — a grant that reads as scoping
//      something and scopes nothing. Both are failed here. What a file grant
//      should *cover* is not asserted: that is ADR 0075's decision, and this
//      checker has no second source to compare the directory against.
//
// One direction is still not asserted, and the omission is deliberate: an
// `--allowedTools` entry matching no instruction and retracted by no rule is
// *not* failed here. #715 removed `Bash(sed -n:*)` on that reading and the
// reviewer was refused `sed` anyway — the entry was never what refused it.
// An unused grant costs a turn only if something instructs it (direction 1)
// or a rule retracts it (direction 3).
//
// Exit 0 = every instructed command is permitted, none is intercepted, no
// grant is retracted, and every file grant is anchored. Exit 1 = at least one
// is refused, retracted, or unanchored, each named with its instruction site
// or its grant and the interposed rule.
// Exit 2 = could not run, including a suppression or a grant exemption that
// matches nothing.
import { readFileSync } from 'node:fs';

import { tokenize } from './lib/shell-command.ts';
import { isMain } from './review/cli.mjs';

export const ACTION = '.github/actions/code-reviewer/action.yml';
/**
 * The repository's own Claude Code project settings. The CI checkout carries
 * this file — it is tracked — so the reviewer's session loads it alongside
 * whatever `--allowedTools` passes, and its `ask` and `deny` rules are
 * evaluated first. It is written for a developer at a keyboard, where `ask`
 * means a prompt somebody answers; the reviewer has no keyboard.
 */
export const SETTINGS = '.claude/settings.json';
export const INSTRUCTION_SOURCES = [
  '.agents/skills/code-review/SKILL.md',
  '.agents/skills/code-review/STANDARDS_BRIEF.md',
  '.agents/skills/code-review/SPEC_BRIEF.md',
  'docs/review/REVIEW_CHECKLIST.md',
];

/**
 * First tokens that make a code span a command rather than a name.
 *
 * Written out rather than derived from the allowlist, and that is the whole
 * point: derived, the vocabulary would shrink exactly when the allowlist
 * narrows, so removing `Bash(sed -n:*)` would make every `sed` instruction
 * invisible instead of refused — the gate falling silent at the moment it has
 * something to say. Deriving is still what keeps it honest in the other
 * direction: `assertProgramVocabulary` fails when the action grants a program
 * this list does not know, so the two can only be widened together.
 */
export const PROGRAMS = new Set([
  // package managers and runtimes
  'corepack',
  'yarn',
  'npm',
  'npx',
  'pnpm',
  'node',
  'nx',
  'git',
  // the shell utilities the action grants, and the neighbours of each
  'sed',
  'awk',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'rg',
  'find',
  'ls',
  'mkdir',
  'rm',
  'cp',
  'mv',
  'echo',
  'jq',
  'gh',
  'curl',
]);

/** Fence info strings whose contents are commands rather than prose. */
const SHELL_FENCES = new Set(['bash', 'sh', 'shell', 'console']);

/**
 * Commands the two documents name but do not ask the reviewer to run, each
 * with the reason it is not the reviewer's to run. Matched as a token prefix
 * of an instructed command, with a leading `corepack` ignored on both sides:
 * the question here is which command it is, not which of the two documented
 * spellings reached the page.
 *
 * An entry matching nothing fails the check (exit 2). A suppression is a claim
 * about what a document says; when the document stops saying it, the claim is
 * stale and the next real instruction could hide behind it.
 */
/** A written suppression: one command, and why it is not the reviewer's to run. */
export interface Exemption {
  command: string;
  reason: string;
}

export const NOT_THE_REVIEWERS_TO_RUN: Exemption[] = [
  {
    command: 'yarn review:obligations:select',
    reason:
      'The composite action selects the worklist before the reviewer takes a turn, and the CI prompt says not to re-run the selector — tmp/code-review/obligations.json is a read.',
  },
  {
    command: 'yarn review:obligations:check',
    reason:
      'A completeness reporter over the answer sheet, run after the review and failing nothing. The skill names where completeness is reported; it does not ask the reviewer to report it.',
  },
  {
    command: 'yarn review:checklist:check',
    reason:
      "The drift gate between the checklist and the obligation catalogue, named in the checklist's Status section as the thing that holds the two forms together. Husky and CI run it.",
  },
  {
    command: 'yarn review:spec',
    reason:
      'The workflow resolves the spec with the job token before the reviewer runs. The reviewer holds no token and is told to fetch nothing (ADR 0071 item 8).',
  },
  {
    command: 'yarn review:render',
    reason:
      'Step 5 renders the report for a human at a terminal. In CI the prompt says not to render: a later job publishes.',
  },
  {
    command: 'yarn review:publish',
    reason:
      'Runs in the one job whose token can write. The reviewer must not post, label, or resolve anything, so being refused this is the design rather than a gap.',
  },
  {
    command: 'git -C',
    reason:
      'Named by the skill only to forbid it. The reviewer reached for `git -C <dir> show …` after being told not to `cd`, and was refused — the leading tokens are `git` and `-C`, which no entry grants. `git show <sha>:<path>` is the granted way to read another tree, so this is a warning, not an instruction (ADR 0099).',
  },
  {
    command: 'git worktree remove',
    reason:
      "The throwaway worktree is discarded with the runner in CI and lives under gitignored tmp/ locally, so the reviewer is told to leave it. The skill names the command for the human who cleans up afterwards and answers the project settings' `ask` — which, with nobody at a keyboard, is what refused the reviewer eleven times (ADR 0099).",
  },
  {
    command: 'yarn openapi:check',
    reason:
      'A coveringGate value in obligation run-the-gate-that-covers-this-change, so it is a gate NAME the reviewer greps the hooks and workflows for, never a command it runs (ADR 0098). This one is doubly not the reviewer to run: it resyncs the spec and rewrites files in the checkout, which the checklist entry says in so many words.',
  },
  {
    command: 'yarn prisma:migrations:check',
    reason:
      'A coveringGate value in the same obligation. The entry answers wiredBy by reading, not running; where a reviewer does run a checker it is the check-*.mjs script through node, which the allowlist permits and this spelling is not.',
  },
  {
    command: 'yarn design-tokens:check',
    reason:
      'A coveringGate value in the same obligation, and an nx target that rebuilds libs/design-tokens/src/generated before asserting the tree is clean — mutating the checkout is not something a reviewer should do (ADR 0098).',
  },
  {
    command: 'git branch --show-current',
    reason:
      'Step 2 reads the branch name to find the spec interactively. In CI the branch name is given in the prompt as a fact, along with the fixed point, the head, and the tier.',
  },
];

const die: (msg: string) => never = (msg) => {
  console.error(`review-allowlist: ${msg}`);
  process.exit(2);
};

/**
 * A token the document left open — `<project>`, `$BRANCH`, `${SHA}`. It names
 * no particular value, so it can neither satisfy nor contradict an entry's
 * token and is read as matching either way.
 *
 * Deliberately not called `isPlaceholder`: `check-doc-commands.ts` has a
 * predicate by that name asking a different question — whether a token names
 * one file — and it answers `true` for a glob, which this one must not.
 */
export const isUnfixedToken = (token: string) =>
  /[<>]/.test(token) || /^\$\{?\w+\}?$/.test(token);

/** Split a comma-separated tool list without cutting inside `Bash(...)`. */
export function splitToolList(list: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of list) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      entries.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  entries.push(current);
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Stands in for an unfixed command token inside a joined command string. No
 * literal character in a rule matches it, while a rule's `*` absorbs it — so a
 * placeholder can sit under a wildcard but can never be what a rule catches.
 */
const UNFIXED = '\u0000';

/**
 * A whole rule pattern as Claude Code reads it: `*` matches any text,
 * spaces included, and a trailing ` *` also matches the bare command.
 */
const rulePatternToRegExp = (pattern: string) => {
  const body = pattern.replace(/:\*$/, ' *');
  const trailing = /\s\*$/.test(body);
  const core = trailing ? body.replace(/\s\*$/, '') : body;
  const escaped = core
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${trailing ? '(?: .*)?' : ''}$`, 's');
};

/**
 * One `--allowedTools` entry, or one `ask`/`deny` rule.
 *
 * `Bash(x:*)` and `Bash(x *)` are prefix rules: a command whose leading tokens
 * are `x`'s tokens, the bare command included. `Bash(x)` is exact — the whole
 * command, token for token. A `*` left anywhere else makes the rule a `glob`,
 * matched against the whole command because that `*` may span tokens
 * (`git push *--force*` catches `git push origin main --force`). Anything else
 * (`Read`, `Agent`) grants a tool that is not the shell, and permits no command
 * at all.
 */
/**
 * One `--allowedTools` entry, or one `ask`/`deny` rule, as the matcher reads
 * it. `list` is set only on an interposed rule, and names which of the two
 * lists in `.claude/settings.json` it came from.
 */
export type ToolEntry =
  | { raw: string; kind: 'tool'; tokens: string[]; list?: string }
  | {
      raw: string;
      kind: 'exact' | 'prefix';
      pattern: string;
      tokens: string[];
      list?: string;
    }
  | {
      raw: string;
      kind: 'glob';
      /** Which shape the glob falls back to when read token by token. */
      anchor: 'exact' | 'prefix';
      pattern: string;
      tokens: string[];
      regex: RegExp;
      list?: string;
    };

export function parseToolEntry(raw: string): ToolEntry {
  const trimmed = raw.trim();
  const bash = trimmed.match(/^Bash\((.*)\)$/s);
  if (!bash) return { raw: trimmed, kind: 'tool', tokens: [] };
  const inner = bash[1].trim();
  const isPrefix = inner.endsWith(':*') || /\s\*$/.test(inner);
  const pattern = isPrefix ? inner.replace(/(?::|\s)\*$/, '').trim() : inner;
  const tokens = tokenize(pattern);
  if (pattern.includes('*'))
    return {
      raw: trimmed,
      kind: 'glob',
      anchor: isPrefix ? 'prefix' : 'exact',
      pattern,
      tokens,
      regex: rulePatternToRegExp(inner),
    };
  return {
    raw: trimmed,
    kind: isPrefix ? 'prefix' : 'exact',
    pattern,
    tokens,
  };
}

/** The `--allowedTools` entries the composite action passes to the reviewer. */
export function parseAllowedTools(yaml: string): ToolEntry[] | null {
  const match = yaml.match(/--allowedTools\s+"([^"]*)"/);
  if (!match) return null;
  return splitToolList(match[1]).map(parseToolEntry);
}

/**
 * The `ask` and `deny` rules in `.claude/settings.json`, as entries that can be
 * matched the same way an allow entry is.
 *
 * Both lists, not just `deny`, and the reason is the finding this gate was
 * built on: in a headless run an unanswerable `ask` is a refusal, so the two
 * differ only in what a human at a keyboard would see. `PowerShell(...)`
 * entries parse to `kind: 'tool'` and match no command, which is correct —
 * the reviewer runs bash.
 *
 * Returns `null` when the file is absent, which is a real state (a clone with
 * no project settings) and not a failure: nothing is interposed.
 */
export function parseInterposedRules(json: string): ToolEntry[] {
  const permissions: Record<string, string[] | undefined> =
    JSON.parse(json)?.permissions ?? {};
  const rules: ToolEntry[] = [];
  for (const list of ['deny', 'ask']) {
    for (const raw of permissions[list] ?? [])
      rules.push({ ...parseToolEntry(raw), list });
  }
  return rules;
}

/**
 * Every program the allowlist grants must be one `PROGRAMS` can recognise, or
 * an instruction to run it reads as prose and is never compared against
 * anything. That is the gate passing while the reviewer is refused, which is
 * the one outcome it exists to rule out — so it is an error, not a finding.
 *
 * Returns the granted programs the vocabulary does not know.
 */
export function unknownGrantedPrograms(
  entries: ToolEntry[],
  programs = PROGRAMS,
) {
  const unknown = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'tool') continue;
    const [program] = entry.tokens;
    if (program && !programs.has(program)) unknown.add(program);
  }
  return [...unknown];
}

const globToRegExp = (token: string) =>
  new RegExp(
    `^${token.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
  );

/**
 * `unfixedMatches` is which way to read a token the document left open, and
 * the two directions want opposite answers.
 *
 * Reading `<project>` as matching anything is generous to the document, which
 * is right when asking whether a grant *covers* an instruction: the document
 * did not fix the token, so no value of it should be reported as refused.
 * It is exactly wrong when asking whether an interposed rule *catches* one.
 * `node tools/scripts/check-<name>.mjs` is not `node -e` for any value of
 * `<name>`, and the generous reading called it one — a refusal invented out
 * of a placeholder. An interception has to be certain, so there an unfixed
 * token matches nothing.
 */
const tokenMatches = (
  commandToken: string,
  entryToken: string,
  unfixedMatches = true,
) => {
  if (isUnfixedToken(commandToken)) return unfixedMatches;
  if (entryToken.includes('*'))
    return globToRegExp(entryToken).test(commandToken);
  return commandToken === entryToken;
};

/** Would this entry permit a command with these tokens? */
export function matchesEntry(
  entry: ToolEntry,
  commandTokens: string[],
  { unfixedMatches = true } = {},
): boolean {
  if (entry.kind === 'tool') return false;
  if (entry.tokens.length === 0) return false;
  if (entry.kind === 'glob') {
    const joined = commandTokens
      .map((token) => (isUnfixedToken(token) ? UNFIXED : token))
      .join(' ');
    if (entry.regex.test(joined)) return true;
    // The generous reading still lets a placeholder stand for a literal the
    // rule names, which the joined form cannot express: fall back to reading
    // each `*` as confined to its own token.
    if (!unfixedMatches || !commandTokens.some(isUnfixedToken)) return false;
    return matchesEntry({ ...entry, kind: entry.anchor }, commandTokens, {
      unfixedMatches,
    });
  }
  if (entry.kind === 'exact' && commandTokens.length !== entry.tokens.length)
    return false;
  if (commandTokens.length < entry.tokens.length) return false;
  return entry.tokens.every((token, index) =>
    tokenMatches(commandTokens[index], token, unfixedMatches),
  );
}

/** How many leading tokens the entry and the command agree on. */
export function sharedPrefixLength(entry: ToolEntry, commandTokens: string[]) {
  let shared = 0;
  while (
    shared < entry.tokens.length &&
    shared < commandTokens.length &&
    tokenMatches(commandTokens[shared], entry.tokens[shared])
  )
    shared += 1;
  return shared;
}

/**
 * The entry a reader should look at first: the one agreeing with the command
 * for longest, earliest in the list on a tie. Reporting the refusal without it
 * leaves the reader to diff a command against thirty entries by eye.
 */
export function nearestEntry(
  entries: ToolEntry[],
  commandTokens: string[],
): { entry: ToolEntry; shared: number } | null {
  let best: { entry: ToolEntry; shared: number } | null = null;
  for (const entry of entries) {
    if (entry.kind === 'tool') continue;
    const shared = sharedPrefixLength(entry, commandTokens);
    if (best === null || shared > best.shared) best = { entry, shared };
  }
  return best;
}

/** A script name written as a shape rather than a name: `*:check`. */
const isScriptGlob = (token: string) =>
  token.includes('*') && token.includes(':') && /^[a-z0-9:*-]+$/.test(token);

/**
 * The commands one line of a document asks for, as `{ command, alternatives }`
 * — one site, and the token lists that would satisfy it. A bare script name
 * has two alternatives because the repository documents two spellings of the
 * same run; a command written out has one, because that is what a reader runs.
 *
 * A script *shape* — the skill's "the `*:check` gates" and the obligation's
 * "name the `*:check` gate that covers the changed artifact" — is the broadest
 * instruction either document gives, and reading it as prose would leave the
 * gate reporting only whichever literal spellings happen to be written down
 * nearby. It expands to every script the shape names, and it is `shape: true`:
 * a shape is refused only when no script it names is permitted, and no written
 * suppression covers it, because a suppression names a command and a shape is
 * a class.
 */
/**
 * One instruction site: the command a line asks for, and the token lists that
 * would satisfy it. `shape` marks a script shape (`*:check`), which stands for
 * a class of commands rather than one, and `names` are the scripts it names.
 */
export interface InstructionSite {
  file?: string;
  line?: number;
  sectionId?: string | null;
  command: string;
  alternatives: string[][];
  shape?: boolean;
  names?: string[];
}

export function commandsFrom(
  text: string,
  scripts: Set<string> = new Set(),
): InstructionSite[] {
  const source = text.trim();
  if (!source || source.startsWith('#')) return [];

  const substitutions = [...source.matchAll(/\$\(([^()]*)\)/g)].map(
    (m) => m[1],
  );
  const remainder = source.replace(/\$\(([^()]*)\)/g, ' ');

  const found: InstructionSite[] = [];
  for (const piece of [remainder, ...substitutions]) {
    for (const segment of piece.split(/&&|\|\||[;|]/)) {
      const tokens = tokenize(segment.replace(/^\s*[$>]\s+/, ''));
      if (tokens.length === 0) continue;
      const [head] = tokens;
      // An argument is what separates an instruction from a name. The skill
      // writes `head` for the head SHA in running prose, and reading that as
      // the `head` utility would put a site in the corpus that nobody was ever
      // instructed to run — permitted today only because the action happens to
      // grant `head`, and a finding the day it stops.
      if (PROGRAMS.has(head) && tokens.length > 1) {
        found.push({ command: tokens.join(' '), alternatives: [tokens] });
        continue;
      }
      // A script name is only ever run through the package manager, so the
      // repository's two documented spellings are the alternatives. Requiring
      // a colon keeps `test`, `build`, and `lint` — words before they are
      // scripts — out of the corpus.
      if (head.includes(':') && scripts.has(head)) {
        found.push({
          command: ['corepack', 'yarn', ...tokens].join(' '),
          alternatives: [
            ['corepack', 'yarn', ...tokens],
            ['yarn', ...tokens],
          ],
        });
        continue;
      }
      if (tokens.length === 1 && isScriptGlob(head)) {
        const named = [...scripts]
          .filter((script) => globToRegExp(head).test(script))
          .sort();
        // A shape naming no script is a shape about nothing — a stale
        // reference, which `docs:commands:check` is the gate for, not this one.
        if (named.length === 0) continue;
        found.push({
          command: `corepack yarn ${head}`,
          shape: true,
          names: named,
          alternatives: named.flatMap((script) => [
            ['corepack', 'yarn', script],
            ['yarn', script],
          ]),
        });
      }
    }
  }
  return found;
}

/**
 * Every instruction site in one document.
 *
 * `sectionId` carries the `**id**` of the checklist entry a site sits in, so a
 * refusal can name the obligation rather than only a line number. It resets at
 * every `##` heading: an id belongs to its own entry and to nothing after it.
 *
 * `**Why this exists**` starts the entry's incident history, which runs to the
 * end of the entry. It names the commands a past release ran or failed to run,
 * in the past tense, and instructs nobody.
 */
export function extractInstructions(
  text: string,
  {
    file,
    scripts = new Set<string>(),
  }: { file?: string; scripts?: Set<string> } = {},
): InstructionSite[] {
  const sites: InstructionSite[] = [];
  let fence: string | null = null;
  let sectionId: string | null = null;
  let inHistory = false;

  text.split('\n').forEach((line, index) => {
    const fenceMatch = line.match(/^\s*```(\S*)/);
    if (fenceMatch) {
      fence = fence === null ? fenceMatch[1].toLowerCase() : null;
      return;
    }

    const push = (text_: string) => {
      for (const command of commandsFrom(text_, scripts))
        sites.push({ file, line: index + 1, sectionId, ...command });
    };

    // A shell fence is a list of commands, so every line is one. Any other
    // fence is read the way prose is — by its inline spans — because the
    // Standards brief's reach-through block is an unlabelled fence the
    // sub-agent reads as instructions, and its item 3 hands the reviewer a
    // `git grep` invocation. Skipping the whole fence would hide a block of instructions
    // for being formatted like a quotation. The finding-contract fence carries
    // no spans, so it still yields nothing.
    if (fence !== null) {
      if (inHistory) return;
      if (SHELL_FENCES.has(fence)) push(line);
      else for (const span of line.matchAll(/`([^`]+)`/g)) push(span[1]);
      return;
    }

    if (/^##\s/.test(line) || /^---\s*$/.test(line)) {
      sectionId = null;
      inHistory = false;
    }
    const idMatch = line.match(/^\*\*id\*\*\s+`([^`]+)`/);
    if (idMatch) sectionId = idMatch[1];
    if (/^\*\*Why this exists\*\*/.test(line)) inHistory = true;
    if (inHistory) return;

    for (const span of line.matchAll(/`([^`]+)`/g)) push(span[1]);
  });

  return dedupe(sites);
}

const dedupe = (sites: InstructionSite[]) => {
  const seen = new Set<string>();
  return sites.filter((site) => {
    const key = `${site.file}:${site.line}:${site.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const withoutCorepack = (tokens: string[]) =>
  tokens[0] === 'corepack' ? tokens.slice(1) : tokens;

const exemptionCovers = (exemption: Exemption, site: InstructionSite) => {
  // A suppression names one command somebody decided is not the reviewer's to
  // run. A shape is a class, and no such decision was made about a class.
  if (site.shape) return false;
  const wanted = withoutCorepack(tokenize(exemption.command));
  return site.alternatives.some((alternative) => {
    const tokens = withoutCorepack(alternative);
    return (
      tokens.length >= wanted.length &&
      wanted.every((token, index) => tokens[index] === token)
    );
  });
};

/**
 * Compares the instruction sites against the allowlist.
 *
 * Returns `{ ok, findings, exempted, staleExemptions, permitted }`. A finding
 * is one site no entry would permit; `staleExemptions` are suppressions that
 * matched nothing, which the caller treats as "could not run" rather than as a
 * finding — the list has stopped describing the documents.
 */
export function assertToolAllowlist({
  entries = [],
  sites = [],
  interposed = [],
  exemptions = NOT_THE_REVIEWERS_TO_RUN,
}: {
  entries?: ToolEntry[];
  sites?: InstructionSite[];
  interposed?: ToolEntry[];
  exemptions?: Exemption[];
}) {
  const used = new Set<string>();
  const findings: Finding[] = [];
  const intercepted: Interception[] = [];
  const exempted: { site: InstructionSite; exemption: Exemption }[] = [];
  const permitted: InstructionSite[] = [];

  for (const site of sites) {
    const exemption = exemptions.find((candidate) =>
      exemptionCovers(candidate, site),
    );
    if (exemption) {
      used.add(exemption.command);
      exempted.push({ site, exemption });
      continue;
    }

    // Interception is checked before the grant, because it outranks it. A
    // site whose every spelling is intercepted is refused however generously
    // `--allowedTools` is written; a site with one clear spelling left is not
    // a finding, since the reviewer has a way through.
    const clear = site.alternatives.filter(
      (alternative) =>
        !interposed.some((rule) =>
          matchesEntry(rule, alternative, { unfixedMatches: false }),
        ),
    );
    if (clear.length === 0) {
      const rule = interposed.find((candidate) =>
        matchesEntry(candidate, site.alternatives[0], {
          unfixedMatches: false,
        }),
      );
      intercepted.push({ site, rule });
      continue;
    }

    const allowed = clear.some((alternative) =>
      entries.some((entry) => matchesEntry(entry, alternative)),
    );
    if (allowed) {
      permitted.push(site);
      continue;
    }

    findings.push({
      site,
      nearest: nearestEntry(entries, site.alternatives[0]),
    });
  }

  const staleExemptions = exemptions.filter(
    (exemption) => !used.has(exemption.command),
  );

  return {
    ok:
      findings.length === 0 &&
      intercepted.length === 0 &&
      staleExemptions.length === 0,
    findings,
    intercepted,
    exempted,
    staleExemptions,
    permitted,
  };
}

/**
 * Where a site sits, as a reader needs to see it: the file and line, plus the
 * checklist obligation it belongs to when it has one.
 *
 * Shared by both reporters on purpose. They printed this from two identical
 * ternaries twenty lines apart, which is the shape where an editor fixing one
 * leaves the other behind and the two reporters start naming sites
 * differently.
 */
const siteLocation = (site: InstructionSite) =>
  site.sectionId
    ? `${site.file}:${site.line} (obligation ${site.sectionId})`
    : `${site.file}:${site.line}`;

/** One site whose every spelling an interposed rule catches. */
export interface Interception {
  site: InstructionSite;
  /** The rule that caught it — `clear` is empty, so one always did. */
  rule: ToolEntry | undefined;
}

/** One refused site, with the entry that comes closest to permitting it. */
export interface Finding {
  site: InstructionSite;
  nearest: { entry: ToolEntry; shared: number } | null;
}

/** One interception, as the lines a reader needs to act on it. */
export function formatInterception({ site, rule }: Interception) {
  return [
    `  - ${siteLocation(site)}`,
    `      instructed:  ${site.command}`,
    `      intercepted: ${rule?.raw} in ${SETTINGS} (permissions.${rule?.list})`,
  ].join('\n');
}

/** One finding, as the lines a reader needs to act on it. */
export function formatFinding({ site, nearest }: Finding) {
  const shape = site.shape
    ? ` (a shape: ${site.names?.length} script(s) match it, none permitted)`
    : '';
  const lines = [
    `  - ${siteLocation(site)}`,
    `      instructed: ${site.command}${shape}`,
  ];
  if (!nearest || nearest.shared === 0) {
    lines.push(
      `      nearest:    none — no Bash entry begins with \`${site.alternatives[0][0]}\``,
    );
    return lines.join('\n');
  }
  const shared = nearest.entry.tokens.slice(0, nearest.shared).join(' ');
  const required = nearest.entry.tokens[nearest.shared];
  lines.push(
    `      nearest:    ${nearest.entry.raw} — permits \`${shared}\`` +
      (required === undefined
        ? ', and nothing longer'
        : `, then requires \`${required}\``),
  );
  return lines.join('\n');
}

/**
 * Written exemptions from direction 3. A pair is `{ grant, rule, reason }`,
 * matched on the raw text of the `--allowedTools` entry and the interposed
 * rule — `Bash(git worktree remove *)` and `Bash(git worktree remove:*)` are
 * the same prefix to the matcher and are not the same line in the file.
 *
 * An entry matching no live retraction fails the check (exit 2). A
 * suppression for an overlap that is gone is a hole the next one falls into.
 *
 * Empty on purpose. The overlaps this direction was built for were resolved
 * by changing the grant — `Bash(find:*)` dropped, because the skill sends the
 * reviewer to Glob and Grep, and `Bash(git worktree:*)` narrowed to `add` and
 * `list`, because `remove` is not the reviewer's to run (ADR 0099) — rather
 * than by keeping them. The `node -e` and `node --eval` ask rules are not in
 * `.claude/settings.json` (ADR 0106), so an exemption for them would be the
 * stale case.
 */
/** A grant/rule pair a written reason keeps out of direction 3's findings. */
export interface GrantRetractionExemption {
  grant: string;
  rule: string;
  reason: string;
}

export const GRANT_RETRACTION_EXEMPTIONS: GrantRetractionExemption[] = [];

/**
 * A token substituted for `*` when building a command an entry permits.
 * Letters only: it must not be read as an unfixed token, and it must not
 * split on whitespace.
 */
const WITNESS = 'zzwitness';

const concreteCommands = (entry: ToolEntry) => {
  if (entry.kind === 'tool' || entry.tokens.length === 0) return [];
  const concrete = entry.tokens.map((token) => token.replace(/\*/g, WITNESS));
  if (entry.kind === 'exact') return [concrete];
  return [concrete, [...concrete, WITNESS]];
};

/**
 * How an interposed rule takes a grant back, or `null` when no command is in
 * both sets.
 *
 * `wholly` — every witness command the grant permits, the rule matches too.
 * `partly` — at least one command is in both sets, and the grant still
 * permits something the rule does not. The witnesses are the entry's own
 * tokens, with `*` filled in, plus one extra token for a prefix or a glob,
 * which is enough to tell "the same command" from "a narrower form" for the
 * rule shapes this file actually contains. A prefix grant against a rule
 * whose first token is itself a glob also tries the grant's tokens with the
 * rule's pattern appended, because neither entry's own command is in the
 * intersection (`git push` is not `*--force*`, and `*--force*` is not
 * `git push`) while `git push --force` is in both.
 */
export function retractionExtent(
  grant: ToolEntry,
  rule: ToolEntry,
): 'wholly' | 'partly' | null {
  if (grant.kind === 'tool' || rule.kind === 'tool') return null;
  const grantCommands = concreteCommands(grant).filter((command) =>
    matchesEntry(grant, command),
  );
  const candidates = [...grantCommands, ...concreteCommands(rule)];
  if (grant.kind === 'prefix' && rule.tokens[0]?.includes('*')) {
    candidates.push([
      ...grant.tokens,
      ...rule.tokens.map((token) => token.replace(/\*/g, WITNESS)),
    ]);
  }
  const inBoth = (command: string[]) =>
    matchesEntry(grant, command) &&
    matchesEntry(rule, command, { unfixedMatches: false });
  if (!candidates.some(inBoth)) return null;
  if (
    grantCommands.length === 0 ||
    !grantCommands.every((command) =>
      matchesEntry(rule, command, { unfixedMatches: false }),
    )
  )
    return 'partly';
  return 'wholly';
}

/**
 * Compares Bash grants with the interposed rules.
 *
 * Returns `{ ok, retractions, exempted, staleExemptions }`. A retraction is
 * one grant a rule takes back, with `extent` `wholly` or `partly`. An
 * exemption names that pair and is not a retraction; an exemption naming no
 * pair is stale, which the caller treats as "could not run".
 */
export function assertGrantRetractions({
  entries = [],
  interposed = [],
  exemptions = GRANT_RETRACTION_EXEMPTIONS,
}: {
  entries?: ToolEntry[];
  interposed?: ToolEntry[];
  exemptions?: GrantRetractionExemption[];
}) {
  const found: Retraction[] = [];
  for (const grant of entries) {
    if (grant.kind === 'tool') continue;
    for (const rule of interposed) {
      const extent = retractionExtent(grant, rule);
      if (extent) found.push({ grant, rule, extent });
    }
  }

  const used = new Set<GrantRetractionExemption>();
  const retractions: Retraction[] = [];
  const exempted: (Retraction & { exemption: GrantRetractionExemption })[] = [];
  for (const retraction of found) {
    const exemption = exemptions.find(
      (candidate) =>
        candidate.grant === retraction.grant.raw &&
        candidate.rule === retraction.rule.raw,
    );
    if (exemption) {
      used.add(exemption);
      exempted.push({ ...retraction, exemption });
      continue;
    }
    retractions.push(retraction);
  }

  return {
    ok: retractions.length === 0 && used.size === exemptions.length,
    retractions,
    exempted,
    staleExemptions: exemptions.filter((exemption) => !used.has(exemption)),
  };
}

/**
 * The tools whose `Tool(path)` rules Claude Code checks file permissions
 * against. A path rule on any other file tool is accepted and never consulted
 * (https://code.claude.com/docs/en/permissions#read-and-edit).
 */
const CONSULTED_FILE_TOOLS = new Set(['Edit', 'Read']);
const UNCONSULTED_FILE_TOOLS = new Set(['Write', 'NotebookEdit', 'MultiEdit']);

/**
 * Direction 4: the path-scoped file grants that do not hold where they read
 * as holding. `unconsulted` is a path rule on a tool Claude Code never checks
 * a path against; `cwd-relative` is an `Edit`/`Read` path with no `/`, `//`,
 * or `~/` anchor, which moves with the session's current directory.
 */
export function assertFileGrants(entries: ToolEntry[]) {
  const findings: {
    grant: ToolEntry;
    problem: 'unconsulted' | 'cwd-relative';
  }[] = [];
  for (const entry of entries) {
    const scoped = entry.raw.match(/^(\w+)\((.*)\)$/s);
    if (!scoped) continue;
    const [, tool, path] = scoped;
    if (UNCONSULTED_FILE_TOOLS.has(tool))
      findings.push({ grant: entry, problem: 'unconsulted' });
    else if (CONSULTED_FILE_TOOLS.has(tool) && !/^(\/|~\/)/.test(path.trim()))
      findings.push({ grant: entry, problem: 'cwd-relative' });
  }
  return { ok: findings.length === 0, findings };
}

/** One unanchored or unconsulted file grant, as the line a reader acts on. */
export function formatFileGrant({
  grant,
  problem,
}: {
  grant: ToolEntry;
  problem: 'unconsulted' | 'cwd-relative';
}) {
  return problem === 'unconsulted'
    ? `  - ${grant.raw} is never consulted: file permissions are checked against Edit(path) and Read(path) rules only`
    : `  - ${grant.raw} is relative to the session's current directory, which a \`cd\` moves; write the path with a leading \`/\``;
}

/** One grant an interposed rule takes back, and how much of it. */
export interface Retraction {
  grant: ToolEntry;
  rule: ToolEntry;
  extent: 'wholly' | 'partly';
}

/** One retracted grant, as the lines a reader needs to act on it. */
export function formatRetraction({ grant, rule, extent }: Retraction) {
  return [
    `  - ${grant.raw} is ${extent} retracted`,
    `      by: ${rule.raw} in ${SETTINGS} (permissions.${rule.list})`,
  ].join('\n');
}

const main = () => {
  let action: string;
  try {
    action = readFileSync(ACTION, 'utf8');
  } catch (err) {
    die(
      `cannot read ${ACTION}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const entries = parseAllowedTools(action);
  if (entries === null)
    die(
      `${ACTION} has no --allowedTools "..." list; this check cannot tell what the reviewer may run`,
    );
  if (!entries.some((entry) => entry.kind !== 'tool'))
    die(
      `${ACTION}'s --allowedTools list grants no Bash entry at all; that is a rewrite this check has not been taught to read`,
    );

  const unknown = unknownGrantedPrograms(entries);
  if (unknown.length)
    die(
      `${ACTION} grants ${unknown.map((p) => `\`${p}\``).join(', ')}, which this check's ` +
        'program vocabulary does not include, so an instruction to run it would read as prose ' +
        'and never be compared against anything. Add it to PROGRAMS in ' +
        'tools/scripts/check-review-tool-allowlist.ts.',
    );

  let interposed: ToolEntry[] = [];
  try {
    interposed = parseInterposedRules(readFileSync(SETTINGS, 'utf8'));
  } catch (err) {
    // A clone without project settings interposes nothing, and that is a real
    // state rather than a broken one. A file that is there but unreadable is
    // not: it would silence direction 2 while the gate reported OK.
    if ((err as { code?: string }).code !== 'ENOENT')
      die(
        `cannot read ${SETTINGS}: ${err instanceof Error ? err.message : String(err)}`,
      );
  }

  let scripts: Set<string>;
  try {
    scripts = new Set(
      Object.keys(
        JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {},
      ),
    );
  } catch (err) {
    die(
      `cannot read package.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const sites: InstructionSite[] = [];
  for (const file of INSTRUCTION_SOURCES) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      die(
        `cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const found = extractInstructions(text, { file, scripts });
    // A parser that reads nothing passes everything, and both documents have
    // instructed a command since the day they were written.
    if (found.length === 0)
      die(
        `${file} yielded no commands — the document's shape changed and this check stopped seeing anything`,
      );
    sites.push(...found);
  }

  const result = assertToolAllowlist({ entries, sites, interposed });
  const grants = assertGrantRetractions({ entries, interposed });
  const fileGrants = assertFileGrants(entries);
  const bashGrants = entries.filter((entry) => entry.kind !== 'tool');

  if (process.argv.includes('--print')) {
    for (const entry of entries)
      console.log(
        `entry:   ${entry.raw}${entry.kind === 'tool' ? ' (not a command)' : ''}`,
      );
    for (const site of result.permitted)
      console.log(`allowed: ${site.file}:${site.line} ${site.command}`);
    for (const { site, exemption } of result.exempted)
      console.log(
        `exempt:  ${site.file}:${site.line} ${site.command} — ${exemption.reason}`,
      );
    for (const rule of interposed)
      console.log(
        `interposed: ${rule.raw} (permissions.${rule.list})${rule.kind === 'tool' ? ' — not a command' : ''}`,
      );
    for (const retraction of grants.retractions)
      console.log(
        `retracted: ${retraction.extent} ${retraction.grant.raw} by ${retraction.rule.raw} (permissions.${retraction.rule.list})`,
      );
    for (const { grant, rule, exemption } of grants.exempted)
      console.log(
        `exempt-grant: ${grant.raw} / ${rule.raw} — ${exemption.reason}`,
      );
    console.log(
      `direction 3: ${grants.retractions.length} retraction(s), ${grants.exempted.length} exemption(s) across ${bashGrants.length} Bash grant(s)`,
    );
  }

  if (fileGrants.findings.length) {
    console.error(
      `review-allowlist: ${fileGrants.findings.length} file grant(s) in ${ACTION} do not hold where they read as holding\n`,
    );
    for (const finding of fileGrants.findings)
      console.error(formatFileGrant(finding));
    console.error(
      '\nGolden replay run 35716439899 changed into its worktree and was then refused' +
        '\nevery write to its own report under a grant that named the path (issue #880,' +
        '\nADR 0118). A `/path` rule in --allowedTools anchors at the primary working' +
        '\ndirectory; an Edit rule covers the Write tool.',
    );
    process.exit(1);
  }

  if (result.staleExemptions.length) {
    console.error(
      `review-allowlist: ${result.staleExemptions.length} suppression(s) match nothing the documents say:`,
    );
    for (const exemption of result.staleExemptions)
      console.error(`  - \`${exemption.command}\` — "${exemption.reason}"`);
    console.error(
      '\nDrop the entry. A suppression for an instruction nobody gives is a hole the next one falls into.',
    );
    process.exit(2);
  }

  if (grants.staleExemptions.length) {
    console.error(
      `review-allowlist: ${grants.staleExemptions.length} grant exemption(s) match no retraction:`,
    );
    for (const exemption of grants.staleExemptions)
      console.error(
        `  - \`${exemption.grant}\` / \`${exemption.rule}\` — "${exemption.reason}"`,
      );
    console.error(
      '\nDrop the entry. An exemption for an overlap that is not there hides the next one.',
    );
    process.exit(2);
  }

  if (result.intercepted.length) {
    console.error(
      `review-allowlist: ${result.intercepted.length} finding(s) — the reviewer is instructed to run a ` +
        `command ${SETTINGS} intercepts before --allowedTools is ever consulted\n`,
    );
    for (const interception of result.intercepted)
      console.error(formatInterception(interception));
    console.error(
      `\nClaude Code evaluates deny, then ask, then allow, so a rule in ${SETTINGS}` +
        '\noutranks the grant. In a headless CI run there is nobody to answer an `ask`, so it' +
        '\nresolves as a refusal. Stop instructing the command, or give the reviewer a spelling' +
        '\nno interposed rule matches — do not widen --allowedTools, which cannot reach this' +
        '\n(ADR 0099). Golden replay run 46 spent eleven turns being refused one instructed' +
        '\n`git worktree remove` this way, under a grant that named it.',
    );
    process.exit(1);
  }

  if (result.findings.length) {
    console.error(
      `review-allowlist: ${result.findings.length} finding(s) — the reviewer is instructed to run a command its tool allowlist refuses\n`,
    );
    for (const finding of result.findings)
      console.error(formatFinding(finding));
    console.error(
      `\nEither widen the --allowedTools list in ${ACTION}, or stop instructing the` +
        '\nreviewer to run it. A refused command is not free: run 45 spent 26 permission' +
        '\ndenials of an 81-turn budget and wrote no report at all, so the guard case it' +
        '\nwas measuring scored nothing.',
    );
    process.exit(1);
  }

  if (grants.retractions.length) {
    console.error(
      `review-allowlist: ${grants.retractions.length} finding(s) — an --allowedTools Bash grant is retracted by a rule in ${SETTINGS}\n`,
    );
    for (const retraction of grants.retractions)
      console.error(formatRetraction(retraction));
    console.error(
      `\nClaude Code evaluates deny, then ask, then allow, so the rule outranks the grant, and in a` +
        '\nheadless run an `ask` is a refusal (ADR 0099). Direction 2 does not see this: it only' +
        '\ncompares commands a document instructs. Drop the grant, narrow it to a form no rule' +
        '\nmatches, or exempt the pair with a written reason in GRANT_RETRACTION_EXEMPTIONS.',
    );
    process.exit(1);
  }

  console.log(
    `review-allowlist: OK — ${result.permitted.length} instructed command(s) across ` +
      `${INSTRUCTION_SOURCES.length} documents are permitted by ${ACTION} ` +
      `and intercepted by none of ${SETTINGS}'s ${interposed.length} ask/deny rule(s) ` +
      `(${result.exempted.length} site(s) suppressed by written reason); ` +
      `${bashGrants.length} Bash grant(s), none retracted ` +
      `(${grants.exempted.length} exempted); every file grant anchored`,
  );
};

// Behind an isMain guard because the contract tests import the matcher from
// this file. Run at load, `main` exits the process the moment the documents
// and the allowlist disagree — so the tests would die before the first one
// ran, and precisely while the gate was doing its job.
if (isMain(import.meta.url)) main();
