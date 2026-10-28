/**
 * Pure decision logic for the merge-base proof gate on `yarn ai:create-pr`.
 *
 * A fabricated commit message still lands attached to the real staged diff, so the
 * commit path is self-correcting. A fabricated PR body is the whole deliverable and
 * nothing downstream compares it to the branch. `PrAuthor` was observed returning a
 * complete, well-formed draft with `tool_uses: 0` — every fact synthesized from the
 * caller's prompt (issue #456).
 *
 * The gate asks for one fact the agent cannot guess from prompt context: the
 * merge-base SHA. The runner recomputes it and refuses drafts that cannot produce it.
 * This is a proof-of-inspection check, not a proof-of-accuracy one — an agent that
 * ran `git merge-base` proves only that it touched the branch, which is exactly the
 * failure mode observed and all this gate claims to close.
 *
 * Run the tests with: node --test tools/scripts/lib/pr-merge-base.test.ts
 */

/**
 * Shortest abbreviation accepted as proof. `git rev-parse --short` emits 7
 * characters by default, and `PrAuthor` may quote either form, so the gate compares
 * on a prefix rather than demanding all 40.
 */
export const MERGE_BASE_MIN_LENGTH = 7;

const FULL_SHA_LENGTH = 40;
const HEX_PATTERN = /^[0-9a-f]+$/;

/**
 * Normalize a caller-supplied SHA to lowercase hex, or return `null` when it is not
 * a plausible abbreviated or full commit SHA.
 */
export function normalizeMergeBase(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized.length < MERGE_BASE_MIN_LENGTH ||
    normalized.length > FULL_SHA_LENGTH ||
    !HEX_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

/**
 * True when the caller passed a drafted title or body — the agent path. Humans and
 * CI run the runner bare and get the commit-subject fallback, which is derived from
 * the branch itself and so needs no proof.
 *
 * `--body` counts alongside `--body-file`. Issue #456 names only the two flags the
 * observed failure used, but inline body text is the same authored deliverable
 * arriving by a different door, and exempting it would leave the hole open.
 */
export interface AgentDraftInvocationInput {
  body?: string | null;
  bodyFile?: string | null;
  title?: string | null;
}

export function isAgentDraftInvocation({
  body = null,
  bodyFile = null,
  title = null,
}: AgentDraftInvocationInput = {}): boolean {
  return Boolean(title) || Boolean(bodyFile) || Boolean(body);
}

/**
 * Decide whether an invocation may proceed.
 *
 * Returns `{ ok: true }` or `{ ok: false, message }`. The message is the operator
 * facing text; it names the flag and what to do about it, because the agent reading
 * it has no other channel back to the workflow that failed.
 */
export interface MergeBaseProofInput {
  computedMergeBase: string | null | undefined;
  isAgentDraft: boolean;
  suppliedMergeBase: string | null | undefined;
}

export type MergeBaseProofResult =
  | { ok: true }
  | { ok: false; message: string };

export function checkMergeBaseProof({
  computedMergeBase,
  isAgentDraft,
  suppliedMergeBase,
}: MergeBaseProofInput): MergeBaseProofResult {
  if (!isAgentDraft && !suppliedMergeBase) {
    return { ok: true };
  }

  if (!suppliedMergeBase) {
    return {
      message:
        'Missing --merge-base. Agent drafts (--title / --body / --body-file) must prove the branch was inspected: pass the `MERGE-BASE:` SHA from the PrAuthor draft. A draft without one was not read from the diff.',
      ok: false,
    };
  }

  const supplied = normalizeMergeBase(suppliedMergeBase);
  const computed = normalizeMergeBase(computedMergeBase);

  if (!supplied) {
    return {
      message: `Invalid --merge-base '${suppliedMergeBase}'. Expected a commit SHA of at least ${MERGE_BASE_MIN_LENGTH} hex characters, as emitted by \`git merge-base\`.`,
      ok: false,
    };
  }

  if (!computed) {
    return {
      message:
        'Unable to compute the merge base for this branch, so --merge-base cannot be verified. Fetch the base branch and retry.',
      ok: false,
    };
  }

  const shorter = supplied.length <= computed.length ? supplied : computed;
  const longer = supplied.length <= computed.length ? computed : supplied;

  if (!longer.startsWith(shorter)) {
    return {
      message: `--merge-base ${supplied} does not match this branch's merge base ${computed}. The draft describes a different branch, or was written without inspecting the diff.`,
      ok: false,
    };
  }

  return { ok: true };
}
