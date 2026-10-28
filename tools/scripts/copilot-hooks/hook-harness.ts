import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const PRE_TOOL_USE_HOOK = join(import.meta.dirname, 'pre-tool-use.ts');
export const SECRET_SCAN_HOOK = join(import.meta.dirname, 'secret-scan.ts');
export const POST_TOOL_USE_HOOK = join(import.meta.dirname, 'post-tool-use.ts');
export const CLOUD_PERMISSION_REQUEST_HOOK = join(
  import.meta.dirname,
  'cloud-permission-request.ts',
);

/** Exit code the shared hook lib uses to block a tool call. */
const DENY_EXIT_CODE = 2;

export interface HookOutcome {
  status: number | null;
  decision: string;
  reason: string;
}

/** Options accepted by every helper here; `sandbox` picks the hook's mode. */
export interface HookRunOptions {
  sandbox?: boolean;
  args?: string[];
  env?: Record<string, string | undefined>;
}

/**
 * Invoke a hook exactly as a harness does: JSON payload on stdin, decision on
 * stdout, block signalled by exit code 2.
 *
 * These hooks are CLI scripts that act at import time — they read stdin and
 * call `process.exit` — so they are exercised as subprocesses rather than
 * imported, which is also exactly how a harness runs them.
 */
export function runHook(
  hookPath: string,
  payload: unknown,
  options?: HookRunOptions,
): HookOutcome {
  const result = runHookRaw(hookPath, payload, options);

  let decision = '';
  let reason = '';

  try {
    const parsed = JSON.parse(result.stdout || '{}') as {
      permissionDecision?: string;
      permissionDecisionReason?: string;
    };
    decision = parsed.permissionDecision ?? '';
    reason = parsed.permissionDecisionReason ?? '';
  } catch {
    // A hook that emits non-JSON is itself a failure; assertions below catch it.
  }

  return { status: result.status, decision, reason };
}

/**
 * Run a hook and return its raw stdout — for hooks whose output is not a
 * PreToolUse decision, and for asserting that a hook stayed silent.
 */
export function runHookRaw(
  hookPath: string,
  payload: unknown,
  options?: HookRunOptions,
): { status: number | null; stdout: string } {
  // The hooks read the sandbox marker from the environment, so the two modes
  // have to be driven through the child process rather than a module flag.
  const childEnv = { ...process.env };
  if (options?.sandbox) {
    childEnv.MYORGANISER_SANDBOX = '1';
  } else {
    delete childEnv.MYORGANISER_SANDBOX;
  }

  // Apply any custom environment overrides
  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (value === undefined) {
        delete childEnv[key];
      } else {
        childEnv[key] = value;
      }
    }
  }

  const args = [hookPath, ...(options?.args ?? [])];
  const result = spawnSync(process.execPath, args, {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: childEnv,
  });

  return { status: result.status, stdout: result.stdout };
}

export function expectDenied(
  hookPath: string,
  payload: unknown,
  reasonPattern: RegExp,
  options?: HookRunOptions,
): void {
  const outcome = runHook(hookPath, payload, options);

  assert.equal(outcome.status, DENY_EXIT_CODE);
  assert.equal(outcome.decision, 'deny');
  assert.match(outcome.reason, reasonPattern);
}

export function expectAllowed(
  hookPath: string,
  payload: unknown,
  options?: HookRunOptions,
): void {
  const outcome = runHook(hookPath, payload, options);

  assert.equal(outcome.status, 0);
  assert.equal(outcome.decision, 'allow');
}

export function shellPayload(toolName: string, command: string) {
  return { tool_name: toolName, tool_input: { command } };
}

/**
 * PostToolUse hooks never block — they exit 0 either silently or with follow-up
 * context on stdout. `''` means the hook stayed quiet.
 */
export function runContextHook(hookPath: string, payload: unknown): string {
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);

  if (!result.stdout.trim()) {
    return '';
  }

  const parsed = JSON.parse(result.stdout) as { additionalContext?: string };
  return parsed.additionalContext ?? '';
}

export function expectNoContext(hookPath: string, payload: unknown): void {
  assert.equal(runContextHook(hookPath, payload), '');
}

export function expectContext(
  hookPath: string,
  payload: unknown,
  pattern: RegExp,
): void {
  assert.match(runContextHook(hookPath, payload), pattern);
}
