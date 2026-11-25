/** Synthetic integration seam. No production adapter supplies quota evidence. */
import {
  VERIFIED_CODEX_VERSION,
  runGuardedCodex,
} from './sandcastle-codex-orchestration.ts';
import {
  buildResumeBrief,
  decideQuotaWaitAfterPreservation,
  decideWaitPolicy,
  LIMIT_CLASSIFICATIONS,
  QUOTA_WAIT_MARGIN_MS,
  type RunFailureClassification,
  type SlicePreservation,
} from './sandcastle-resume.ts';

/** Only an independently trusted adapter may supply this value, never task output. */
export function classifyCodexQuota(
  evidence: unknown,
  version: string | undefined,
  attemptId: string,
): RunFailureClassification {
  const unknown = {
    kind: LIMIT_CLASSIFICATIONS.unknown,
    resetAt: undefined,
    evidence: undefined,
  };
  if (
    version !== VERIFIED_CODEX_VERSION ||
    !attemptId ||
    !evidence ||
    typeof evidence !== 'object' ||
    Array.isArray(evidence)
  )
    return unknown;
  const value = evidence as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(',');
  if (
    keys !== 'attemptId,kind,resetAt' ||
    value.attemptId !== attemptId ||
    value.kind !== 'subscription-quota-exhausted' ||
    typeof value.resetAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.resetAt)
  )
    return unknown;
  const reset = new Date(value.resetAt);
  if (
    !Number.isFinite(reset.getTime()) ||
    reset.toISOString() !== value.resetAt
  )
    return unknown;
  return {
    kind: LIMIT_CLASSIFICATIONS.limitHit,
    resetAt: reset,
    evidence: undefined,
  };
}

type GuardedOptions = Parameters<typeof runGuardedCodex>[0];
type Checkpoint = { sha: string; files: string[] };

export type SimulatedRecoveryResult =
  | { readonly outcome: 'integrated' }
  | { readonly outcome: 'held'; readonly reason: string };

/**
 * Exercise the existing policy and brief through injected operations. This does not
 * establish a real Codex protocol, checkpoint implementation, or hook trust.
 */
export async function simulateCodexRecovery(options: {
  version: string | undefined;
  attemptId: string;
  quotaEvidence: unknown;
  now: Date;
  waitsTaken: number;
  waitEnabled: boolean;
  issueNumber: number;
  sliceBranch: string;
  basePrompt: string;
  preserve: () => Promise<SlicePreservation<Checkpoint>>;
  verifyCheckpoint: (checkpoint: Checkpoint) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  guarded: GuardedOptions;
  gate: () => Promise<boolean>;
  integrate: () => Promise<void>;
}): Promise<SimulatedRecoveryResult> {
  const held = (reason: string): SimulatedRecoveryResult => ({
    outcome: 'held',
    reason,
  });
  let preservation = await options.preserve();
  if (
    preservation.kind === 'preserved' &&
    !(await options.verifyCheckpoint(preservation.checkpoint))
  ) {
    preservation = { kind: 'failed', reason: 'the checkpoint did not verify' };
  }
  const decision = decideQuotaWaitAfterPreservation(
    preservation,
    decideWaitPolicy({
      classification: classifyCodexQuota(
        options.quotaEvidence,
        options.version,
        options.attemptId,
      ),
      waitEnabled: options.waitEnabled,
      waitsTaken: options.waitsTaken,
      now: options.now,
    }),
  );
  if (decision.action !== 'wait' || !decision.until)
    return held(decision.reason);
  await options.sleep(
    decision.until.getTime() - options.now.getTime() + QUOTA_WAIT_MARGIN_MS,
  );
  let prompt = options.basePrompt;
  if (preservation.kind === 'preserved') {
    if (!(await options.verifyCheckpoint(preservation.checkpoint)))
      return held('the checkpoint changed during the wait');
    prompt = buildResumeBrief({
      basePrompt: options.basePrompt,
      issueNumber: options.issueNumber,
      sliceBranch: options.sliceBranch,
      checkpoint: preservation.checkpoint,
    });
  }
  await runGuardedCodex({
    ...options.guarded,
    version: options.version,
    prompt,
  });
  if (!(await options.gate())) return held('the gate failed');
  await options.integrate();
  return { outcome: 'integrated' };
}
