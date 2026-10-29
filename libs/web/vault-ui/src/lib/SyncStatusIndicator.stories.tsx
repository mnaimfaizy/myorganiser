'use client';

import type { Meta, StoryObj } from '@storybook/react';
import { VaultBlobType } from '@myorganiser/app-api-client';
import { VAULT_BLOB_TYPES } from '@myorganiser/web-vault';
import { fn } from '@storybook/test';

import { SyncStatusIndicator } from './SyncStatusIndicator';

// The individual `VaultBlobType.*` fixtures below are a few illustrative
// examples, not every member — reaching the Guarded Enum's pinned table here
// (ADR 0053) is what keeps that a reviewable choice rather than a silent
// partial enumeration.
void VAULT_BLOB_TYPES;

/**
 * There is deliberately no story for `synced` or for a null status.
 *
 * Both render an empty container holding an empty screen-reader paragraph, so
 * a story of either is a blank canvas — indistinguishable from a story that
 * failed to load, identical to the other, and a snapshot that
 * asserts nothing. That the component adds no chrome when sync is healthy is
 * a real contract, and it is asserted in `SyncStatusIndicator.spec.tsx`,
 * which is where an assertion belongs. See STORYBOOK-PATTERNS.md §8.
 */
const meta: Meta<typeof SyncStatusIndicator> = {
  component: SyncStatusIndicator,
  title: 'Vault/SyncStatusIndicator',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof SyncStatusIndicator>;

/**
 * Changes are queued on the device but have not yet reached the server, and no
 * automatic retry is currently in progress. The label identifies unsent types.
 * The user can choose to manually retry, and the component will automatically
 * retry on its backoff schedule.
 */
export const PendingNotRetrying: Story = {
  args: {
    status: {
      kind: 'pending',
      pendingTypes: [VaultBlobType.Tasks],
      terminalFailures: [],
      retrying: false,
    },
  },
};

/**
 * Changes are queued on the device and the component is actively retrying to send
 * them. The detail text includes "Retrying automatically" to signal this is
 * transient — the user does not need to act. Multiple pending types are shown
 * to demonstrate that all affected data is named.
 */
export const PendingRetrying: Story = {
  args: {
    status: {
      kind: 'pending',
      pendingTypes: [VaultBlobType.Tasks, VaultBlobType.Addresses],
      terminalFailures: [],
      retrying: true,
    },
  },
};

/**
 * User session ended (401/403). Syncing has stopped and will not resume
 * automatically. The label and detail are specific to this state, signaling that
 * sign-in is required to resume. This is an error-tone reading requiring user action.
 */
export const SessionEnded: Story = {
  args: {
    status: {
      kind: 'session-ended',
      pendingTypes: [VaultBlobType.Tasks],
      terminalFailures: [],
      retrying: false,
    },
  },
};

/**
 * Vault identity mismatch: this device's Vault (derived from the encryption
 * key-derivation salt) differs from what the server holds. Syncing is refused
 * because merging would destroy readable ciphertext under different Master Keys.
 * The detail text emphasizes safety and readability to counter the alarming
 * headline. Retry is not offered because the mismatch requires user action, not
 * a retry — removing the vault or signing in with the matching passphrase.
 */
export const Standoff: Story = {
  args: {
    status: {
      kind: 'standoff',
      pendingTypes: [],
      terminalFailures: [],
      retrying: false,
    },
  },
};

/**
 * Terminal failure: the server rejected a specific data type with a 422 and will
 * not retry automatically. The failing type is named in the detail. This story
 * must be visibly and semantically **different** from the `PendingNotRetrying`
 * story to signal permanent failure vs. transient delay — a reviewer must be able
 * to see at a glance that "terminal" means "server said no, stop trying".
 */
export const TerminalSingleType: Story = {
  args: {
    status: {
      kind: 'terminal',
      pendingTypes: [],
      terminalFailures: [{ type: VaultBlobType.Groceries, status: 422 }],
      retrying: false,
    },
  },
};

/**
 * Terminal failure affecting multiple data types. Demonstrates that the component
 * names all affected data types in the detail, not just the first one, so a user
 * knows exactly which data was rejected.
 */
export const TerminalMultipleTypes: Story = {
  args: {
    status: {
      kind: 'terminal',
      pendingTypes: [],
      terminalFailures: [
        { type: VaultBlobType.Tasks, status: 422 },
        { type: VaultBlobType.Groceries, status: 422 },
      ],
      retrying: false,
    },
  },
};

/**
 * Pending state with retry callback provided. The "Retry now" button is visible
 * and wired to the `onRetry` callback, allowing manual retry. This story confirms
 * the button appears and is accessible to interaction.
 */
export const WithRetryAction: Story = {
  args: {
    status: {
      kind: 'pending',
      pendingTypes: [VaultBlobType.Tasks],
      terminalFailures: [],
      retrying: false,
    },
    onRetry: fn(),
  },
};

/**
 * Pending state without retry callback provided. The "Retry now" button is omitted
 * even though the component could normally show one, confirming that `onRetry` is
 * required to make the button visible. This supports use cases where manual retry
 * is not appropriate.
 */
export const WithoutRetryAction: Story = {
  args: {
    status: {
      kind: 'pending',
      pendingTypes: [VaultBlobType.Tasks],
      terminalFailures: [],
      retrying: false,
    },
    // onRetry is deliberately omitted — no callback, no button
  },
};

/**
 * Vault Pull Stall: the device's most recent Vault Pull Pass left some data
 * types unanswered (over budget, a failed inventory read, or an unreachable
 * type). This is an error state, but it is NOT about the User's own unsent
 * edits — contrast with `PendingNotRetrying`. It is also NOT a permanent
 * failure requiring user action — contrast with `Standoff` and
 * `TerminalSingleType`. It is resolved by retrying, and retry here asks the
 * Vault Pull trigger for an immediate pass rather than the Vault Sync Queue.
 * The retry button is visible and wired to demonstrate the affordance.
 */
export const PullStalled: Story = {
  args: {
    status: {
      kind: 'pull-stalled',
      pendingTypes: [],
      terminalFailures: [],
      retrying: false,
    },
    onRetry: fn(),
  },
};
