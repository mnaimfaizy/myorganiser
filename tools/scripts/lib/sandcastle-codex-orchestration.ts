import {
  buildCodexCommand,
  requireCodexSubscription,
  type CodexCommand,
  type CodexSubscriptionProbe,
} from './sandcastle-codex-preflight.ts';

export const VERIFIED_CODEX_VERSION = 'codex-cli 0.171.0-alpha.13.2';

/** Evidence is supplied by the runtime integration, never by the agent's task. */
export interface CodexBoundaryEvidence {
  profileId: string;
  snapshotId: string;
  profileIsIsolated: boolean;
  snapshotIsImmutable: boolean;
  hooksAreActive: boolean;
}

export interface CodexBoundaryVerifier {
  /** Must independently inspect the actual launch environment, not a task claim. */
  verify(): Promise<CodexBoundaryEvidence>;
}

/**
 * An injectable orchestration seam, not a production verifier. In particular,
 * a caller must bind verification and launch to the same protected resources.
 * Production must refuse until that guarantee and subscription usability can be
 * demonstrated; fabricated evidence in tests is not a production adapter.
 */
export async function runGuardedCodex<T>(options: {
  version: string | undefined;
  profileId: string;
  snapshotId: string;
  model: string;
  prompt: string;
  subscription: (profileId: string) => ReturnType<CodexSubscriptionProbe>;
  boundary: CodexBoundaryVerifier;
  launch: (command: CodexCommand) => Promise<T>;
}): Promise<T> {
  if (options.version !== VERIFIED_CODEX_VERSION) {
    throw new Error('Unsupported or unverifiable Codex CLI version.');
  }
  if (!options.profileId || !/^[a-f0-9]{64}$/.test(options.snapshotId)) {
    throw new Error(
      'A dedicated profile and reviewed snapshot identity are required.',
    );
  }
  await requireCodexSubscription(() => options.subscription(options.profileId));
  let evidence: CodexBoundaryEvidence;
  try {
    evidence = await options.boundary.verify();
  } catch {
    throw new Error('Codex launch boundary could not be verified.');
  }
  if (
    !evidence ||
    evidence.profileId !== options.profileId ||
    evidence.snapshotId !== options.snapshotId ||
    evidence.profileIsIsolated !== true ||
    evidence.snapshotIsImmutable !== true ||
    evidence.hooksAreActive !== true
  ) {
    throw new Error('Codex launch boundary could not be verified.');
  }
  return options.launch(buildCodexCommand(options.model, options.prompt));
}
