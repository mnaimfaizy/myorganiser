/**
 * What a reviewer transcript says about the run that produced a report
 * (issue #1031, ADR 0123).
 *
 * A report used to state these facts about itself: which standards documents
 * the review was held to, which commands it ran, how long it took, which
 * model ran it. Each was written by the model being described, and CI run
 * 37576528356 listed four standards sources having opened none. They are
 * read here instead, from the transcript `anthropics/claude-code-action`
 * leaves behind, after the reviewer has exited.
 *
 * This module reads and reports. It fails nothing and tightens nothing: what
 * a fact costs is decided in `run-ladder.ts`, from the facts file.
 *
 * The transcript's shape belongs to the Claude Code CLI, which this
 * repository does not version. So "cannot tell" is its own answer: a
 * transcript that does not look the way this reader expects is `unknown`,
 * never an empty list. Read naively, a CLI release that renamed one field
 * would report "no sub-agent read its brief" on every pull request.
 */
import { simpleCommands, tokenize } from '../lib/shell-command.ts';
import { BRIEFS, axisNamedBy, isOnTemplate } from './briefs.ts';
import type { Cost, RunFacts } from './schema.ts';

/** A tool_use or tool_result block, as the transcript carries it. */
export type ToolCall = Record<string, unknown>;

/** An event of the transcript, as much of one as this reader looks at. */
interface TranscriptEvent extends Record<string, unknown> {
  message?: { content?: unknown } | undefined;
}

/** One axis's facts, as this reader builds them up. */
interface AxisEntry {
  dispatched: boolean;
  briefRead: boolean;
  onTemplate: boolean | null;
  replyIsJson: boolean | null;
  toolCalls: number;
  opened: string[];
  diffed: string[];
}

/**
 * The facts, keyed by axis as `BRIEFS` keys them. `RunFactsSchema` is what
 * pins those keys to exactly the two axes; this reader derives them from the
 * brief table rather than naming them again.
 */
export type TranscriptFacts = Omit<RunFacts, 'axes'> & {
  axes: Record<string, AxisEntry> | null;
};

/** The facts a transcript gives up even when its shape is unreadable. */
interface KnownFacts {
  cliVersion: string | null;
  models: string[] | null;
  durationMs: number | null;
  cost: Cost | null;
}

export const RUN_FACTS_SCHEMA_VERSION = 1;

/** The index every standards document is reached from. */
export const STANDARDS_INDEX = 'CODING_STANDARDS.md';

/**
 * Linked from the index and deliberately not a standards source: its entries
 * reach the review as an obligation worklist (the Standards brief says so).
 */
export const NOT_A_STANDARDS_SOURCE = Object.freeze([
  'docs/review/REVIEW_CHECKLIST.md',
]);

/** The tool names a sub-agent dispatch has gone by across CLI versions. */
const DISPATCH_TOOLS: Set<unknown> = new Set(['Agent', 'Task']);

// From CLI 2.1.301 a sub-agent can end by calling this tool with its report
// as `message`. The dispatch's own tool_result then holds only a pointer to
// that call, so the report is read from the call (run 38809002623).
const HANDBACK_TOOL = 'SubagentHandback';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/**
 * A path as the repository spells it, or `null` when it is not inside the
 * workspace. `cwd` is the workspace root the transcript's init event names.
 */
export const toRepoPath = (
  path: unknown,
  cwd: string | undefined,
): string | null => {
  if (typeof path !== 'string' || !path) return null;
  let p = path.replaceAll('\\', '/');
  const root = (cwd ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
  if (p.startsWith('/')) {
    if (!root || !p.startsWith(`${root}/`)) return null;
    p = p.slice(root.length + 1);
  }
  const parts: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
};

/**
 * The files one tool call returned the content of, by path.
 *
 * Opened means the call returns a file's content: the Read tool at any range,
 * `cat`, or `git show <rev>:<path>`. A search, a listing, a count, or the
 * first lines of a file is not an open — a grep hit proves a line matched,
 * not that a rule was read, and crediting it would credit `AGENTS.md` to
 * every run that searched the tree. A partial Read does count: nothing here
 * can judge how much was enough, and it does not pretend to.
 *
 * @param call a tool_use block
 * @param cwd the workspace root
 * @returns repo-relative paths, in order
 */
export const filesOpenedBy = (call: ToolCall, cwd: string): string[] => {
  const input = isObject(call?.input) ? call.input : {};
  if (call?.name === 'Read') {
    const path = toRepoPath(input.file_path, cwd);
    return path ? [path] : [];
  }
  if (call?.name !== 'Bash' || typeof input.command !== 'string') return [];
  const opened: string[] = [];
  for (const simple of simpleCommands(input.command)) {
    const [program, ...args] = tokenize(simple);
    if (program === 'cat') {
      for (const arg of args) {
        if (arg.startsWith('-')) continue;
        const path = toRepoPath(arg, cwd);
        if (path) opened.push(path);
      }
    } else if (program === 'git' && args[0] === 'show') {
      for (const arg of args.slice(1)) {
        if (arg.startsWith('-')) continue;
        const colon = arg.indexOf(':');
        if (colon <= 0) continue;
        // `HEAD:"a b.md"` reaches here with its quotes: the tokenizer keeps
        // a quote that does not open the token.
        const path = toRepoPath(
          arg.slice(colon + 1).replace(/^(["'])(.*)\1$/, '$2'),
          cwd,
        );
        if (path) opened.push(path);
      }
    }
  }
  return opened;
};

/**
 * A test for "is this path a standards document", built from the index's own
 * text. A standards document is the index, a path the index links to — a
 * directory link covers everything under it — or an `AGENTS.md` at any depth.
 *
 * Built from the index rather than from a list here, so a document the index
 * does not name is never credited: that is the claim the index makes about
 * itself. With no index to read, only the index and Agent Guides qualify.
 *
 * @param indexText `CODING_STANDARDS.md`, verbatim, or null
 */
export const standardsDocumentTest = (
  indexText: string | null | undefined,
): ((path: unknown) => boolean) => {
  const files = new Set([STANDARDS_INDEX]);
  const directories: string[] = [];
  if (typeof indexText === 'string') {
    for (const match of indexText.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const path = toRepoPath(target, '');
      if (!path) continue;
      if (target.endsWith('/')) directories.push(`${path}/`);
      else files.add(path);
    }
  }
  const excluded: Set<unknown> = new Set(NOT_A_STANDARDS_SOURCE);
  return (path: unknown) => {
    if (typeof path !== 'string' || excluded.has(path)) return false;
    if (files.has(path)) return true;
    if (path === 'AGENTS.md' || path.endsWith('/AGENTS.md')) return true;
    return directories.some((dir) => path.startsWith(dir));
  };
};

const unknownFacts = (
  reason: string,
  known: Partial<KnownFacts> = {},
): TranscriptFacts => ({
  schemaVersion: RUN_FACTS_SCHEMA_VERSION,
  shape: 'unknown',
  shapeReason: reason,
  cliVersion: known.cliVersion ?? null,
  models: known.models ?? null,
  durationMs: known.durationMs ?? null,
  cost: known.cost ?? null,
  dispatches: null,
  axes: null,
  standardsSources: null,
  indexOpened: null,
  executed: null,
  executions: null,
  unattributedDispatches: null,
  repliesParsed: null,
  returned: null,
});

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * The session's token figures, summed over every model the `result` event
 * lists under `modelUsage` (issue #1057).
 *
 * `modelUsage` and not the event's top-level `usage`: `usage` counts the main
 * agent's turns alone, and most of a review is spent in its two sub-agents.
 * Run 37726720012 reported 1,364 output tokens under `usage` and 2,851 under
 * `modelUsage`.
 *
 * Input is everything the models were sent: fresh input, cache reads, and
 * cache writes. The fresh figure alone is what is left after caching, which
 * on that run was 28 tokens of some 644,000.
 *
 * `null` when any model's entry lacks a figure. A partial sum would read as
 * a smaller spend, and a missing figure is not zero.
 */
const costFrom = (modelUsage: unknown): Cost | null => {
  if (!isObject(modelUsage)) return null;
  const entries = Object.values(modelUsage);
  if (entries.length === 0) return null;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const usage of entries) {
    if (
      !isObject(usage) ||
      !isCount(usage.inputTokens) ||
      !isCount(usage.cacheReadInputTokens) ||
      !isCount(usage.cacheCreationInputTokens) ||
      !isCount(usage.outputTokens)
    )
      return null;
    inputTokens +=
      usage.inputTokens +
      usage.cacheReadInputTokens +
      usage.cacheCreationInputTokens;
    outputTokens += usage.outputTokens;
  }
  return { inputTokens, outputTokens };
};

const emptyAxis = (): AxisEntry => ({
  dispatched: false,
  briefRead: false,
  onTemplate: null,
  replyIsJson: null,
  toolCalls: 0,
  opened: [],
  diffed: [],
});

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map((part) => (isObject(part) ? String(part.text ?? '') : ''))
          .join('')
      : '';

/**
 * The exit code a Bash call's result carries, or `null` when it carries none
 * (issue #1039).
 *
 * The CLI marks a failed call's result `is_error` and opens its text with
 * `Exit code <n>`. A result that is not an error exited 0. An error that
 * does not open that way is a call that never exited, such as a timeout, and
 * has no code. Only the opening line is read: a test run
 * prints what it likes further down.
 *
 * @param result a tool_result block
 */
const exitCodeOf = (result: unknown): number | null => {
  if (!isObject(result)) return null;
  if (result.is_error !== true) return 0;
  const opening = /^Exit code (\d+)\b/.exec(textOf(result.content));
  return opening ? Number(opening[1]) : null;
};

/**
 * A sub-agent's own message, with the harness's wrapping taken off.
 *
 * The harness wraps a reply before the main agent sees it: a framing line
 * ahead of it, every line indented, and an `agentId:` trailer with usage
 * figures after it. Those are the harness's, not the sub-agent's.
 *
 * From CLI 2.1.312 the frame can itself come after harness notes — a
 * `<tools-used-before-summary>…</tools-used-before-summary>` line and a blank
 * one (run 40612259601) — so those are skipped before the frame is looked for.
 */
const HARNESS_NOTE = /^\s*(?:<([a-z][a-z-]*)>[^\n]*<\/\1>)?\s*$/;

const replyText = (content: unknown): string => {
  const lines = textOf(content).split('\n');
  while (lines.length > 0 && HARNESS_NOTE.test(lines[0])) lines.shift();
  if (lines[0]?.startsWith('[Subagent hand-back]')) lines.shift();
  let text = lines.join('\n');
  const trailer = text.search(/^agentId:/m);
  if (trailer !== -1) text = text.slice(0, trailer);
  return text
    .split('\n')
    .map((line) => line.replace(/^ {2}/, ''))
    .join('\n')
    .trim();
};

const parseObject = (text: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(text);
    return isObject(value) && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Whether a sub-agent's reply is one JSON object and nothing else.
 *
 * A code fence around the object, or a sentence after it, makes it not a
 * bare object — which is what the briefs ask for.
 *
 * @param content a tool_result block's content
 */
export const replyIsBareJson = (content: unknown): boolean => {
  const text = replyText(content);
  return text.startsWith('{') && parseObject(text) !== null;
};

/**
 * The findings a sub-agent's reply returned, or `null` when they cannot be
 * read out of it.
 *
 * Read more generously than `replyIsBareJson` judges: a reply that fenced its
 * object, or added a sentence after it, broke the brief and still says
 * plainly what it returned (run 37707518833 did both). What is read is the
 * text from the first `{` to the last `}`. A reply with no object there, or
 * with one whose `findings` is not a list of objects, returned nothing this
 * reader can compare a reported finding with — which is "cannot tell", not
 * "returned none".
 *
 * @param content a tool_result block's content
 */
export const findingsReturnedBy = (
  content: unknown,
): Record<string, unknown>[] | null => {
  const text = replyText(content);
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open === -1 || close < open) return null;
  const reply = parseObject(text.slice(open, close + 1));
  if (!reply || !Array.isArray(reply.findings)) return null;
  const findings: unknown[] = reply.findings;
  return findings.every((f) => isObject(f) && !Array.isArray(f))
    ? (findings as Record<string, unknown>[])
    : null;
};

/**
 * The files one tool call diffed by name: a `git diff` that lists paths after
 * `--` returns those files' hunks. A diff naming no path, or one asking only for
 * names or counts (`--stat`, `--name-only`), is not credited to any file: the
 * reader cannot tell from the call whether a whole-range diff came back whole
 * (issue #1140).
 *
 * @param call a tool_use block
 * @param cwd the workspace root
 * @returns repo-relative paths, in order
 */
export const filesDiffedBy = (call: ToolCall, cwd: string): string[] => {
  const input = isObject(call?.input) ? call.input : {};
  const command = call?.name === 'Bash' ? input.command : undefined;
  if (typeof command !== 'string') return [];
  const diffed: string[] = [];
  for (const simple of simpleCommands(command)) {
    const [program, sub, ...args] = tokenize(simple);
    if (program !== 'git' || sub !== 'diff') continue;
    const dashes = args.indexOf('--');
    if (dashes === -1) continue;
    if (args.slice(0, dashes).some((a) => NAMES_ONLY.test(a))) continue;
    for (const arg of args.slice(dashes + 1)) {
      const path = toRepoPath(arg, cwd);
      if (path) diffed.push(path);
    }
  }
  return diffed;
};

const NAMES_ONLY =
  /^--(?:stat|numstat|shortstat|name-only|name-status|summary|dirstat)\b/;

/**
 * Read a transcript.
 *
 * @param text the execution file's contents
 * @param options `CODING_STANDARDS.md` at the reviewed head, verbatim
 * @returns the run facts; see `RunFactsSchema` in schema.ts
 */
export const readTranscriptFacts = (
  text: string,
  { index = null }: { index?: string | null } = {},
): TranscriptFacts => {
  let events: unknown;
  try {
    events = JSON.parse(text);
  } catch {
    events = null;
  }
  if (!Array.isArray(events))
    return unknownFacts('the transcript is not a JSON array of events');

  const objects = events.filter(isObject) as TranscriptEvent[];
  const init = objects.find((e) => e.type === 'system' && e.subtype === 'init');
  const result = objects.findLast((e) => e.type === 'result');
  const known: KnownFacts = {
    cliVersion:
      typeof init?.claude_code_version === 'string'
        ? init.claude_code_version
        : null,
    models: isObject(result?.modelUsage)
      ? Object.keys(result.modelUsage).sort()
      : null,
    durationMs:
      typeof result?.duration_ms === 'number' &&
      Number.isFinite(result.duration_ms)
        ? Math.round(result.duration_ms)
        : null,
    cost: costFrom(result?.modelUsage),
  };
  if (!init || typeof init.cwd !== 'string')
    return unknownFacts(
      'the transcript has no init event naming a workspace',
      known,
    );
  const cwd = init.cwd;
  if (!result) return unknownFacts('the transcript has no result event', known);
  if (known.durationMs === null || !known.models?.length)
    return unknownFacts(
      'the result event carries no duration or no model usage',
      known,
    );

  // Every tool call, under the dispatch that made it (or under null, for the
  // main agent's own).
  const dispatches = new Map<unknown, { prompt: unknown }>();
  const childCalls = new Map<unknown, ToolCall[]>();
  const mainCalls: ToolCall[] = [];
  for (const event of objects) {
    if (event.type !== 'assistant') continue;
    const parent = event.parent_tool_use_id ?? null;
    const blocks: unknown[] = Array.isArray(event.message?.content)
      ? event.message.content
      : [];
    for (const block of blocks) {
      if (!isObject(block) || block.type !== 'tool_use') continue;
      if (parent === null) {
        if (DISPATCH_TOOLS.has(block.name) && typeof block.id === 'string')
          dispatches.set(block.id, {
            prompt: isObject(block.input) ? block.input.prompt : undefined,
          });
        else mainCalls.push(block);
        continue;
      }
      if (!childCalls.has(parent)) childCalls.set(parent, []);
      childCalls.get(parent)!.push(block);
    }
  }

  // What each dispatch returned to the main agent, and what every tool call
  // returned to whichever agent made it.
  const replies = new Map<unknown, unknown>();
  const results = new Map<unknown, ToolCall>();
  for (const event of objects) {
    if (event.type !== 'user') continue;
    const blocks: unknown[] = Array.isArray(event.message?.content)
      ? event.message.content
      : [];
    for (const block of blocks) {
      if (!isObject(block) || block.type !== 'tool_result') continue;
      results.set(block.tool_use_id, block);
      if (
        (event.parent_tool_use_id ?? null) === null &&
        dispatches.has(block.tool_use_id)
      )
        replies.set(block.tool_use_id, block.content);
    }
  }
  // A hand-back call is the sub-agent's report itself, so it replaces the
  // pointer the dispatch returned. The last one wins, as a retry's would.
  for (const id of dispatches.keys()) {
    let handback: string | undefined;
    for (const call of childCalls.get(id) ?? []) {
      const input = isObject(call.input) ? call.input : {};
      if (call.name === HANDBACK_TOOL && typeof input.message === 'string')
        handback = input.message;
    }
    if (handback !== undefined) replies.set(id, handback);
  }

  const attributed = [...dispatches.keys()].filter((id) => childCalls.has(id));
  if (dispatches.size > 0 && attributed.length === 0)
    return unknownFacts(
      `the transcript has ${dispatches.size} sub-agent dispatch(es) and no sub-agent event is attributed to any of them`,
      known,
    );

  const axes: Record<string, AxisEntry> = Object.fromEntries(
    Object.keys(BRIEFS).map((axis) => [axis, emptyAxis()]),
  );
  const standardsOpened: string[] = [];
  let unattributedDispatches = 0;
  const executed: string[] = [];
  const seenCommands = new Set<string>();
  // Every Bash call and not each distinct command: the same command run
  // twice may have exited differently.
  const executions: NonNullable<RunFacts['executions']> = [];
  // A call the harness refused is in the transcript and did not run.
  const denials: unknown[] = Array.isArray(result.permission_denials)
    ? result.permission_denials
    : [];
  const refused: Set<unknown> = new Set(
    denials
      .map((denial) => (isObject(denial) ? denial.tool_use_id : undefined))
      .filter((id) => typeof id === 'string'),
  );
  const record = (call: ToolCall, by: 'main' | 'sub-agent'): void => {
    const input = isObject(call.input) ? call.input : {};
    if (call.name !== 'Bash' || typeof input.command !== 'string') return;
    if (refused.has(call.id)) return;
    executions.push({
      command: input.command,
      // A backgrounded call's result is that it started, not how it ended.
      exitCode:
        input.run_in_background === true ||
        /(?:^|[^&])&\s*$/.test(input.command)
          ? null
          : exitCodeOf(results.get(call.id)),
      by,
    });
  };
  for (const call of mainCalls) record(call, 'main');

  // What the sub-agents returned, from every dispatch whether or not it was
  // attributed to an axis: a paraphrased dispatch names no brief, and its
  // sub-agent's findings were returned all the same. A retry is a second
  // reply, and a finding from either is one a sub-agent returned.
  const returned: Record<string, unknown>[] = [];
  let repliesParsed: boolean | null = null;
  for (const id of dispatches.keys()) {
    if (!replies.has(id)) continue;
    const findings = findingsReturnedBy(replies.get(id));
    repliesParsed = (repliesParsed ?? true) && findings !== null;
    if (findings) returned.push(...findings);
  }

  for (const [id, dispatch] of dispatches) {
    const calls = childCalls.get(id) ?? [];
    for (const call of calls) {
      record(call, 'sub-agent');
      const input = isObject(call.input) ? call.input : {};
      const command = call.name === 'Bash' ? input.command : undefined;
      if (typeof command === 'string' && !seenCommands.has(command)) {
        seenCommands.add(command);
        executed.push(command);
      }
    }
    const openedHere = calls.flatMap((call) => filesOpenedBy(call, cwd));
    // An axis is the one whose brief the sub-agent read first: a Spec
    // sub-agent reviewing a change to the skill opens the Standards brief too
    // (run 37707518833), and that does not make it the Standards axis.
    // Failing any brief, it is the one the dispatch named — which is how an
    // axis whose sub-agent never read its brief is still an axis that was
    // dispatched.
    const firstBrief = openedHere.find((path) =>
      Object.values(BRIEFS).includes(path),
    );
    const read = Object.keys(BRIEFS).find(
      (axis) => BRIEFS[axis] === firstBrief,
    );
    const axis = read ?? axisNamedBy(dispatch.prompt);
    if (!axis) {
      // Neither axis's: it read no brief and its message named none. It is
      // counted, because its reply's findings are still returned findings,
      // and a dispatch the skill has no template for is not on the template.
      unattributedDispatches += 1;
      continue;
    }
    const entry = axes[axis];
    entry.dispatched = true;
    entry.briefRead = entry.briefRead || Boolean(read);
    // Every dispatch of an axis must be on template: a retry is a second one.
    const onTemplate = isOnTemplate(axis, dispatch.prompt);
    entry.onTemplate =
      entry.onTemplate === null ? onTemplate : entry.onTemplate && onTemplate;
    // Every reply of an axis must be a bare object; a dispatch with no reply
    // in the transcript says nothing either way.
    if (replies.has(id)) {
      const bare = replyIsBareJson(replies.get(id));
      entry.replyIsJson =
        entry.replyIsJson === null ? bare : entry.replyIsJson && bare;
    }
    entry.toolCalls += calls.length;
    for (const path of openedHere)
      if (!entry.opened.includes(path)) entry.opened.push(path);
    for (const path of calls.flatMap((call) => filesDiffedBy(call, cwd)))
      if (!entry.diffed.includes(path)) entry.diffed.push(path);
    if (axis === 'standards') standardsOpened.push(...openedHere);
  }

  const isStandard = standardsDocumentTest(index);
  const standardsSources = [...new Set(standardsOpened.filter(isStandard))];

  return {
    schemaVersion: RUN_FACTS_SCHEMA_VERSION,
    shape: 'readable',
    shapeReason: null,
    ...known,
    dispatches: dispatches.size,
    axes,
    standardsSources,
    indexOpened: standardsOpened.includes(STANDARDS_INDEX),
    executed,
    executions,
    unattributedDispatches,
    repliesParsed,
    returned,
  };
};
