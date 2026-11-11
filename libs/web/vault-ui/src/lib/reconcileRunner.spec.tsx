/* eslint-disable import/first -- jest.mock must precede application imports */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const mockToast = jest.fn();
const mockReconcileVaultWithServer = jest.fn();
const mockCreateVaultApi = jest.fn(() => ({}));
/** The default shared api is the plain fake, so existing assertions hold. */
const mockCreateSharedVaultApi = jest.fn<unknown, [string]>(() =>
  mockCreateVaultApi(),
);
const mockReportMountSettled = jest.fn();

jest.mock('@myorganiser/web-ui', () => {
  const actual = jest.requireActual('@myorganiser/web-ui');
  return {
    ...actual,
    useToast: () => ({ toast: mockToast }),
  };
});

jest.mock('@myorganiser/web-vault', () => ({
  createVaultApi: () => mockCreateVaultApi(),
  createSharedVaultApi: (owner: string) => mockCreateSharedVaultApi(owner),
  getHttpStatus: jest.fn(() => undefined),
  reconcileVaultWithServer: (options: ReconcileOptions) =>
    mockReconcileVaultWithServer(options),
}));

jest.mock('./session', () => ({
  useOptionalVaultSession: jest.fn(),
}));

jest.mock('./vaultMountSettle', () => ({
  useReportVaultMountSettle: jest.fn(() => mockReportMountSettled),
}));

import type {
  VaultBlobConvergeOutcome,
  VaultReconcileAsk,
  VaultReconcileDecision,
} from '@myorganiser/web-vault';
import { VaultBlobType } from '@myorganiser/app-api-client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { useOptionalVaultSession } from './session';
import {
  VaultReconcileRunner,
  VAULT_STANDOFF_DIALOG_TEST_ID,
} from './reconcileRunner';
import { vaultBlobTypeLabel } from './vaultSyncMessages';

type ReconcileOptions = {
  handle: MockHandle;
  prompt: (ask: VaultReconcileAsk) => Promise<VaultReconcileDecision>;
};

/**
 * A stand-in for the Local Vault Revision. Hand-rolled rather than imported,
 * because `@myorganiser/web-vault` is mocked wholesale in this spec — but the
 * same shape `createLocalVaultRevision` returns: a number, a bump that tells
 * every listener, and a subscribe that hands back its own unsubscribe.
 */
type FakeRevision = {
  current: () => number;
  bump: () => void;
  subscribe: (listener: () => void) => () => void;
};

function createFakeRevision(): FakeRevision {
  let value = 0;
  const listeners = new Set<() => void>();

  return {
    current: () => value,
    bump: () => {
      value += 1;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * A stand-in Vault Handle whose writes bump the revision the way the real one
 * does. `vaultHandle.ts` calls `reportVaultReplaced` from more places than are
 * faked here — `saveVault`, `removeVault`, `claimUnclaimedLocalVaultLocked`,
 * `claimUnclaimedLocalVaultByRecoveryKey`,
 * `replaceOwnedLocalVaultWithUnclaimedLocked` and
 * `replaceOwnedLocalVaultWithUnclaimedByRecoveryKey` — and the three below are
 * the doors ADR 0066 names, not the whole list. What the runner sees is the
 * bump, so a seventh door needs no test here.
 */
type MockHandle = {
  owner: string;
  isUnlocked: boolean;
  vaultStatus: jest.Mock;
  loadVault: jest.Mock;
  saveVault: jest.Mock;
  removeVault: jest.Mock;
  replaceOwnedLocalVaultWithUnclaimedLocked: jest.Mock;
};

function createMockHandle(
  owner: string,
  options: {
    revision?: FakeRevision;
    isUnlocked?: boolean;
    vaultStatus?: 'owned' | 'unclaimed';
  } = {},
): MockHandle {
  const bump = () => options.revision?.bump();

  return {
    owner,
    isUnlocked: options.isUnlocked ?? true,
    vaultStatus: jest.fn(() => options.vaultStatus ?? 'owned'),
    loadVault: jest.fn(() => ({ data: {} })),
    saveVault: jest.fn(bump),
    removeVault: jest.fn(bump),
    replaceOwnedLocalVaultWithUnclaimedLocked: jest.fn(bump),
  };
}

function arrangeSession(
  handle: MockHandle,
  revision: FakeRevision | null,
  claimEvidence?:
    | { status: 'checking' }
    | { status: 'settled'; result: { kind: string } },
) {
  (useOptionalVaultSession as jest.Mock).mockReturnValue({
    handle,
    revision,
    claimEvidence: claimEvidence ?? {
      status: 'settled' as const,
      result: { kind: 'skipped-already-owned' },
    },
  });
}

const QUIET_RESULT = {
  kind: 'reconciled',
  start: 'both',
  converged: [],
  deferred: false,
};

/**
 * Let every pending pass settle and every follow-on trigger be heard.
 *
 * A macrotask, so the whole microtask queue drains however many `.then` /
 * `.catch` / `.finally` links the runner's chain happens to have. Counting
 * `await Promise.resolve()` calls would silently stop reaching the end of the
 * chain the day a link is added, and every "no second pass" assertion below
 * would then hold for the wrong reason.
 */
async function flushPasses() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function arrangePrompt(decisionResult: { current?: VaultReconcileDecision }) {
  mockReconcileVaultWithServer.mockImplementation(
    async (options: ReconcileOptions) => {
      const ask: VaultReconcileAsk = {
        kind: 'blob',
        type: VaultBlobType.Groceries,
        reason: 'strategy',
      };
      decisionResult.current = await options.prompt(ask);

      return QUIET_RESULT;
    },
  );
}

function arrangeNoPromptReconcile() {
  mockReconcileVaultWithServer.mockImplementation(async () => QUIET_RESULT);
}

describe('VaultReconcileRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    mockCreateSharedVaultApi.mockImplementation(() => mockCreateVaultApi());
  });

  test('should build its api with createSharedVaultApi(owner) when it mounts with an owner', async () => {
    const sharedApi = { shared: true };
    mockCreateSharedVaultApi.mockImplementation(() => sharedApi);
    arrangeSession(createMockHandle('user-a'), null);
    arrangeNoPromptReconcile();

    render(<VaultReconcileRunner />);
    await flushPasses();

    expect(mockCreateSharedVaultApi).toHaveBeenCalledWith('user-a');
    expect(mockCreateVaultApi).not.toHaveBeenCalled();
    expect(mockReconcileVaultWithServer).toHaveBeenCalledWith(
      expect.objectContaining({ api: sharedApi }),
    );
  });

  test('renders dialog with proper copy for blob-type strategy ask', async () => {
    const decisionResult: { current?: VaultReconcileDecision } = {};
    arrangeSession(createMockHandle('user-a'), null);

    arrangePrompt(decisionResult);

    render(<VaultReconcileRunner />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toBeNull();

    // The dialog names the Vault Blob Type, in the User-facing wording the
    // pinned label table gives it — read off the table, not spelled again.
    const label = vaultBlobTypeLabel(VaultBlobType.Groceries);
    expect(screen.getAllByText(new RegExp(label, 'i')).length).toBeGreaterThan(
      0,
    );

    // Should show buttons for both choices
    expect(
      screen.getByRole('button', { name: "Keep this device's data" }),
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: "Keep the server's data" }),
    ).not.toBeNull();

    // Not the whole-Vault standoff id — a per-type ask must not trip the E2E
    // specs' "no whole-Vault prompt" assertion (issue #574).
    expect(screen.queryByTestId(VAULT_STANDOFF_DIALOG_TEST_ID)).toBeNull();
  });

  test('clicking keep-local button sends keep-local decision', async () => {
    const decisionResult: { current?: VaultReconcileDecision } = {};
    arrangeSession(createMockHandle('user-a'), null);

    arrangePrompt(decisionResult);

    render(<VaultReconcileRunner />);

    expect(await screen.findByRole('dialog')).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: "Keep this device's data" }),
    );

    await waitFor(() => expect(decisionResult.current).toBe('keep-local'));
  });

  test('clicking keep-remote button sends keep-remote decision', async () => {
    const decisionResult: { current?: VaultReconcileDecision } = {};
    arrangeSession(createMockHandle('user-a'), null);

    arrangePrompt(decisionResult);

    render(<VaultReconcileRunner />);

    expect(await screen.findByRole('dialog')).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: "Keep the server's data" }),
    );

    await waitFor(() => expect(decisionResult.current).toBe('keep-remote'));
  });

  test('renders whole-vault ask when kind is vault', async () => {
    const decisionResult: { current?: VaultReconcileDecision } = {};
    arrangeSession(createMockHandle('user-a'), null);

    mockReconcileVaultWithServer.mockImplementation(
      async (options: ReconcileOptions) => {
        const ask: VaultReconcileAsk = { kind: 'vault' };
        decisionResult.current = await options.prompt(ask);
        return QUIET_RESULT;
      },
    );

    render(<VaultReconcileRunner />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toBeNull();

    // Should show whole-vault specific copy
    expect(
      screen.getByText(/this vault is not the one on the server/i),
    ).not.toBeNull();

    // The E2E specs that assert no whole-Vault prompt fired cannot import
    // this lib's copy across the `type:e2e` -> `type:feature` module
    // boundary, so they assert on this id instead (issue #574). Proving it
    // is present exactly when the whole-Vault ask renders is what keeps that
    // E2E assertion from going vacuous the way the deleted dialog title did.
    expect(screen.getByTestId(VAULT_STANDOFF_DIALOG_TEST_ID)).toBe(dialog);
  });

  test('dismissing conflict dialog resolves prompt with defer, not keep-server (ADR 0033)', async () => {
    const decisionResult: { current?: VaultReconcileDecision } = {};
    arrangeSession(createMockHandle('user-a'), null);

    arrangePrompt(decisionResult);

    render(<VaultReconcileRunner />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toBeNull();

    // Simulate Escape key dismissal
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(decisionResult.current).toBe('defer'));
  });

  test('unmounting while prompt is pending resolves with defer', async () => {
    const decisionResult: { current?: VaultReconcileDecision } = {};
    arrangeSession(createMockHandle('user-a'), null);

    arrangePrompt(decisionResult);

    const { unmount } = render(<VaultReconcileRunner />);

    await screen.findByRole('dialog');

    unmount();

    // The cleanup function should resolve with 'defer'
    await waitFor(() => expect(decisionResult.current).toBe('defer'));
  });

  describe('what a completed pass tells the User', () => {
    test('shows toast for downloaded-server-wrapping', async () => {
      arrangeSession(createMockHandle('user-a'), null);

      mockReconcileVaultWithServer.mockResolvedValue({
        kind: 'reconciled',
        start: 'downloaded-server-wrapping',
        converged: [],
        deferred: false,
      });

      render(<VaultReconcileRunner />);

      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));

      const [toastArgs] = mockToast.mock.calls[0] as [Record<string, unknown>];
      expect(toastArgs.title).toBe('Vault synced');
      expect(toastArgs.description).toBe(
        'Downloaded your server vault to this device.',
      );
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    test('shows toast for uploaded-local-wrapping', async () => {
      arrangeSession(createMockHandle('user-a'), null);

      mockReconcileVaultWithServer.mockResolvedValue({
        kind: 'reconciled',
        start: 'uploaded-local-wrapping',
        converged: [],
        deferred: false,
      });

      render(<VaultReconcileRunner />);

      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));

      const [toastArgs] = mockToast.mock.calls[0] as [Record<string, unknown>];
      expect(toastArgs.title).toBe('Vault synced');
      expect(toastArgs.description).toBe(
        'Your encrypted vault is now backed up to the server.',
      );
      // A newly registered User's first sync is an ordinary first sync, never a
      // migration — CONTEXT.md lists "vault migration" under _Avoid_ for Vault
      // Reconcile, and this User has nothing to migrate from.
      expect(JSON.stringify(toastArgs).toLowerCase()).not.toContain('migrat');
    });

    type ConvergedOutcomeCase = {
      name: string;
      outcome: VaultBlobConvergeOutcome;
      /** Whether the pass counts as having moved Ciphertext on either side. */
      saysSomething: boolean;
    };

    /**
     * Every outcome a `both`-start pass can carry, and whether it counts as
     * having moved Ciphertext. `reconcileChangedSomething` decides that with a
     * pinned fan-out over this union (ADR 0053), so the table is keyed by the
     * union's own `kind` rather than hand-listed: a seventh outcome added to
     * `VaultBlobConvergeOutcome` fails to compile here until somebody says what
     * it means. Named per case rather than left to an empty `converged` array,
     * which never reaches the callback at all.
     */
    const CONVERGED_OUTCOMES = {
      nothing: [
        {
          name: 'nothing',
          outcome: { kind: 'nothing', reason: 'in-sync' },
          saysSomething: false,
        },
      ],
      asked: [
        {
          name: 'a dismissed question',
          outcome: { kind: 'asked', reason: 'strategy', decision: 'defer' },
          saysSomething: false,
        },
        {
          name: 'an answered question',
          outcome: {
            kind: 'asked',
            reason: 'strategy',
            decision: 'keep-local',
          },
          saysSomething: true,
        },
      ],
      sent: [
        {
          name: 'sent',
          outcome: { kind: 'sent', etag: 'e1' },
          saysSomething: true,
        },
      ],
      took: [
        {
          name: 'took',
          outcome: { kind: 'took', etag: 'e1' },
          saysSomething: true,
        },
      ],
      merged: [
        {
          name: 'merged',
          outcome: { kind: 'merged', etag: 'e1' },
          saysSomething: true,
        },
      ],
      refused: [
        {
          name: 'refused across different Vault Identity',
          outcome: { kind: 'refused', reason: 'different-vault' },
          // Refusal does not produce a "Vault updated" toast — the pass declines
          // to move Ciphertext on either side, so saying "Vault updated" would be
          // a lie. Telling the User about the standoff is the sync status's job
          // (ADR 0067).
          saysSomething: false,
        },
      ],
    } as const satisfies Record<
      VaultBlobConvergeOutcome['kind'],
      readonly ConvergedOutcomeCase[]
    >;

    // Read back through the widened type the table is pinned against. `as
    // const` makes every row its own tuple literal, so `Object.values` on the
    // table itself hands back a union of tuples and `flatMap` resolves its
    // callback against the first constituent alone.
    const CONVERGED_OUTCOME_ROWS: Record<
      VaultBlobConvergeOutcome['kind'],
      readonly ConvergedOutcomeCase[]
    > = CONVERGED_OUTCOMES;

    const CONVERGED_OUTCOME_CASES: readonly ConvergedOutcomeCase[] =
      Object.values(CONVERGED_OUTCOME_ROWS).flatMap((cases) => cases);

    test.each(CONVERGED_OUTCOME_CASES)(
      'a both-start pass whose only outcome is $name',
      async ({ outcome, saysSomething }) => {
        arrangeSession(createMockHandle('user-a'), null);

        mockReconcileVaultWithServer.mockResolvedValue({
          kind: 'reconciled',
          start: 'both',
          converged: [{ type: VaultBlobType.Tasks, outcome }],
          deferred: false,
        });

        render(<VaultReconcileRunner />);

        await waitFor(() =>
          expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1),
        );
        await flushPasses();

        if (saysSomething) {
          expect(mockToast).toHaveBeenCalledTimes(1);
          const [toastArgs] = mockToast.mock.calls[0] as [
            Record<string, unknown>,
          ];
          expect(toastArgs.title).toBe('Vault updated');
          expect(toastArgs.description).toBe(
            'This device and the server now hold the same vault data.',
          );
        } else {
          // A sign-in where nothing moved is not news.
          expect(mockToast).not.toHaveBeenCalled();
        }
      },
    );

    test('a pass that never reached the server is silent', async () => {
      arrangeSession(createMockHandle('user-a'), null);

      mockReconcileVaultWithServer.mockResolvedValue({
        kind: 'skipped-not-authenticated',
      });

      render(<VaultReconcileRunner />);

      await waitFor(() =>
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1),
      );
      await flushPasses();

      expect(mockToast).not.toHaveBeenCalled();
    });

    test('a failed pass toasts, settles, and is triggered again by the next bump', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', { revision });
      arrangeSession(handle, revision);

      mockReconcileVaultWithServer.mockRejectedValue(
        new Error('Network error'),
      );

      render(<VaultReconcileRunner />);

      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));

      const [toastArgs] = mockToast.mock.calls[0] as [Record<string, unknown>];
      expect(toastArgs.title).toBe('Vault sync failed');
      expect(toastArgs.variant).toBe('destructive');

      // A failure is not a retry loop: with the revision subscribed and
      // unmoved, the failed pass stays settled instead of re-running on the
      // partial convergence it left behind.
      await flushPasses();
      await flushPasses();
      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);

      // Nor does it wedge the runner: the next replacement is heard.
      await act(async () => {
        handle.removeVault();
      });
      await flushPasses();

      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(2);
      expect(mockToast).toHaveBeenCalledTimes(2);
    });
  });

  describe('when a pass runs', () => {
    test('per-User scoping: each owner gets its own pass with its own handle', async () => {
      const revisionA = createFakeRevision();
      const handleA = createMockHandle('user-a', { revision: revisionA });
      arrangeSession(handleA, revisionA);

      arrangeNoPromptReconcile();

      const { unmount } = render(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });
      // The runner hands convergence the handle itself; it no longer reads the
      // Local Vault on its own.
      expect(mockReconcileVaultWithServer).toHaveBeenCalledWith(
        expect.objectContaining({ handle: handleA }),
      );

      unmount();

      const revisionB = createFakeRevision();
      const handleB = createMockHandle('user-b', { revision: revisionB });
      arrangeSession(handleB, revisionB);

      render(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(2);
      });
      expect(mockReconcileVaultWithServer).toHaveBeenLastCalledWith(
        expect.objectContaining({ handle: handleB }),
      );
    });

    test('a re-render with the same owner and an unmoved revision runs no second pass', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', { revision });
      arrangeSession(handle, revision);

      arrangeNoPromptReconcile();

      const { rerender } = render(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });

      rerender(<VaultReconcileRunner />);
      await flushPasses();

      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      expect(revision.current()).toBe(0);
    });

    test('a Vault reporting itself locked still gets a pass', async () => {
      const handle = createMockHandle('user-a', { isUnlocked: false });
      arrangeSession(handle, null);

      arrangeNoPromptReconcile();

      render(<VaultReconcileRunner />);

      // Deriving what this device owes needs no Master Key (ADR 0058), so the
      // lock is no obstacle to the pass.
      await waitFor(() =>
        expect(mockReconcileVaultWithServer).toHaveBeenCalledWith(
          expect.objectContaining({ handle }),
        ),
      );
    });

    test('a session with no revision store runs one pass and is never triggered again', async () => {
      const handle = createMockHandle('user-a');
      // `NO_REVISION` is the constant a pass settles at when there is nothing to
      // read a revision from, so the watermark can never be beaten.
      arrangeSession(handle, null);

      arrangeNoPromptReconcile();

      render(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });

      // Nothing this handle does can reach a runner that has no store to hear
      // it through.
      await act(async () => {
        handle.removeVault();
        handle.saveVault({ data: {} });
        fireEvent(window, new Event('focus'));
      });
      await flushPasses();

      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
    });

    test('the runner writes nothing to sessionStorage', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', { revision });
      arrangeSession(handle, revision);

      arrangeNoPromptReconcile();

      render(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        handle.removeVault();
      });
      await flushPasses();

      // No per-Session "already ran" flag survives: the trigger is the Local
      // Vault Revision, and nothing about a pass is remembered across a tab.
      expect(window.sessionStorage.length).toBe(0);
    });
  });

  describe('the Local Vault Revision is the trigger', () => {
    const REVISION_DOORS: ReadonlyArray<
      [string, (handle: MockHandle) => void]
    > = [
      ['a Local Vault removal', (handle) => handle.removeVault()],
      [
        'an import writing a whole Local Vault',
        (handle) => handle.saveVault({ data: {} }),
      ],
      [
        'a convergence-replacement',
        (handle) => handle.replaceOwnedLocalVaultWithUnclaimedLocked(),
      ],
    ];

    test.each(REVISION_DOORS)(
      'runs a second pass after %s bumps the revision',
      async (_door, openDoor) => {
        const revision = createFakeRevision();
        const handle = createMockHandle('user-a', { revision });
        arrangeSession(handle, revision);

        arrangeNoPromptReconcile();

        render(<VaultReconcileRunner />);

        await waitFor(() => {
          expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
        });

        await act(async () => {
          openDoor(handle);
        });
        await flushPasses();

        expect(revision.current()).toBe(1);
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(2);
      },
    );

    test('the toast for a removal-triggered pass is the one its result names', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', { revision });
      arrangeSession(handle, revision);

      let call = 0;
      mockReconcileVaultWithServer.mockImplementation(async () =>
        call++ === 0
          ? QUIET_RESULT
          : {
              kind: 'reconciled',
              start: 'downloaded-server-wrapping',
              converged: [],
              deferred: false,
            },
      );

      render(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });
      expect(mockToast).not.toHaveBeenCalled();

      await act(async () => {
        handle.removeVault();
      });

      // No reload and no new tab Session: the removal alone gets the device its
      // server Vault back.
      await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
      const [toastArgs] = mockToast.mock.calls[0] as [Record<string, unknown>];
      expect(toastArgs.description).toBe(
        'Downloaded your server vault to this device.',
      );
    });

    test('a pass that writes through the handle does not retrigger itself', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', { revision });
      arrangeSession(handle, revision);

      // Convergence taking the server's Ciphertext writes through
      // `VaultHandle.saveVault`, which bumps the very revision this runner
      // listens to. The watermark is what keeps that from looping.
      mockReconcileVaultWithServer.mockImplementation(
        async (options: ReconcileOptions) => {
          options.handle.saveVault({ data: {} });
          return {
            kind: 'reconciled',
            start: 'both',
            converged: [
              { type: VaultBlobType.Tasks, outcome: { kind: 'took' } },
            ],
            deferred: false,
          };
        },
      );

      render(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });

      await flushPasses();
      await flushPasses();

      expect(revision.current()).toBe(1);
      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
    });

    test('a bump arriving mid-pass starts no second pass', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', { revision });
      arrangeSession(handle, revision);

      let release: (() => void) | undefined;
      mockReconcileVaultWithServer.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return QUIET_RESULT;
      });

      render(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        handle.removeVault();
      });

      // Passes are serialised: two would race each other over the same types.
      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);

      await act(async () => {
        release?.();
      });
      await flushPasses();

      // The pass settled at the revision it found on completion — the mid-pass
      // bump is already inside that watermark, so nothing re-runs.
      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);

      // A bump above the watermark still runs one.
      await act(async () => {
        handle.removeVault();
      });
      await act(async () => {
        release?.();
      });
      await flushPasses();

      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(2);
    });

    test('window focus alone runs no pass', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', { revision });
      arrangeSession(handle, revision);

      arrangeNoPromptReconcile();

      render(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });

      // "What changed on the server for blobs" is VaultPullRunner's question
      // (ADR 0066, decision point 2).
      await act(async () => {
        fireEvent(window, new Event('focus'));
      });
      await flushPasses();

      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
    });
  });

  describe('Vault Claim Evidence is waited on (#673)', () => {
    test('mount with unclaimed status and checking evidence runs no pass', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', {
        revision,
        vaultStatus: 'unclaimed',
      });
      arrangeSession(handle, revision, { status: 'checking' });

      arrangeNoPromptReconcile();

      render(<VaultReconcileRunner />);

      // No pass should start on mount when unclaimed and evidence is checking.
      await flushPasses();

      expect(mockReconcileVaultWithServer).not.toHaveBeenCalled();
    });

    test('settling evidence with refused-not-this-vault starts a pass', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', {
        revision,
        vaultStatus: 'unclaimed',
      });
      const { rerender } = render(<VaultReconcileRunner />);

      arrangeSession(handle, revision, { status: 'checking' });
      rerender(<VaultReconcileRunner />);

      arrangeNoPromptReconcile();

      // No pass yet while evidence is checking.
      await flushPasses();
      expect(mockReconcileVaultWithServer).not.toHaveBeenCalled();

      // Settle evidence with a refusal.
      arrangeSession(handle, revision, {
        status: 'settled',
        result: { kind: 'refused-not-this-vault' },
      });
      rerender(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });
    });

    test('settling evidence with no-evidence starts a pass', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', {
        revision,
        vaultStatus: 'unclaimed',
      });
      arrangeSession(handle, revision, { status: 'checking' });
      const { rerender } = render(<VaultReconcileRunner />);

      arrangeNoPromptReconcile();

      await flushPasses();
      expect(mockReconcileVaultWithServer).not.toHaveBeenCalled();

      // Settle evidence with no-evidence result.
      arrangeSession(handle, revision, {
        status: 'settled',
        result: { kind: 'no-evidence' },
      });
      rerender(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });
    });

    test('settling evidence with claimed (and vaultStatus flipping to owned with revision bump) starts exactly one pass', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', {
        revision,
        vaultStatus: 'unclaimed',
      });
      arrangeSession(handle, revision, { status: 'checking' });
      const { rerender } = render(<VaultReconcileRunner />);

      arrangeNoPromptReconcile();

      // (i) Mount with unclaimed + checking, assert no pass.
      await flushPasses();
      expect(mockReconcileVaultWithServer).not.toHaveBeenCalled();

      // (ii) Flip the handle's vaultStatus mock to return 'owned' FIRST.
      handle.vaultStatus.mockReturnValue('owned');

      // (iii) Bump the fake revision (this is the claim's write reporting itself).
      // A pass must start now because the status is owned and settledAt is null.
      await act(async () => {
        revision.bump();
      });

      // (iv) Assert exactly one call to requestPass.
      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });

      // (v) Rerender with evidence settled { kind: 'claimed' } — the settlement effect
      // calls requestPass while the pass is in flight, so assert the count is still 1.
      arrangeSession(handle, revision, {
        status: 'settled',
        result: { kind: 'claimed' },
      });
      rerender(<VaultReconcileRunner />);

      await flushPasses();
      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);

      // (vi) flushPasses() and assert still one (the watermark now covers the bump).
      await flushPasses();
      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
    });

    test('postponed evidence does not start a pass; when settled later, exactly one pass runs', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', {
        revision,
        vaultStatus: 'unclaimed',
      });
      arrangeSession(handle, revision, { status: 'checking' });
      const { rerender } = render(<VaultReconcileRunner />);

      arrangeNoPromptReconcile();

      await flushPasses();
      expect(mockReconcileVaultWithServer).not.toHaveBeenCalled();

      // Settle evidence with postponed result.
      arrangeSession(handle, revision, {
        status: 'settled',
        result: { kind: 'postponed' },
      });
      rerender(<VaultReconcileRunner />);

      // Postponed is not acted upon; no pass should start.
      await flushPasses();
      expect(mockReconcileVaultWithServer).not.toHaveBeenCalled();

      // Evidence goes back to checking (e.g., on reconnect or focus).
      arrangeSession(handle, revision, { status: 'checking' });
      rerender(<VaultReconcileRunner />);

      await flushPasses();
      expect(mockReconcileVaultWithServer).not.toHaveBeenCalled();

      // Then settles with a different outcome.
      arrangeSession(handle, revision, {
        status: 'settled',
        result: { kind: 'refused-not-this-vault' },
      });
      rerender(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });

      // Exactly one pass should have run overall.
      await flushPasses();
      expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
    });

    test('owned handle runs mount pass even with checking evidence', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', {
        revision,
        vaultStatus: 'owned',
      });
      arrangeSession(handle, revision, { status: 'checking' });

      arrangeNoPromptReconcile();

      render(<VaultReconcileRunner />);

      // Owned status should run a pass regardless of evidence being checking.
      await waitFor(() => {
        expect(mockReconcileVaultWithServer).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('mount-settle signal (#858)', () => {
    test('reports the mount-settle signal once a normal owned-vault pass finishes', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', { revision });
      arrangeSession(handle, revision);
      arrangeNoPromptReconcile();

      render(<VaultReconcileRunner />);

      await waitFor(() => {
        expect(mockReportMountSettled).toHaveBeenCalledTimes(1);
      });
    });

    test('reports the mount-settle signal even when the unclaimed gate defers and runs no pass', async () => {
      // Mirrors "mount with unclaimed status and checking evidence runs no
      // pass" above: reconcile itself has nothing in flight here, so the
      // mount-settle signal must not hang on Vault Claim Evidence, which is
      // tracked separately.
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', {
        revision,
        vaultStatus: 'unclaimed',
      });
      arrangeSession(handle, revision, { status: 'checking' });
      arrangeNoPromptReconcile();

      render(<VaultReconcileRunner />);

      await flushPasses();
      expect(mockReconcileVaultWithServer).not.toHaveBeenCalled();
      expect(mockReportMountSettled).toHaveBeenCalledTimes(1);
    });

    test('reports the mount-settle signal when settled evidence still refuses a pass (postponed)', async () => {
      const revision = createFakeRevision();
      const handle = createMockHandle('user-a', {
        revision,
        vaultStatus: 'unclaimed',
      });
      arrangeSession(handle, revision, {
        status: 'settled',
        result: { kind: 'postponed' },
      });
      arrangeNoPromptReconcile();

      render(<VaultReconcileRunner />);

      await flushPasses();
      expect(mockReconcileVaultWithServer).not.toHaveBeenCalled();
      expect(mockReportMountSettled).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * The `web-e2e` Playwright specs cannot import
 * VAULT_STANDOFF_DIALOG_TEST_ID (module boundary, see its doc comment) — they
 * hold their own copy of the literal instead. A hardcoded copy that drifts
 * silently is exactly how issue #574 happened the first time, so this reads
 * both spec files' text directly (no module import, no boundary crossed) and
 * fails if either stops referencing this id — the rename would otherwise go
 * undetected until an actual whole-Vault prompt started firing unnoticed.
 */
describe('E2E specs stay pinned to the whole-Vault standoff testid (issue #574)', () => {
  const E2E_SPEC_PATHS = [
    'apps/web-e2e/src/e2e/groceries-vault-sync-convergence.spec.ts',
    'apps/web-e2e/src/e2e/tasks-vault-sync-convergence.spec.ts',
    'apps/web-e2e/src/e2e/tasks-vault-sync-delete-propagation.spec.ts',
  ];

  test.each(E2E_SPEC_PATHS)(
    '%s asserts the standoff testid',
    (relativePath) => {
      const contents = readFileSync(
        join(__dirname, '../../../../..', relativePath),
        'utf8',
      );

      expect(contents).toContain(
        `getByTestId('${VAULT_STANDOFF_DIALOG_TEST_ID}')`,
      );
    },
  );
});
