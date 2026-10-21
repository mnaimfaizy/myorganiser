/* eslint-disable import/first -- jest.mock must precede application imports */

// Mock useToast to prevent requirement for a Toaster in the tree
const mockUseToast = jest.fn();
jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: () => mockUseToast(),
}));

// Mock getCurrentUser to return a fixed test user
const mockGetCurrentUser = jest.fn();
jest.mock('@myorganiser/auth', () => ({
  ...jest.requireActual('@myorganiser/auth'),
  getCurrentUser: () => mockGetCurrentUser(),
}));

// Mock the Vault Absent Evidence network check — the *network* boundary, not the hook.
// Default to settled "server holds no vault" so the create panel is reachable.
const mockCheckVaultAbsentEvidence = jest.fn();
jest.mock('@myorganiser/web-vault', () => {
  const actual = jest.requireActual('@myorganiser/web-vault');
  return {
    ...actual,
    checkVaultAbsentEvidence: (args: unknown) =>
      mockCheckVaultAbsentEvidence(args),
  };
});

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useEffect } from 'react';

import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultGate } from './vaultGate';
import { VaultSessionProvider, useOptionalVaultSession } from './session';

const TEST_USER_ID = 'test-user-id';
const TEST_PASSPHRASE = 'testPass123456';
const RECOVERY_KEY_ACK_STORAGE_KEY = `myorganiser_recovery_key_acknowledgment_v1:${TEST_USER_ID}`;

const gateChildren = () => (
  <div data-testid="children">Tasks Content (unlocked)</div>
);

function renderVaultGate(options?: {
  captureHandle?: (h: VaultHandle | null) => void;
}) {
  return render(
    <VaultSessionProvider>
      {options?.captureHandle ? (
        <HandleCapture onHandle={options.captureHandle} />
      ) : null}
      <VaultGate title="Tasks">{gateChildren}</VaultGate>
    </VaultSessionProvider>,
  );
}

async function waitForCreatePanel(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.getByText(/Tasks: Set encryption passphrase/),
    ).toBeInTheDocument();
  });
}

async function fillPassphraseAndCreate(): Promise<void> {
  const passphraseInput = screen.getByLabelText(
    'Encryption passphrase',
  ) as HTMLInputElement;
  const confirmInput = screen.getByLabelText(
    'Confirm passphrase',
  ) as HTMLInputElement;
  fireEvent.change(passphraseInput, {
    target: { value: TEST_PASSPHRASE },
  });
  fireEvent.change(confirmInput, {
    target: { value: TEST_PASSPHRASE },
  });
  fireEvent.click(
    screen.getByRole('button', { name: /Create encrypted vault/ }),
  );
}

async function waitForRecoveryKeyPanel(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.getByLabelText(/Recovery key \(save this\)/),
    ).toBeInTheDocument();
  });
}

async function createVaultThroughGate(): Promise<void> {
  await waitForCreatePanel();
  await fillPassphraseAndCreate();
  await waitForRecoveryKeyPanel();
}

async function unlockWithPassphrase(): Promise<void> {
  const unlockInput = screen.getByLabelText(
    /Encryption passphrase/,
  ) as HTMLInputElement;
  fireEvent.change(unlockInput, {
    target: { value: TEST_PASSPHRASE },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }));
  await waitFor(() => {
    expect(screen.getByTestId('children')).toBeInTheDocument();
  });
}

/**
 * Helper component to capture the vault handle from the session context.
 * Used to spy on handle methods in tests.
 */
function HandleCapture({
  onHandle,
}: {
  onHandle: (handle: VaultHandle | null) => void;
}) {
  const session = useOptionalVaultSession();
  useEffect(() => {
    onHandle(session?.handle ?? null);
  }, [session?.handle, onHandle]);
  return null;
}

describe('VaultGate (create recovery key flow)', () => {
  let toastFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    // Default setup: user is signed in
    mockGetCurrentUser.mockReturnValue({ id: TEST_USER_ID });

    // Default setup: toast function
    toastFn = jest.fn();
    mockUseToast.mockReturnValue({ toast: toastFn });

    // Default setup: server holds no vault for this user
    mockCheckVaultAbsentEvidence.mockResolvedValue({
      kind: 'no-server-vault',
    });
  });

  /**
   * Test 1 (happy path): Absent device, evidence settled to "no server vault"
   * → create panel renders. Fill passphrase and confirm, click "Create encrypted vault"
   * → Recovery Key input and "I saved it" button become visible.
   */
  test('happy path: create panel renders, create is clicked, recovery key panel appears', async () => {
    // Arrange: Render the gate over a real vault handle and session
    render(
      <VaultSessionProvider>
        <VaultGate title="Tasks">
          {() => <div data-testid="children">Tasks: unlocked</div>}
        </VaultGate>
      </VaultSessionProvider>,
    );

    // Act: Wait for the create panel to appear (evidence check to settle)
    await waitFor(
      () => {
        expect(
          screen.getByText(/Tasks: Set encryption passphrase/),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Verify passphrase inputs are shown
    const passphraseInput = screen.getByLabelText(
      'Encryption passphrase',
    ) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(
      'Confirm passphrase',
    ) as HTMLInputElement;
    expect(passphraseInput).toBeInTheDocument();
    expect(confirmInput).toBeInTheDocument();

    // Act: Fill in the passphrase
    fireEvent.change(passphraseInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.change(confirmInput, {
      target: { value: TEST_PASSPHRASE },
    });

    // Verify the button is enabled
    const createButton = screen.getByRole('button', {
      name: /Create encrypted vault/,
    });
    expect(createButton).not.toBeDisabled();

    // Act: Click create and wait for the async initialize to complete
    fireEvent.click(createButton);

    // Assert: The "I saved it" button should appear after initialize completes
    // Recovery key showing is the indicator that initialize succeeded
    await waitFor(
      () => {
        // Look for the title text that appears with recovery key panel
        expect(
          screen.getByText(/Tasks: Save your recovery key/),
        ).toBeInTheDocument();
      },
      { timeout: 10000 },
    );

    // The save screen's title is the page's only level 1 heading (VaultGateFrame).
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Tasks: Save your recovery key/,
      }),
    ).toBeInTheDocument();

    // Verify the "I saved it" button appears
    expect(
      screen.getByRole('button', { name: /I saved it/ }),
    ).toBeInTheDocument();

    // Verify we are no longer on the setup panel
    expect(
      screen.queryByText(/Tasks: Set encryption passphrase/),
    ).not.toBeInTheDocument();
  }, 15000);

  /**
   * Test 2 (the exact reported symptom): After create, the withheld copy
   * "Checking whether your vault is already on the server…" is NOT on screen.
   * That screen appearing here is the bug #667.
   */
  test('reported symptom: the "checking" screen does not appear after create', async () => {
    // Arrange
    render(
      <VaultSessionProvider>
        <VaultGate title="Tasks">
          {() => <div data-testid="children">Tasks: unlocked</div>}
        </VaultGate>
      </VaultSessionProvider>,
    );

    // Wait for create panel
    await waitFor(() => {
      expect(
        screen.getByText(/Tasks: Set encryption passphrase/),
      ).toBeInTheDocument();
    });

    // Fill and create
    const passphraseInput = screen.getByLabelText(
      'Encryption passphrase',
    ) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(
      'Confirm passphrase',
    ) as HTMLInputElement;
    fireEvent.change(passphraseInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.change(confirmInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Create encrypted vault/ }),
    );

    // Wait for recovery key to appear
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Recovery key \(save this\)/),
      ).toBeInTheDocument();
    });

    // Assert: The checking screen text should NOT appear
    expect(
      screen.queryByText(
        /Checking whether your vault is already on the server/,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Getting your vault back/),
    ).not.toBeInTheDocument();
  }, 15000);

  /**
   * Test 3 (side effect): After create, storage really holds this owner's Vault.
   * The handle reports 'owned' and the owner-keyed record exists.
   * The status genuinely flipped; nothing is stubbed into place.
   */
  test('side effect: vault is written to storage and status is owned', async () => {
    // Arrange
    render(
      <VaultSessionProvider>
        <VaultGate title="Tasks">
          {() => <div data-testid="children">Tasks: unlocked</div>}
        </VaultGate>
      </VaultSessionProvider>,
    );

    // Wait for create panel
    await waitFor(
      () => {
        expect(
          screen.getByText(/Tasks: Set encryption passphrase/),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Fill and create
    const passphraseInput = screen.getByLabelText(
      'Encryption passphrase',
    ) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(
      'Confirm passphrase',
    ) as HTMLInputElement;
    fireEvent.change(passphraseInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.change(confirmInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Create encrypted vault/ }),
    );

    // Wait for recovery key panel to appear (indicating initialize succeeded)
    await waitFor(
      () => {
        expect(
          screen.getByText(/Tasks: Save your recovery key/),
        ).toBeInTheDocument();
      },
      { timeout: 10000 },
    );

    // Assert: Check localStorage for the vault record
    // The vault is stored under the key pattern: myorganiser_vault_v1:<owner-id>
    const vaultKey = `myorganiser_vault_v1:${TEST_USER_ID}`;
    const storedVault = localStorage.getItem(vaultKey);
    expect(storedVault).not.toBeNull();
    // It should be JSON-parseable and contain owner and wrapped keys
    const parsedVault = JSON.parse(storedVault!);
    expect(parsedVault).toHaveProperty('owner', TEST_USER_ID);
    expect(parsedVault).toHaveProperty('vault');
    expect(parsedVault.vault).toHaveProperty('masterKeyWrappedWithPassphrase');
    expect(parsedVault.vault.masterKeyWrappedWithPassphrase).toHaveProperty(
      'ciphertext',
    );
  }, 15000);

  /**
   * Test 4 (Acknowledgment blocks): While the Acknowledgment is owed,
   * the gate does NOT render its children, even though the vault status is now 'owned'.
   * Use a recognisable child node and assert its absence.
   */
  test('acknowledgment blocks: children are not rendered while recovery key is owed', async () => {
    // Arrange
    render(
      <VaultSessionProvider>
        <VaultGate title="Tasks">
          {() => <div data-testid="children">Tasks Content (unlocked)</div>}
        </VaultGate>
      </VaultSessionProvider>,
    );

    // Wait for create panel
    await waitFor(() => {
      expect(
        screen.getByText(/Tasks: Set encryption passphrase/),
      ).toBeInTheDocument();
    });

    // Fill and create
    const passphraseInput = screen.getByLabelText(
      'Encryption passphrase',
    ) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(
      'Confirm passphrase',
    ) as HTMLInputElement;
    fireEvent.change(passphraseInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.change(confirmInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Create encrypted vault/ }),
    );

    // Wait for recovery key to appear
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Recovery key \(save this\)/),
      ).toBeInTheDocument();
    });

    // Assert: Children should NOT be rendered while acknowledgment is owed
    expect(screen.queryByTestId('children')).not.toBeInTheDocument();
    expect(screen.queryByText(/Tasks Content/)).not.toBeInTheDocument();
  }, 15000);

  /**
   * Test 5 (acknowledging advances): Clicking "I saved it" clears the Acknowledgment
   * and the gate leaves that screen. The Recovery Key is gone and the unlock panel
   * is reachable. The session is still locked, so children still must not render.
   */
  test('acknowledging advances: clicking I saved it shows unlock panel, not children', async () => {
    // Arrange
    render(
      <VaultSessionProvider>
        <VaultGate title="Tasks">
          {() => <div data-testid="children">Tasks Content (unlocked)</div>}
        </VaultGate>
      </VaultSessionProvider>,
    );

    // Wait for create panel and create
    await waitFor(() => {
      expect(
        screen.getByText(/Tasks: Set encryption passphrase/),
      ).toBeInTheDocument();
    });

    const passphraseInput = screen.getByLabelText(
      'Encryption passphrase',
    ) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(
      'Confirm passphrase',
    ) as HTMLInputElement;
    fireEvent.change(passphraseInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.change(confirmInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Create encrypted vault/ }),
    );

    // Wait for recovery key
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Recovery key \(save this\)/),
      ).toBeInTheDocument();
    });

    // Act: Click "I saved it"
    const savedButton = screen.getByRole('button', { name: /I saved it/ });
    fireEvent.click(savedButton);

    // Assert: Recovery key input should be gone
    await waitFor(() => {
      expect(
        screen.queryByLabelText(/Recovery key \(save this\)/),
      ).not.toBeInTheDocument();
    });

    // Unlock panel should be shown (passphrase unlock input)
    expect(screen.getByLabelText(/Encryption passphrase/)).toBeInTheDocument();
    expect(screen.getByText(/Tasks: Unlock/)).toBeInTheDocument();

    // Children still not rendered (session is locked)
    expect(screen.queryByTestId('children')).not.toBeInTheDocument();
  }, 15000);

  /**
   * Test 6 (remount persistence — issue #668): Unmount and remount after create
   * without in-session acknowledgment. The pending record survives; the banner
   * replaces the hard-gate recovery key panel on the unlock screen.
   */
  test('remount persistence: locked banner appears without recovery key panel', async () => {
    const { unmount } = renderVaultGate();

    await createVaultThroughGate();

    expect(localStorage.getItem(RECOVERY_KEY_ACK_STORAGE_KEY)).not.toBeNull();

    unmount();
    renderVaultGate();

    await waitFor(() => {
      expect(
        screen.getByTestId('unacknowledged-recovery-key-banner'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId('unacknowledged-recovery-key-fact'),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Recovery key \(save this\)/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('unacknowledged-recovery-key-rotate-link'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        'unacknowledged-recovery-key-already-have-it-button',
      ),
    ).not.toBeInTheDocument();

    expect(screen.getByText(/Tasks: Unlock/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Encryption passphrase/)).toBeInTheDocument();
    expect(screen.queryByTestId('children')).not.toBeInTheDocument();
  }, 15000);

  /**
   * Test 6b: After remount, unlocking shows the unlocked banner with rotate
   * and "I already have it" actions above the children.
   */
  test('remount persistence: unlock while owed shows unlocked banner with actions', async () => {
    const { unmount } = renderVaultGate();

    await createVaultThroughGate();
    unmount();
    renderVaultGate();

    await waitFor(() => {
      expect(
        screen.getByTestId('unacknowledged-recovery-key-banner'),
      ).toBeInTheDocument();
    });

    await unlockWithPassphrase();

    expect(
      screen.getByTestId('unacknowledged-recovery-key-banner'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('unacknowledged-recovery-key-rotate-link'),
    ).toHaveAttribute('href', '/dashboard/vault');
    expect(
      screen.getByTestId('unacknowledged-recovery-key-already-have-it-button'),
    ).toBeInTheDocument();
  }, 15000);

  /**
   * Test 6c: Confirming "I already have it" on the unlocked banner clears
   * the reminder and removes the durable acknowledgment record.
   */
  test('remount persistence: confirming I already have it clears banner and ack record', async () => {
    const { unmount } = renderVaultGate();

    await createVaultThroughGate();
    unmount();
    renderVaultGate();

    await waitFor(() => {
      expect(
        screen.getByTestId('unacknowledged-recovery-key-banner'),
      ).toBeInTheDocument();
    });

    await unlockWithPassphrase();

    fireEvent.click(
      screen.getByTestId('unacknowledged-recovery-key-already-have-it-button'),
    );

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /I already have it/ }),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId('unacknowledged-recovery-key-banner'),
      ).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(RECOVERY_KEY_ACK_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('children')).toBeInTheDocument();
  }, 15000);

  /**
   * Test 6d: A recovery wrapping change retires a stale acknowledgment without
   * the User confirming they already hold the key.
   */
  test('remount persistence: different recovery wrapping retires stale banner', async () => {
    let capturedHandle: VaultHandle | null = null;

    const { unmount } = renderVaultGate({
      captureHandle: (handle) => {
        capturedHandle = handle;
      },
    });

    await createVaultThroughGate();
    unmount();

    renderVaultGate({
      captureHandle: (handle) => {
        capturedHandle = handle;
      },
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('unacknowledged-recovery-key-banner'),
      ).toBeInTheDocument();
    });

    expect(capturedHandle).not.toBeNull();
    const sessionHandle = capturedHandle as unknown as VaultHandle;
    const vault = sessionHandle.loadVault();
    expect(vault).not.toBeNull();

    await act(async () => {
      sessionHandle.saveVault({
        ...vault!,
        masterKeyWrappedWithRecoveryKey: {
          iv: 'ZGlmZmVyZW50LXY=',
          ciphertext: 'ZGlmZmVyZW50LWN0',
        },
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId('unacknowledged-recovery-key-banner'),
      ).not.toBeInTheDocument();
    });
  }, 15000);

  /**
   * Test 6e: In-session "I saved it" clears the record; a remount must not
   * resurrect the banner.
   */
  test('remount persistence: in-session I saved it prevents banner on remount', async () => {
    const { unmount } = renderVaultGate();

    await createVaultThroughGate();

    fireEvent.click(screen.getByRole('button', { name: /I saved it/ }));

    await waitFor(() => {
      expect(
        screen.queryByLabelText(/Recovery key \(save this\)/),
      ).not.toBeInTheDocument();
    });

    expect(localStorage.getItem(RECOVERY_KEY_ACK_STORAGE_KEY)).toBeNull();

    unmount();
    renderVaultGate();

    await waitFor(() => {
      expect(screen.getByText(/Tasks: Unlock/)).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId('unacknowledged-recovery-key-banner'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Recovery key \(save this\)/),
    ).not.toBeInTheDocument();
  }, 15000);

  /**
   * Test 7 (security): The Recovery Key string shown on screen appears
   * NOWHERE in localStorage or sessionStorage. Scan every key and value
   * after create. The Recovery Key is held in memory only.
   */
  test('security: recovery key is not stored in localStorage or sessionStorage', async () => {
    // Arrange
    render(
      <VaultSessionProvider>
        <VaultGate title="Tasks">
          {() => <div data-testid="children">Tasks: unlocked</div>}
        </VaultGate>
      </VaultSessionProvider>,
    );

    // Wait for create panel
    await waitFor(() => {
      expect(
        screen.getByText(/Tasks: Set encryption passphrase/),
      ).toBeInTheDocument();
    });

    // Fill and create
    const passphraseInput = screen.getByLabelText(
      'Encryption passphrase',
    ) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(
      'Confirm passphrase',
    ) as HTMLInputElement;
    fireEvent.change(passphraseInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.change(confirmInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Create encrypted vault/ }),
    );

    // Wait for recovery key to appear
    let recoveryKeyValue: string | null = null;
    await waitFor(() => {
      const input = screen.getByLabelText(
        /Recovery key \(save this\)/,
      ) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      recoveryKeyValue = input.value;
      // Pinned to the real shape rather than truthiness. The scan below looks
      // for this string inside every stored value, and `toContain('')` is
      // true of everything — so a blank or stub key would make the whole
      // security assertion vacuous. A minted Recovery Key is base64.
      expect(recoveryKeyValue).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    });

    // Assert: The recovery key value should not appear in any storage
    expect(recoveryKeyValue).toMatch(/^[A-Za-z0-9+/=]{20,}$/);

    const ackRaw = localStorage.getItem(RECOVERY_KEY_ACK_STORAGE_KEY);
    expect(ackRaw).not.toBeNull();
    const ackRecord = JSON.parse(ackRaw!);
    expect(ackRecord).toHaveProperty('wrappingHash');
    expect(ackRecord).not.toHaveProperty('recoveryKey');
    expect(ackRaw).not.toContain(recoveryKeyValue);

    // Scan all localStorage entries
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key!);
      expect(value).not.toContain(recoveryKeyValue);
    }

    // Scan all sessionStorage entries
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const value = sessionStorage.getItem(key!);
      expect(value).not.toContain(recoveryKeyValue);
    }
  }, 15000);

  /**
   * Test 8 (error path — evidence check): checkVaultAbsentEvidence rejects
   * (network error) → settled as postponed → cannot-check screen shown.
   * Create panel is never reached; no Recovery Key or Acknowledgment shown.
   */
  test('evidence failure: cannot check the server leaves user on error screen', async () => {
    // Arrange: Mock evidence check failure
    mockCheckVaultAbsentEvidence.mockRejectedValueOnce(
      new Error('Network error'),
    );

    render(
      <VaultSessionProvider>
        <VaultGate title="Tasks">
          {() => <div data-testid="children">Tasks: unlocked</div>}
        </VaultGate>
      </VaultSessionProvider>,
    );

    // Asserts one screen, not "either of two". The disjunction this replaces
    // (`expect(text || setupText).toBeInTheDocument()`) passed whether the
    // refusal held or was silently swallowed and the create panel rendered —
    // the opposite outcome — so it could not fail for the reason it existed.
    await waitFor(() => {
      expect(
        screen.getByText(/We could not reach the server/),
      ).toBeInTheDocument();
    });

    // The point of the branch: a server that could not be checked offers no
    // create. Withholding it is exactly what slice #647 added, so this must be
    // asserted rather than tolerated.
    expect(
      screen.queryByText(/Tasks: Set encryption passphrase/),
    ).not.toBeInTheDocument();

    // Verify no recovery key is shown
    expect(
      screen.queryByText(/Tasks: Save your recovery key/),
    ).not.toBeInTheDocument();
  }, 10000);

  /**
   * Test 9 (error path — initialize failure): initialize rejects
   * (passphrase policy failure from crypto operations).
   * Error toast fires, create panel remains, no Recovery Key or Acknowledgment shown.
   * User can try again.
   */
  test('initialize failure: error toast shown, create panel remains, no recovery key shown', async () => {
    // Arrange: Capture the handle to spy on initialize
    let capturedHandle: VaultHandle | null = null;

    render(
      <VaultSessionProvider>
        <HandleCapture
          onHandle={(h) => {
            capturedHandle = h;
          }}
        />
        <VaultGate title="Tasks">
          {() => <div data-testid="children">Tasks: unlocked</div>}
        </VaultGate>
      </VaultSessionProvider>,
    );

    // Wait for create panel
    await waitFor(
      () => {
        expect(
          screen.getByText(/Tasks: Set encryption passphrase/),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Fill passphrase
    const passphraseInput = screen.getByLabelText(
      'Encryption passphrase',
    ) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(
      'Confirm passphrase',
    ) as HTMLInputElement;
    fireEvent.change(passphraseInput, {
      target: { value: TEST_PASSPHRASE },
    });
    fireEvent.change(confirmInput, {
      target: { value: TEST_PASSPHRASE },
    });

    // Spy on initialize to reject once.
    //
    // Asserted rather than guarded with `if`: a silent skip would leave the
    // arrangement undone and the create would succeed, failing this test on a
    // missing error toast rather than on the handle never arriving.
    //
    // `mockImplementationOnce` rather than `mockRejectedValueOnce` — the latter
    // types its parameter `never` here, which is the compile error this
    // replaces. Scoped to one call, so every other test in this file keeps the
    // real `initialize`; `vaultStatus` is never stubbed anywhere.
    // The cast goes through `unknown` because TypeScript's control-flow
    // analysis narrows this closure-assigned `let` to `null` — it cannot see
    // the render callback that fills it. The `expect` above is what actually
    // establishes it is there.
    expect(capturedHandle).not.toBeNull();
    const sessionHandle = capturedHandle as unknown as VaultHandle;
    jest
      .spyOn(sessionHandle, 'initialize')
      .mockImplementationOnce(() =>
        Promise.reject(new Error('Passphrase policy failure')),
      );

    // Act: Click create
    fireEvent.click(
      screen.getByRole('button', { name: /Create encrypted vault/ }),
    );

    // Assert: Error toast fires
    await waitFor(
      () => {
        expect(toastFn).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Failed to create vault',
            variant: 'destructive',
          }),
        );
      },
      { timeout: 5000 },
    );

    // Create panel still showing (user can try again)
    expect(
      screen.getByText(/Tasks: Set encryption passphrase/),
    ).toBeInTheDocument();

    // No recovery key panel shown
    expect(
      screen.queryByText(/Tasks: Save your recovery key/),
    ).not.toBeInTheDocument();

    // No "I saved it" button (no acknowledgment owed)
    expect(
      screen.queryByRole('button', { name: /I saved it/ }),
    ).not.toBeInTheDocument();
  }, 15000);
});
