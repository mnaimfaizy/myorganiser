/* eslint-disable import/first -- jest.mock must precede application imports */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockToast = jest.fn();
const mockSettleVaultMeta = jest.fn();
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
  settleVaultMeta: (options: SettleVaultMetaOptions) =>
    mockSettleVaultMeta(options),
}));

jest.mock('./session', () => ({
  useOptionalVaultSession: jest.fn(),
}));

jest.mock('./vaultMountSettle', () => ({
  useReportVaultMountSettle: jest.fn(() => mockReportMountSettled),
}));

import type {
  VaultMetaChange,
  VaultMetaDecision,
  VaultHandle,
  VaultMetaQuestion,
  VaultMetaRefusalLifetime,
} from '@myorganiser/web-vault';
import type { VaultMetaV1 } from '@myorganiser/app-api-client';
import { useOptionalVaultSession } from './session';
import { VaultMetaConvergeRunner } from './metaConvergeRunner';
import { VAULT_STANDOFF_DIALOG_TITLE } from './reconcileRunner';

type SettleVaultMetaOptions = {
  api: unknown;
  handle: VaultHandle;
  prompt: (params: {
    change: VaultMetaChange;
    remote: { meta: VaultMetaV1; etag: string };
  }) => Promise<VaultMetaDecision> | VaultMetaDecision;
};

type MockHandle = {
  owner: string;
  loadVault: jest.Mock;
  saveVault: jest.Mock;
  isVaultMetaRefused: jest.Mock;
  recordVaultMetaRefusal: jest.Mock;
};

/**
 * A handle whose refusal methods are a real round trip rather than a fixed
 * answer, so a test can record a refusal through the runner and then see the
 * runner consult it. Keyed the way the library keys it — on the question, both
 * the wrapping offered and the change asked about.
 */
function createMockHandle(owner: string): MockHandle {
  const refused = new Set<string>();
  const questionKey = ({ meta, change }: VaultMetaQuestion) =>
    `${change}:${JSON.stringify(meta)}`;

  return {
    owner,
    loadVault: jest.fn(() => ({ data: {} })),
    saveVault: jest.fn(),
    isVaultMetaRefused: jest.fn(async (question: VaultMetaQuestion) =>
      refused.has(questionKey(question)),
    ),
    recordVaultMetaRefusal: jest.fn(
      async (
        options: VaultMetaQuestion & { lifetime: VaultMetaRefusalLifetime },
      ) => {
        refused.add(questionKey(options));
      },
    ),
  };
}

/**
 * One Vault Meta, named. Every wrapping field is derived from `slug`, so two
 * metas built from different slugs are genuinely different wrappings that no
 * comparison can call the same one — and a test that needs to recognise the
 * meta it offered can match on `${slug}-salt`.
 */
function makeRemoteMeta(slug: string): VaultMetaV1 {
  return {
    version: 1,
    kdf_name: 'PBKDF2',
    kdf_salt: `${slug}-salt`,
    kdf_params: { hash: 'SHA-256', iterations: 310_000 },
    wrapped_mk_passphrase: {
      version: 1,
      iv: `${slug}-iv1`,
      ciphertext: `${slug}-ct1`,
    },
    wrapped_mk_recovery: {
      version: 1,
      iv: `${slug}-iv2`,
      ciphertext: `${slug}-ct2`,
    },
  };
}

const WRAPPING_A: VaultMetaV1 = makeRemoteMeta('wrapping-a');

/** Same Vault, one wrapping moved — the second, genuinely different question. */
const WRAPPING_B: VaultMetaV1 = {
  ...WRAPPING_A,
  wrapped_mk_passphrase: {
    version: 1,
    iv: 'wrapping-b-iv1',
    ciphertext: 'wrapping-b-ct1',
  },
};

function arrangeMetaConvergeWithPrompt(decisionResult: {
  current?: VaultMetaDecision;
}) {
  mockSettleVaultMeta.mockImplementation(
    async (options: SettleVaultMetaOptions) => {
      decisionResult.current = await options.prompt({
        change: 'passphrase',
        remote: {
          meta: makeRemoteMeta('remote'),
          etag: 'etag-1',
        },
      });

      return {
        kind: 'converged' as const,
        result: { kind: 'noop-already-in-sync' as const },
      };
    },
  );
}

function arrangeNoPromptMetaConverge() {
  mockSettleVaultMeta.mockImplementation(async () => {
    return { kind: 'skipped-no-local-vault' as const };
  });
}

describe('VaultMetaConvergeRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    mockSettleVaultMeta.mockClear();
    mockCreateSharedVaultApi.mockImplementation(() => mockCreateVaultApi());
  });

  test('should build its api with createSharedVaultApi(owner) when it mounts with an owner', async () => {
    const sharedApi = { shared: true };
    mockCreateSharedVaultApi.mockImplementation(() => sharedApi);
    arrangeNoPromptMetaConverge();
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: createMockHandle('user-a'),
    });

    render(<VaultMetaConvergeRunner />);

    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledWith(
        expect.objectContaining({ api: sharedApi }),
      );
    });
    expect(mockCreateSharedVaultApi).toHaveBeenCalledWith('user-a');
    expect(mockCreateVaultApi).not.toHaveBeenCalled();
  });

  test('should display passphrase dialog with correct copy when passphrase diverged', async () => {
    const decisionResult: { current?: VaultMetaDecision } = {};
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    arrangeMetaConvergeWithPrompt(decisionResult);

    render(<VaultMetaConvergeRunner />);

    expect(await screen.findByRole('dialog')).not.toBeNull();
    expect(
      screen.getByText('Your passphrase was changed on another device'),
    ).not.toBeNull();
    expect(
      screen.getByText('Start using the new passphrase on this device?'),
    ).not.toBeNull();
  });

  test('should display passphrase-specific copy and hide reconcile-specific copy when passphrase diverged', async () => {
    const decisionResult: { current?: VaultMetaDecision } = {};
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    arrangeMetaConvergeWithPrompt(decisionResult);

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');

    // Meta converge dialog should NOT contain reconcile-specific strings
    expect(screen.queryByText(VAULT_STANDOFF_DIALOG_TITLE)).toBeNull();
    expect(screen.queryByText("Keep this device's data")).toBeNull();
    expect(screen.queryByText("Keep the server's data")).toBeNull();
  });

  test('should resolve adopt-remote when "Use the new passphrase" button is clicked', async () => {
    const decisionResult: { current?: VaultMetaDecision } = {};
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    arrangeMetaConvergeWithPrompt(decisionResult);

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');
    fireEvent.click(
      screen.getByRole('button', { name: 'Use the new passphrase' }),
    );

    await waitFor(() => expect(decisionResult.current).toBe('adopt-remote'));

    // Adopting refuses nothing, so there is nothing to record — a refusal here
    // would silence the question about a wrapping this device just took.
    expect(mockHandle.recordVaultMetaRefusal).not.toHaveBeenCalled();
  });

  test('should resolve keep-local when "Keep my current passphrase" button is clicked', async () => {
    const decisionResult: { current?: VaultMetaDecision } = {};
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    arrangeMetaConvergeWithPrompt(decisionResult);

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');
    fireEvent.click(
      screen.getByRole('button', { name: 'Keep my current passphrase' }),
    );

    await waitFor(() => expect(decisionResult.current).toBe('keep-local'));
  });

  test('should resolve defer when escape is pressed and not save or toast', async () => {
    const decisionResult: { current?: VaultMetaDecision } = {};
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    // Mock settleVaultMeta to return noop-deferred when prompt is called with defer
    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        const decision = await options.prompt({
          change: 'passphrase',
          remote: {
            meta: makeRemoteMeta('escape'),
            etag: 'etag-escape',
          },
        });

        decisionResult.current = decision;
        if (decision === 'defer') {
          return {
            kind: 'converged' as const,
            result: {
              kind: 'noop-deferred' as const,
              change: 'passphrase' as const,
            },
          };
        }
        return {
          kind: 'converged' as const,
          result: { kind: 'noop-already-in-sync' as const },
        };
      },
    );

    render(<VaultMetaConvergeRunner />);

    const dialog = await screen.findByRole('dialog');
    // Use Escape key to dismiss
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(decisionResult.current).toBe('defer'));

    // No saveVault call
    expect(mockHandle.saveVault).not.toHaveBeenCalled();
    // No toast
    expect(mockToast).not.toHaveBeenCalled();
    // Session refusal IS recorded (dismissing counts as "not now")
    expect(mockHandle.recordVaultMetaRefusal).toHaveBeenCalledWith({
      meta: expect.objectContaining({
        kdf_salt: 'escape-salt',
      }),
      change: 'passphrase',
      lifetime: 'session',
    });
  });

  test('should show the passphrase updated toast and save nothing when settle reports adopted-remote', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    // settleVaultMeta performs the adoption itself and reports that it wrote
    // the Local Vault, so the runner has no Vault of its own to save.
    mockSettleVaultMeta.mockResolvedValue({
      kind: 'adopted-remote' as const,
      change: 'passphrase' as const,
    });

    render(<VaultMetaConvergeRunner />);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Passphrase updated',
          description:
            'This device now uses the passphrase set on your other device.',
        }),
      );
    });

    expect(mockHandle.saveVault).not.toHaveBeenCalled();
  });

  test('should show the recovery key updated toast and save nothing when settle reports adopted-remote', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockResolvedValue({
      kind: 'adopted-remote' as const,
      change: 'recovery-key' as const,
    });

    render(<VaultMetaConvergeRunner />);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Recovery key updated',
          description:
            'This device now uses the recovery key set on your other device.',
        }),
      );
    });

    expect(mockHandle.saveVault).not.toHaveBeenCalled();
  });

  test('should show no toast and run exactly one follow-up pass when the adoption was superseded by a moved wrapping', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    // The first pass finds the Local Vault had moved before the write; the
    // follow-up pass finds it in sync with the server.
    let passes = 0;
    mockSettleVaultMeta.mockImplementation(async () => {
      passes += 1;
      if (passes === 1) {
        return {
          kind: 'adoption-superseded' as const,
          change: 'passphrase' as const,
          reason: 'wrapping-moved' as const,
        };
      }
      return { kind: 'noop-already-in-sync' as const };
    });

    render(<VaultMetaConvergeRunner />);

    // The mount-settle signal fires at the end of every pass, so reaching two
    // means the follow-up has settled too.
    await waitFor(() => {
      expect(mockReportMountSettled).toHaveBeenCalledTimes(2);
    });

    expect(mockSettleVaultMeta).toHaveBeenCalledTimes(2);
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockHandle.saveVault).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('should show no toast and run exactly one follow-up pass when the adoption was superseded by a missing Local Vault', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    let passes = 0;
    mockSettleVaultMeta.mockImplementation(async () => {
      passes += 1;
      if (passes === 1) {
        return {
          kind: 'adoption-superseded' as const,
          change: 'recovery-key' as const,
          reason: 'no-local-vault' as const,
        };
      }
      return { kind: 'skipped-no-local-vault' as const };
    });

    render(<VaultMetaConvergeRunner />);

    await waitFor(() => {
      expect(mockReportMountSettled).toHaveBeenCalledTimes(2);
    });

    expect(mockSettleVaultMeta).toHaveBeenCalledTimes(2);
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockHandle.saveVault).not.toHaveBeenCalled();
  });

  test('should run no follow-up pass when unmounted while a pass that then reports adoption-superseded is still settling', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    let resolveFirstPass: ((value: unknown) => void) | undefined;
    mockSettleVaultMeta.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirstPass = resolve;
        }),
    );

    const { unmount } = render(<VaultMetaConvergeRunner />);

    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    });

    unmount();

    resolveFirstPass?.({
      kind: 'adoption-superseded',
      change: 'passphrase',
      reason: 'wrapping-moved',
    });

    await waitFor(() => {
      expect(mockReportMountSettled).toHaveBeenCalledTimes(1);
    });

    expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    expect(mockToast).not.toHaveBeenCalled();
  });

  test('should run no follow-up pass when a focus-requested recheck is pending and the component unmounts before the pass settles', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    // Only the first pass is held open, so the focus below lands while it is
    // in flight and sets the pending recheck. Any later pass settles at once.
    let resolveFirstPass: ((value: unknown) => void) | undefined;
    let passes = 0;
    mockSettleVaultMeta.mockImplementation(() => {
      passes += 1;
      if (passes === 1) {
        return new Promise((resolve) => {
          resolveFirstPass = resolve;
        });
      }
      return Promise.resolve({ kind: 'noop-already-in-sync' as const });
    });

    const { unmount } = render(<VaultMetaConvergeRunner />);

    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    });

    // Coalesced into pendingRecheck: no second pass starts while one is in flight.
    fireEvent.focus(window);
    expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);

    unmount();

    resolveFirstPass?.({
      kind: 'adoption-superseded',
      change: 'passphrase',
      reason: 'wrapping-moved',
    });

    await waitFor(() => {
      expect(mockReportMountSettled).toHaveBeenCalledTimes(1);
    });

    // The guard in the finally block drops the pending recheck once cancelled.
    expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    expect(mockToast).not.toHaveBeenCalled();
  });

  test('should record durable refusal when keep-local is chosen and save nothing or toast nothing', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        const decision = await options.prompt({
          change: 'passphrase',
          remote: {
            meta: makeRemoteMeta('keep-local'),
            etag: 'etag-keep-local',
          },
        });

        if (decision === 'keep-local') {
          return {
            kind: 'converged' as const,
            result: {
              kind: 'noop-declined' as const,
              change: 'passphrase' as const,
            },
          };
        }
        return {
          kind: 'converged' as const,
          result: { kind: 'noop-already-in-sync' as const },
        };
      },
    );

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');
    fireEvent.click(
      screen.getByRole('button', { name: 'Keep my current passphrase' }),
    );

    await waitFor(() => {
      expect(mockHandle.recordVaultMetaRefusal).toHaveBeenCalledWith({
        meta: expect.objectContaining({
          kdf_salt: 'keep-local-salt',
        }),
        change: 'passphrase',
        lifetime: 'durable',
      });
    });

    expect(mockHandle.saveVault).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  test('passphrase dialog still renders adopt button', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    arrangeMetaConvergeWithPrompt({});

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');

    // Adopt button should be present for passphrase
    expect(
      screen.getByRole('button', { name: 'Use the new passphrase' }),
    ).not.toBeNull();
  });

  test('recovery-key dialog still renders adopt button', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        await options.prompt({
          change: 'recovery-key',
          remote: {
            meta: makeRemoteMeta('recovery-key'),
            etag: 'etag-recovery-key',
          },
        });

        return {
          kind: 'converged' as const,
          result: { kind: 'noop-already-in-sync' as const },
        };
      },
    );

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');

    // Adopt button should be present for recovery-key
    expect(
      screen.getByRole('button', { name: 'Use the new recovery key' }),
    ).not.toBeNull();
  });

  test('should display recovery-key-specific copy when recovery-key diverged', async () => {
    const decisionResult: { current?: VaultMetaDecision } = {};
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        decisionResult.current = await options.prompt({
          change: 'recovery-key',
          remote: {
            meta: makeRemoteMeta('recovery-key-display'),
            etag: 'etag-recovery-key-display',
          },
        });

        return {
          kind: 'converged' as const,
          result: { kind: 'noop-already-in-sync' as const },
        };
      },
    );

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');

    // Should show recovery-key title, not passphrase title
    expect(
      screen.getByText('Your recovery key was changed on another device'),
    ).not.toBeNull();
    expect(
      screen.queryByText('Your passphrase was changed on another device'),
    ).toBeNull();

    // Should show recovery-key buttons
    expect(
      screen.getByRole('button', { name: 'Use the new recovery key' }),
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Keep my current recovery key' }),
    ).not.toBeNull();
  });

  test('should display different-vault dialog with correct copy and no adopt button', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        await options.prompt({
          change: 'different-vault',
          remote: {
            meta: makeRemoteMeta('different-vault'),
            etag: 'etag-different-vault',
          },
        });

        return {
          kind: 'converged' as const,
          result: { kind: 'noop-already-in-sync' as const },
        };
      },
    );

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');

    expect(
      screen.getByText('This device holds a different vault'),
    ).not.toBeNull();
    expect(
      screen.getByText(
        'The vault on the server was created separately from the one on this device.',
      ),
    ).not.toBeNull();

    // Crucially: no "use the new" button should be present (no adopt button for different-vault)
    expect(screen.queryByRole('button', { name: /use the new/i })).toBeNull();
  });

  test('different-vault dialog resolves defer when dismissed', async () => {
    const decisionResult: { current?: VaultMetaDecision } = {};
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        const decision = await options.prompt({
          change: 'different-vault',
          remote: {
            meta: makeRemoteMeta('different-vault-defer'),
            etag: 'etag-different-vault-defer',
          },
        });

        decisionResult.current = decision;
        if (decision === 'defer') {
          return {
            kind: 'converged' as const,
            result: {
              kind: 'noop-deferred' as const,
              change: 'different-vault' as const,
            },
          };
        }
        return {
          kind: 'converged' as const,
          result: { kind: 'noop-already-in-sync' as const },
        };
      },
    );

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(decisionResult.current).toBe('defer'));

    // No saveVault call
    expect(mockHandle.saveVault).not.toHaveBeenCalled();
    // No toast
    expect(mockToast).not.toHaveBeenCalled();
  });

  test('should resolve defer when unmounted while prompt pending', async () => {
    const decisionResult: { current?: VaultMetaDecision } = {};
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    arrangeMetaConvergeWithPrompt(decisionResult);

    const { unmount } = render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');

    unmount();

    await waitFor(() => expect(decisionResult.current).toBe('defer'));

    // Unmounting is this component going away, not a User declining. Recording
    // a refusal here would silence a question nobody was ever answered.
    expect(mockHandle.recordVaultMetaRefusal).not.toHaveBeenCalled();
  });

  test('per-User scoping: different users in same session each trigger meta converge independently', async () => {
    // User A: render and complete meta converge
    const handleA = createMockHandle('user-a');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: handleA,
    });

    arrangeNoPromptMetaConverge();

    const { unmount } = render(<VaultMetaConvergeRunner />);

    // Wait for user-a's converge to complete
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    });

    // Unmount and clear mock call count
    unmount();
    mockSettleVaultMeta.mockClear();

    // User B: render with a different owner in the same session
    const handleB = createMockHandle('user-b');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: handleB,
    });

    arrangeNoPromptMetaConverge();

    render(<VaultMetaConvergeRunner />);

    // Wait for user-b's converge to be called (should run because they are a different owner)
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    });
  });

  test('reports the mount-settle signal once the first pass finishes, prompt or not', async () => {
    const mockHandle = createMockHandle('user-a');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    arrangeNoPromptMetaConverge();

    render(<VaultMetaConvergeRunner />);

    await waitFor(() => {
      expect(mockReportMountSettled).toHaveBeenCalledTimes(1);
    });
  });

  test('reports the mount-settle signal again on a later pass, still a no-op signal-wise', async () => {
    const mockHandle = createMockHandle('user-a');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    arrangeNoPromptMetaConverge();
    render(<VaultMetaConvergeRunner />);

    await waitFor(() => {
      expect(mockReportMountSettled).toHaveBeenCalledTimes(1);
    });

    // A second pass — e.g. a focus event — reports again. Idempotent from
    // the marker's point of view, but this runner does not gate the call to
    // "first pass only".
    fireEvent.focus(window);
    await waitFor(() => {
      expect(mockReportMountSettled).toHaveBeenCalledTimes(2);
    });
  });

  test('does not re-ask the same wrapping after keep-local, and still asks about a genuinely different one', async () => {
    const mockHandle = createMockHandle('user-a');
    const decisionResult: { current?: VaultMetaDecision } = {};

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    // The pass always offers what it found and always asks. Whether that
    // question reaches the User is the runner's own decision, so the mock must
    // never make it here — a mock that skipped the prompt itself would assert
    // its own arrangement instead of the guard under test.
    const arrangePassOffering = (meta: VaultMetaV1) => {
      mockSettleVaultMeta.mockImplementation(
        async (options: SettleVaultMetaOptions) => {
          decisionResult.current = await options.prompt({
            change: 'passphrase',
            remote: { meta, etag: 'etag-1' },
          });

          return {
            kind: 'converged' as const,
            result: { kind: 'noop-already-in-sync' as const },
          };
        },
      );
    };

    const startPass = (meta: VaultMetaV1) => {
      mockSettleVaultMeta.mockClear();
      decisionResult.current = undefined;
      arrangePassOffering(meta);
      return render(<VaultMetaConvergeRunner />);
    };

    // First pass: the wrapping is unrefused, so it is asked about and declined.
    const firstPass = startPass(WRAPPING_A);

    await screen.findByRole('dialog');
    fireEvent.click(
      screen.getByRole('button', { name: 'Keep my current passphrase' }),
    );

    await waitFor(() => expect(decisionResult.current).toBe('keep-local'));
    expect(mockHandle.recordVaultMetaRefusal).toHaveBeenCalledWith({
      meta: WRAPPING_A,
      change: 'passphrase',
      lifetime: 'durable',
    });

    // Second pass, same wrapping: the pass itself is never suppressed — it runs
    // again and reaches the server — and the question it would have raised is
    // the one thing that does not happen.
    firstPass.unmount();
    const secondPass = startPass(WRAPPING_A);

    await waitFor(() => expect(decisionResult.current).toBe('defer'));
    expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    // The refusal already recorded is not re-recorded, and nothing about the
    // Vault is touched by declining to ask.
    expect(mockHandle.recordVaultMetaRefusal).toHaveBeenCalledTimes(1);
    expect(mockHandle.saveVault).not.toHaveBeenCalled();

    // Third pass, a genuinely different wrapping: the defect this replaces is a
    // boolean swallowing exactly this question for the rest of the session.
    secondPass.unmount();
    startPass(WRAPPING_B);

    expect(await screen.findByRole('dialog')).not.toBeNull();
    expect(mockHandle.isVaultMetaRefused).toHaveBeenLastCalledWith({
      meta: WRAPPING_B,
      change: 'passphrase',
    });
  });

  test('when settleVaultMeta resolves pushed-local-wrapping, no dialog is rendered and toast is not called', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockResolvedValue({
      kind: 'pushed-local-wrapping' as const,
    });

    render(<VaultMetaConvergeRunner />);

    // Verify no dialog is rendered
    await waitFor(() => {
      const dialog = screen.queryByRole('dialog');
      expect(dialog).toBeNull();
    });

    // Verify toast was not called
    expect(mockToast).not.toHaveBeenCalled();
  });

  test('when settleVaultMeta resolves pushed-local-wrapping, no dialog is rendered and second render does not call settleVaultMeta again', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockResolvedValue({
      kind: 'pushed-local-wrapping' as const,
    });

    const { rerender } = render(<VaultMetaConvergeRunner />);

    // Wait for first render to complete
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    });

    // Verify no dialog is rendered
    expect(screen.queryByRole('dialog')).toBeNull();

    // Clear mock call count and re-render with same owner
    mockSettleVaultMeta.mockClear();
    rerender(<VaultMetaConvergeRunner />);

    // Wait a bit, then verify settleVaultMeta was NOT called again
    // (because the effect is keyed on owner, not on some flag)
    await waitFor(
      () => {
        expect(mockSettleVaultMeta).not.toHaveBeenCalled();
      },
      { timeout: 500 },
    );
  });

  test('focus event triggers a second pass after first pass settles', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    // First pass: noop, no dialog
    arrangeNoPromptMetaConverge();

    render(<VaultMetaConvergeRunner />);

    // Wait for first pass to complete
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    });

    // Fire focus event
    fireEvent.focus(window);

    // Should call settleVaultMeta again
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(2);
    });
  });

  test('coalesce concurrent triggers: mount + immediate focus = one call initially, one after first resolves', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    // Mock settleVaultMeta to return a promise we control resolution of,
    // so we can fire a focus event while the first pass is still in flight.
    let resolveFirstPass: (() => void) | undefined;
    const firstPassPromise = new Promise<void>((resolve) => {
      resolveFirstPass = resolve;
    });

    mockSettleVaultMeta.mockImplementation(async () => {
      await firstPassPromise;
      return { kind: 'skipped-no-local-vault' as const };
    });

    render(<VaultMetaConvergeRunner />);

    // Mount calls settleVaultMeta once synchronously
    expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);

    // Fire focus event immediately while first pass is still pending
    fireEvent.focus(window);

    // Should still be only 1 call (coalesced into pendingRecheck)
    expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);

    // Resolve the first pass
    resolveFirstPass?.();

    // Now the coalesced follow-up pass should run, making it 2 total
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(2);
    });
  });

  test('terminal stop: settleVaultMeta resolves skipped-not-authenticated (bare) stops further passes', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockResolvedValue({
      kind: 'skipped-not-authenticated' as const,
    });

    render(<VaultMetaConvergeRunner />);

    // Wait for first pass
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    });

    // Fire focus event
    fireEvent.focus(window);

    // Should NOT call settleVaultMeta again (session is gone, stopped = true)
    await waitFor(
      () => {
        expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
      },
      { timeout: 500 },
    );

    // No toast should be shown (skipped-not-authenticated is a resolved result, not an error)
    expect(mockToast).not.toHaveBeenCalled();
  });

  test('terminal stop: settleVaultMeta resolves converged/skipped-not-authenticated (nested) stops further passes', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockResolvedValue({
      kind: 'converged' as const,
      result: { kind: 'skipped-not-authenticated' as const },
    });

    render(<VaultMetaConvergeRunner />);

    // Wait for first pass
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    });

    // Fire focus event
    fireEvent.focus(window);

    // Should NOT call settleVaultMeta again
    await waitFor(
      () => {
        expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
      },
      { timeout: 500 },
    );

    // No toast should be shown
    expect(mockToast).not.toHaveBeenCalled();
  });

  test('refusal on same mount: focus with same wrapping does not show dialog, but different wrapping does', async () => {
    const mockHandle = createMockHandle('user-a');
    const decisionResult: { current?: VaultMetaDecision } = {};

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    let passCount = 0;
    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        passCount++;

        if (passCount === 1) {
          // First pass: offer WRAPPING_A, let user decline
          decisionResult.current = await options.prompt({
            change: 'passphrase',
            remote: { meta: WRAPPING_A, etag: 'etag-1' },
          });
          return {
            kind: 'converged' as const,
            result: { kind: 'noop-already-in-sync' as const },
          };
        } else if (passCount === 2) {
          // Second pass (via focus): same WRAPPING_A, should be suppressed
          decisionResult.current = await options.prompt({
            change: 'passphrase',
            remote: { meta: WRAPPING_A, etag: 'etag-1' },
          });
          return {
            kind: 'converged' as const,
            result: { kind: 'noop-already-in-sync' as const },
          };
        } else {
          // Third pass (via focus): WRAPPING_B, should ask again
          decisionResult.current = await options.prompt({
            change: 'passphrase',
            remote: { meta: WRAPPING_B, etag: 'etag-2' },
          });
          return {
            kind: 'converged' as const,
            result: { kind: 'noop-already-in-sync' as const },
          };
        }
      },
    );

    render(<VaultMetaConvergeRunner />);

    // First pass: dialog shown for WRAPPING_A
    let dialog = await screen.findByRole('dialog');
    expect(dialog).not.toBeNull();

    // User declines (keep-local)
    fireEvent.click(
      screen.getByRole('button', { name: 'Keep my current passphrase' }),
    );

    await waitFor(() => expect(decisionResult.current).toBe('keep-local'));
    expect(mockHandle.recordVaultMetaRefusal).toHaveBeenCalledWith({
      meta: WRAPPING_A,
      change: 'passphrase',
      lifetime: 'durable',
    });

    // Clear toast spy to verify no new toasts on subsequent passes
    mockToast.mockClear();

    // Second pass via focus: same WRAPPING_A should NOT show dialog
    fireEvent.focus(window);

    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(2);
    });

    // No dialog should be shown
    expect(screen.queryByRole('dialog')).toBeNull();

    // Third pass via focus: WRAPPING_B should show dialog
    fireEvent.focus(window);

    dialog = await screen.findByRole('dialog');
    expect(dialog).not.toBeNull();

    // Verify it's asking about the new wrapping
    expect(mockHandle.isVaultMetaRefused).toHaveBeenLastCalledWith({
      meta: WRAPPING_B,
      change: 'passphrase',
    });
  });

  test('dismissal + focus on same mount: session refusal suppresses dialog for same wrapping', async () => {
    const mockHandle = createMockHandle('user-a');
    const decisionResult: { current?: VaultMetaDecision } = {};

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        decisionResult.current = await options.prompt({
          change: 'passphrase',
          remote: { meta: WRAPPING_A, etag: 'etag-1' },
        });

        return {
          kind: 'converged' as const,
          result: { kind: 'noop-already-in-sync' as const },
        };
      },
    );

    render(<VaultMetaConvergeRunner />);

    // First pass: dialog shown
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toBeNull();

    // User dismisses (Escape)
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(decisionResult.current).toBe('defer'));

    // Session refusal was recorded
    expect(mockHandle.recordVaultMetaRefusal).toHaveBeenCalledWith({
      meta: WRAPPING_A,
      change: 'passphrase',
      lifetime: 'session',
    });

    // Clear for next phase
    mockToast.mockClear();
    mockSettleVaultMeta.mockClear();

    // Focus: same wrapping should NOT show dialog (session refusal is in effect)
    fireEvent.focus(window);

    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    });

    // No dialog should render
    expect(screen.queryByRole('dialog')).toBeNull();

    // No new toast
    expect(mockToast).not.toHaveBeenCalled();
  });

  test('transient error with no dialog: rejection is silent, next focus retries successfully', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    let passCount = 0;
    mockSettleVaultMeta.mockImplementation(async () => {
      passCount++;

      if (passCount === 1) {
        // First pass: reject before prompt is even called (transient network error)
        throw new Error('Network error');
      } else {
        // Second pass: resolve normally
        return { kind: 'skipped-no-local-vault' as const };
      }
    });

    render(<VaultMetaConvergeRunner />);

    // First pass rejects
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
    });

    // No toast should be shown (error happened before any prompt, so answeredChange is null)
    expect(mockToast).not.toHaveBeenCalled();

    // Retry via focus
    fireEvent.focus(window);

    // Second pass runs and succeeds
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(2);
    });

    // Still stopped = false, so component is still retryable
    // Verify by firing another focus and seeing it attempt a third call
    fireEvent.focus(window);

    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(3);
    });
  });

  test('failure after keep-local answer: rejection toasts with change-specific error', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    const error = new Error('Failed to record refusal');
    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        const decision = await options.prompt({
          change: 'passphrase',
          remote: {
            meta: makeRemoteMeta('error-test'),
            etag: 'etag-1',
          },
        });

        if (decision === 'keep-local') {
          // User answered, but now fail
          throw error;
        }

        return {
          kind: 'converged' as const,
          result: { kind: 'noop-already-in-sync' as const },
        };
      },
    );

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');
    fireEvent.click(
      screen.getByRole('button', { name: 'Keep my current passphrase' }),
    );

    // Wait for the rejection to be handled. `getHttpStatus` is mocked to
    // return `undefined`, so `getUserFacingErrorMessage` falls through to the
    // thrown Error's own `message` — asserted exactly, not just truthiness.
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Passphrase check failed',
          description: 'Failed to record refusal',
          variant: 'destructive',
        }),
      );
    });
  });

  test('failure after adopt-remote answer: rejection toasts with change-specific error', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    const error = new Error('Failed to save vault');
    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        const decision = await options.prompt({
          change: 'passphrase',
          remote: {
            meta: makeRemoteMeta('error-test'),
            etag: 'etag-1',
          },
        });

        if (decision === 'adopt-remote') {
          // User answered, but now fail
          throw error;
        }

        return {
          kind: 'converged' as const,
          result: { kind: 'noop-already-in-sync' as const },
        };
      },
    );

    render(<VaultMetaConvergeRunner />);

    await screen.findByRole('dialog');
    fireEvent.click(
      screen.getByRole('button', { name: 'Use the new passphrase' }),
    );

    // Wait for the rejection to be handled.
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Passphrase check failed',
          description: 'Failed to save vault',
          variant: 'destructive',
        }),
      );
    });
  });

  test('dismissal + rejection: no toast (answered change remains null)', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    const error = new Error('Unexpected failure');
    mockSettleVaultMeta.mockImplementation(
      async (options: SettleVaultMetaOptions) => {
        const decision = await options.prompt({
          change: 'passphrase',
          remote: {
            meta: makeRemoteMeta('dismiss-error-test'),
            etag: 'etag-1',
          },
        });

        if (decision === 'defer') {
          // User dismissed, but now fail (this models an edge case)
          throw error;
        }

        return {
          kind: 'converged' as const,
          result: { kind: 'noop-already-in-sync' as const },
        };
      },
    );

    render(<VaultMetaConvergeRunner />);

    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    // Wait for the rejection to be handled
    await waitFor(() => {
      // Even though rejection occurred, no toast because user dismissed (defer) not answered
      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  test('pass runs with vault (owner present, no lock state)', async () => {
    const mockHandle = createMockHandle('user-a');

    (useOptionalVaultSession as jest.Mock).mockReturnValue({
      handle: mockHandle,
    });

    arrangeNoPromptMetaConverge();

    render(<VaultMetaConvergeRunner />);

    // The effect runs because owner is present; lock state is not checked.
    // Mock handle has no lock concept, and settleVaultMeta is called regardless.
    await waitFor(() => {
      expect(mockSettleVaultMeta).toHaveBeenCalledTimes(1);
      expect(mockSettleVaultMeta).toHaveBeenCalledWith(
        expect.objectContaining({
          handle: mockHandle,
        }),
      );
    });
  });
});
