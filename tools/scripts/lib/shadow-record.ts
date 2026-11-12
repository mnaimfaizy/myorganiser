/**
 * The shadow record report's judgments (PRD #1523, issue #1528, ADR 0148
 * decisions 5 and 6). Pure over a `ShadowGather`; the script beside it in
 * `tools/scripts/ci/measure-shadow-record.ts` reads GitHub and assembles one.
 *
 * A measure, not a gate (ADR 0043): its subject is weeks of the Merge Train's
 * shadow comments and what the Maintainer then did with each Pull Request, so
 * no threshold a commit could cross fails here. It answers one question: has
 * Auto-merge earned `on`?
 *
 * The exit criterion, measured: at least `MIN_DECISIONS` "would auto-merge"
 * decisions over at least `MIN_SPAN_DAYS`, every one merged by the Maintainer
 * with no commit written on the branch after the decided head, and none
 * reverted or needing a follow-up fix within `BAD_WITHIN_DAYS` of its merge.
 * "No held reason was a misread" is a person's reading and is not measured;
 * the report lists the held reasons so it can be made.
 *
 * What the shadow comment keeps: the train edits ONE comment per candidate in
 * place, so a Pull Request has one decision, the latest, stamped with the
 * comment's last edit. An earlier decision on an older head is not kept.
 */
import {
  SHADOW_COMMENT_LEAD,
  SHADOW_COMMENT_MARKER,
  SHADOW_HELD,
  SHADOW_WOULD_MERGE,
  type AutoMergeMode,
} from './merge-train.ts';

/** ADR 0148 decision 5: the least decisions that can earn `on`. */
export const MIN_DECISIONS = 20;
/** ADR 0148 decision 5: the least span, in days, they must cover. */
export const MIN_SPAN_DAYS = 14;
/** ADR 0148 decisions 5 and 6: a revert or fix this soon after the merge is bad. */
export const BAD_WITHIN_DAYS = 7;
/** The window the script reads when no `--days` is given: room for a fortnight of span. */
export const DEFAULT_WINDOW_DAYS = 90;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The shadow comment on a candidate, as the issue-comments API returns it. */
export interface GatheredShadowComment {
  author: string | null;
  /** Last edit, since the train rewrites the comment in place. */
  updatedAt: string;
  body: string;
}

/** One commit of a Pull Request's branch, in the order the API lists them. */
export interface GatheredBranchCommit {
  oid: string;
  /** More than one parent: a merge of `main` into the branch. */
  isMerge: boolean;
}

/** A Pull Request that carries a shadow comment. */
export interface GatheredPullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  mergedAt: string | null;
  comment: GatheredShadowComment;
  /** `null` when the branch's commits could not be read. */
  commits: GatheredBranchCommit[] | null;
}

/** A merged Pull Request, read to find reverts and follow-up fixes. */
export interface GatheredMerge {
  number: number;
  title: string;
  body: string;
  mergedAt: string;
  /** Every commit message (headline and body) of the branch. */
  commitMessages: string[];
}

export interface ShadowGather {
  /** The instant the report is made as of; seven-day watches end against it. */
  asOf: string;
  window: { since: string; until: string };
  /** The mode setting at the time of the read. */
  mode: AutoMergeMode;
  /**
   * Logins whose shadow comments count. The marker is public text any
   * commenter can post, and a forged "would auto-merge" on a Pull Request that
   * is then merged unchanged would count toward the record, so a comment by
   * anyone else is set aside. The train comments as the Maintainer's `gh`
   * login (ADR 0148 decision 2).
   */
  trustedAuthors: string[];
  /** What could and could not be read, printed with the report. */
  evidence: Record<string, string>;
  pullRequests: GatheredPullRequest[];
  merges: GatheredMerge[];
}

export type ShadowDecision =
  | { kind: 'would-merge'; head: string }
  | { kind: 'held'; reason: string };

/**
 * The decision a shadow comment body states, or `null` when the body is not
 * the train's comment or its decision line cannot be read.
 */
export function parseShadowComment(body: string): ShadowDecision | null {
  if (!body.includes(SHADOW_COMMENT_MARKER)) return null;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith(SHADOW_COMMENT_LEAD)) continue;
    const rest = line.slice(SHADOW_COMMENT_LEAD.length).trim();
    if (rest.startsWith(SHADOW_WOULD_MERGE)) {
      const head = /`([0-9a-f]{7,40})`/i.exec(rest)?.[1];
      return head ? { kind: 'would-merge', head } : null;
    }
    if (rest.startsWith(SHADOW_HELD)) {
      const reason = rest.slice(SHADOW_HELD.length).trim();
      return reason ? { kind: 'held', reason } : null;
    }
    return null;
  }
  return null;
}

/** Pull Requests a title or body says it reverts. */
export function revertedPullRequests(title: string, body: string): number[] {
  if (!/^revert\b/i.test(title.trim())) return [];
  const numbers = new Set<number>();
  for (const match of `${title}\n${body}`.matchAll(/#(\d+)\b/g)) {
    numbers.add(Number(match[1]));
  }
  return [...numbers];
}

/** Pull Requests commit messages name as what introduced the defect (ADR 0100). */
export function introducedInPullRequests(
  messages: readonly string[],
): number[] {
  const numbers = new Set<number>();
  for (const message of messages) {
    for (const match of message.matchAll(/Introduced in #(\d+)\b/gi)) {
      numbers.add(Number(match[1]));
    }
  }
  return [...numbers];
}

/** What became of a would-merge decision. */
export type DecisionOutcome =
  | 'merged-unchanged'
  | 'merged-changed'
  | 'merged-unverifiable'
  | 'open'
  | 'closed-unmerged';

export type BadKind = 'reverted' | 'fixed';

export interface ClassifiedDecision {
  number: number;
  title: string;
  head: string;
  decidedAt: number;
  mergedAt: number | null;
  outcome: DecisionOutcome;
  /** Why a merge was not unchanged, when it was not. */
  detail: string | null;
  bad: { kind: BadKind; by: number; at: number } | null;
  /** Merged, unchanged, not bad, and its seven days have not yet passed. */
  watching: boolean;
}

/**
 * Whether the Maintainer merged `commits` unchanged from `head`: no commit
 * written on the branch after the decided head. A merge of `main` into the
 * branch (more than one parent) is not a change; the train's own update is one.
 */
export function mergedUnchanged(
  commits: readonly GatheredBranchCommit[] | null,
  head: string,
): { unchanged: boolean; detail: string | null; verifiable: boolean } {
  if (commits === null) {
    return {
      unchanged: false,
      verifiable: false,
      detail: 'the branch commits could not be read',
    };
  }
  const index = commits.findIndex(
    (commit) => commit.oid === head || commit.oid.startsWith(head),
  );
  if (index === -1) {
    return {
      unchanged: false,
      verifiable: true,
      detail: `the decided head ${head.slice(0, 7)} is not on the branch`,
    };
  }
  const after = commits.slice(index + 1).filter((commit) => !commit.isMerge);
  return after.length === 0
    ? { unchanged: true, verifiable: true, detail: null }
    : {
        unchanged: false,
        verifiable: true,
        detail: `${after.length} commit(s) written after the decided head`,
      };
}

const parseTime = (iso: string): number | null => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
};

/** The earliest revert or follow-up fix of `number` merged within seven days. */
function badWithinWindow(
  number: number,
  mergedAt: number,
  merges: readonly GatheredMerge[],
): ClassifiedDecision['bad'] {
  let found: ClassifiedDecision['bad'] = null;
  for (const merge of merges) {
    if (merge.number === number) continue;
    const at = parseTime(merge.mergedAt);
    if (
      at === null ||
      at <= mergedAt ||
      at > mergedAt + BAD_WITHIN_DAYS * DAY_MS
    )
      continue;
    const kind: BadKind | null = revertedPullRequests(
      merge.title,
      merge.body,
    ).includes(number)
      ? 'reverted'
      : introducedInPullRequests(merge.commitMessages).includes(number)
        ? 'fixed'
        : null;
    if (kind && (found === null || at < found.at)) {
      found = { kind, by: merge.number, at };
    }
  }
  return found;
}

export interface ShadowSummary {
  asOf: string;
  window: { since: string; until: string };
  mode: AutoMergeMode;
  evidence: Record<string, string>;
  /** Every "would auto-merge" decision in the window. */
  decisions: ClassifiedDecision[];
  /** The decisions the record counts: those after the last bad Auto-merge. */
  counted: ClassifiedDecision[];
  held: { total: number; byReason: { reason: string; count: number }[] };
  unreadableComments: number;
  /** Shadow comments set aside because their author is not trusted. */
  untrustedComments: number;
  bad: ClassifiedDecision[];
  /** When the count restarts, after a bad Auto-merge; `null` when none was found. */
  restartAt: string | null;
  spanDays: number;
  firstDecisionAt: string | null;
  lastDecisionAt: string | null;
  mergedUnchanged: number;
  verdict: 'met' | 'not-met' | 'reset';
  /** Each measured part of the criterion that does not hold. */
  unmet: string[];
  /** True when a bad Auto-merge was found while the setting is `on`. */
  returnToShadow: boolean;
}

/** Judge a gathered window against ADR 0148 decisions 5 and 6. */
export function summarizeShadowRecord(gather: ShadowGather): ShadowSummary {
  const asOf = parseTime(gather.asOf) ?? Date.now();
  const decisions: ClassifiedDecision[] = [];
  const heldReasons = new Map<string, number>();
  let heldTotal = 0;
  let unreadableComments = 0;
  let untrustedComments = 0;

  for (const pr of gather.pullRequests) {
    if (
      pr.comment.author === null ||
      !gather.trustedAuthors.includes(pr.comment.author)
    ) {
      untrustedComments += 1;
      continue;
    }
    const parsed = parseShadowComment(pr.comment.body);
    const decidedAt = parseTime(pr.comment.updatedAt);
    if (parsed === null || decidedAt === null) {
      unreadableComments += 1;
      continue;
    }
    if (parsed.kind === 'held') {
      heldTotal += 1;
      heldReasons.set(parsed.reason, (heldReasons.get(parsed.reason) ?? 0) + 1);
      continue;
    }
    const mergedAt =
      pr.state === 'merged' && pr.mergedAt ? parseTime(pr.mergedAt) : null;
    let outcome: DecisionOutcome;
    let detail: string | null = null;
    if (pr.state === 'merged' && mergedAt === null) {
      outcome = 'merged-unverifiable';
      detail = 'the merge time could not be read';
    } else if (pr.state === 'merged' && mergedAt !== null) {
      const result = mergedUnchanged(pr.commits, parsed.head);
      outcome = result.unchanged
        ? 'merged-unchanged'
        : result.verifiable
          ? 'merged-changed'
          : 'merged-unverifiable';
      detail = result.detail;
    } else if (pr.state === 'open') {
      outcome = 'open';
    } else {
      outcome = 'closed-unmerged';
    }
    const bad =
      mergedAt === null
        ? null
        : badWithinWindow(pr.number, mergedAt, gather.merges);
    decisions.push({
      number: pr.number,
      title: pr.title,
      head: parsed.head,
      decidedAt,
      mergedAt,
      outcome,
      detail,
      bad,
      watching:
        outcome === 'merged-unchanged' &&
        bad === null &&
        mergedAt !== null &&
        asOf < mergedAt + BAD_WITHIN_DAYS * DAY_MS,
    });
  }
  decisions.sort((a, b) => a.decidedAt - b.decidedAt || a.number - b.number);

  const bad = decisions.filter((d) => d.bad !== null);
  const restart = bad.reduce<number | null>(
    (latest, d) => (latest === null || d.bad!.at > latest ? d.bad!.at : latest),
    null,
  );
  const counted =
    restart === null
      ? decisions
      : decisions.filter((d) => d.decidedAt > restart);

  const first = counted[0]?.decidedAt ?? null;
  const last = counted.length ? counted[counted.length - 1].decidedAt : null;
  const spanDays =
    first !== null && last !== null ? (last - first) / DAY_MS : 0;
  const unchanged = counted.filter(
    (d) => d.outcome === 'merged-unchanged',
  ).length;

  const unmet: string[] = [];
  if (counted.length < MIN_DECISIONS) {
    unmet.push(`${counted.length} of ${MIN_DECISIONS} decisions`);
  }
  if (spanDays < MIN_SPAN_DAYS) {
    unmet.push(`span ${spanDays.toFixed(1)} of ${MIN_SPAN_DAYS} days`);
  }
  const notMerged = counted.filter((d) => d.outcome !== 'merged-unchanged');
  if (notMerged.length > 0) {
    unmet.push(
      `${notMerged.length} not merged unchanged (${notMerged.map((d) => `#${d.number} ${d.outcome}`).join(', ')})`,
    );
  }
  const watching = counted.filter((d) => d.watching);
  if (watching.length > 0) {
    unmet.push(
      `${watching.length} still inside the ${BAD_WITHIN_DAYS}-day watch (${watching.map((d) => `#${d.number}`).join(', ')})`,
    );
  }

  const met = unmet.length === 0;
  return {
    asOf: gather.asOf,
    window: gather.window,
    mode: gather.mode,
    evidence: gather.evidence,
    decisions,
    counted,
    held: {
      total: heldTotal,
      byReason: [...heldReasons]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    },
    unreadableComments,
    untrustedComments,
    bad,
    restartAt: restart === null ? null : new Date(restart).toISOString(),
    spanDays,
    firstDecisionAt: first === null ? null : new Date(first).toISOString(),
    lastDecisionAt: last === null ? null : new Date(last).toISOString(),
    mergedUnchanged: unchanged,
    verdict: met ? 'met' : bad.length > 0 ? 'reset' : 'not-met',
    unmet,
    returnToShadow: bad.length > 0 && gather.mode === 'on',
  };
}

const day = (ms: string | null): string => (ms ? ms.slice(0, 10) : 'none');

/** The report, as Markdown. */
export function renderShadowRecord(summary: ShadowSummary): string {
  const lines: string[] = [
    '# Shadow record: has Auto-merge earned `on`?',
    '',
    `Window ${summary.window.since}..${summary.window.until}, as of ${summary.asOf}. Mode setting: \`${summary.mode}\`. A measure, not a gate (ADR 0148 decisions 5 and 6).`,
    '',
  ];
  if (summary.verdict === 'met') {
    lines.push(
      `**Exit criterion: MET.** ${summary.counted.length} decisions over ${summary.spanDays.toFixed(1)} days, every one merged unchanged, none reverted or fixed within ${BAD_WITHIN_DAYS} days${summary.restartAt ? ` (counted since the restart after ${summary.restartAt})` : ''}.`,
      '',
      'Not measured: that no "held" reason was a misread. Read the held list below before switching the mode.',
    );
  } else if (summary.verdict === 'reset') {
    lines.push(
      `**Exit criterion: RESET, not met.** A bad Auto-merge was found. ${summary.returnToShadow ? 'The setting is `on` and **must return to `shadow`**; ' : 'Keep the setting at `shadow`; '}the count restarts after ${summary.restartAt}.`,
      '',
      `Unmet since the restart: ${summary.unmet.join('; ')}.`,
    );
  } else {
    lines.push(`**Exit criterion: NOT MET.** ${summary.unmet.join('; ')}.`);
  }
  if (summary.returnToShadow && summary.verdict !== 'reset') {
    lines.push(
      '',
      'A bad Auto-merge was found and the setting is `on`: it **must return to `shadow`**, and the count restarts after ' +
        `${summary.restartAt}.`,
    );
  }
  if (summary.untrustedComments > 0) {
    lines.push(
      '',
      `${summary.untrustedComments} shadow comment(s) by a login that is not trusted were set aside.`,
    );
  }
  lines.push(
    '',
    '## Counts',
    '',
    `- "Would auto-merge" decisions counted: ${summary.counted.length} (of ${summary.decisions.length} in the window${summary.restartAt ? `; the rest are before the restart` : ''})`,
    `- Span: ${summary.spanDays.toFixed(1)} days (${day(summary.firstDecisionAt)} to ${day(summary.lastDecisionAt)})`,
    `- Merged unchanged: ${summary.mergedUnchanged} of ${summary.counted.length}`,
    `- Reverted or fixed within ${BAD_WITHIN_DAYS} days: ${summary.bad.length}`,
    `- Held: ${summary.held.total}${summary.unreadableComments ? `; shadow comments that could not be read: ${summary.unreadableComments}` : ''}`,
    '',
  );
  if (summary.bad.length > 0) {
    lines.push('## Bad Auto-merges', '');
    for (const d of summary.bad) {
      lines.push(
        `- #${d.number} ${d.title}: ${d.bad!.kind} by #${d.bad!.by} on ${new Date(d.bad!.at).toISOString().slice(0, 10)}`,
      );
    }
    lines.push('');
  }
  const notUnchanged = summary.counted.filter(
    (d) => d.outcome !== 'merged-unchanged',
  );
  if (notUnchanged.length > 0) {
    lines.push('## Not merged unchanged', '');
    for (const d of notUnchanged) {
      lines.push(
        `- #${d.number}: ${d.outcome}${d.detail ? ` (${d.detail})` : ''}`,
      );
    }
    lines.push('');
  }
  if (summary.held.byReason.length > 0) {
    lines.push('## Held reasons (a person confirms none was a misread)', '');
    for (const { reason, count } of summary.held.byReason) {
      lines.push(`- ${count} × ${reason}`);
    }
    lines.push('');
  }
  lines.push('## Evidence', '');
  for (const [key, value] of Object.entries(summary.evidence)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push(
    '',
    'A Pull Request has one shadow comment, edited in place, so only its latest decision is counted and it is dated by that edit.',
    '',
  );
  return lines.join('\n');
}
