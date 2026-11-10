/* eslint-disable import/first -- jest.mock must precede application imports */

const mockUseToast = jest.fn();
jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: () => mockUseToast(),
}));

// State sources for the session mock: the gate reads claimEvidence and
// absentEvidence from the session, not from the hooks.
const mockUseVaultClaimEvidence = jest.fn();
const mockUseVaultAbsentEvidence = jest.fn();

const mockUseOptionalVaultSession = jest.fn();
jest.mock('./session', () => {
  return {
    useOptionalVaultSession: () => {
      const session = mockUseOptionalVaultSession();
      if (!session) return null;
      // Augment the session mock with evidence read from the hook mocks.
      // The gate now reads evidence from the session, not the hooks.
      return {
        ...session,
        claimEvidence: mockUseVaultClaimEvidence(session.handle),
        absentEvidence: mockUseVaultAbsentEvidence(session.handle),
      };
    },
  };
});

const mockUseLocalVaultRevision = jest.fn();
jest.mock('./useLocalVaultRevision', () => ({
  useLocalVaultRevision: () => mockUseLocalVaultRevision(),
}));

const mockClaimUnclaimedLocalVaultWithRecoveryKey = jest.fn();
const mockReplaceOwnedLocalVaultOnEvidence = jest.fn();
const mockReplaceOwnedLocalVaultWithRecoveryKey = jest.fn();
const mockExportVault = jest.fn();
const mockCreateDefaultAuditReporter = jest.fn();

jest.mock('@myorganiser/web-vault', () => ({
  ...jest.requireActual('@myorganiser/web-vault'),
  claimUnclaimedLocalVaultWithRecoveryKey: (args: unknown) =>
    mockClaimUnclaimedLocalVaultWithRecoveryKey(args),
  replaceOwnedLocalVaultOnEvidence: (args: unknown) =>
    mockReplaceOwnedLocalVaultOnEvidence(args),
  replaceOwnedLocalVaultWithRecoveryKey: (args: unknown) =>
    mockReplaceOwnedLocalVaultWithRecoveryKey(args),
  exportVault: (args: unknown) => mockExportVault(args),
  createDefaultAuditReporter: (...args: unknown[]) =>
    mockCreateDefaultAuditReporter(...args),
}));

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

// Import real VaultSecretMismatchError so instanceof checks work
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { VaultSecretMismatchError } from '@myorganiser/web-vault';
import type { VaultHandle } from '@myorganiser/web-vault';

import { VaultGate } from './vaultGate';

describe('VaultGate', () => {
  let toastFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    toastFn = jest.fn();
    mockUseToast.mockReturnValue({ toast: toastFn });
    mockUseOptionalVaultSession.mockReturnValue(null);
    // Default mock returns for evidence. When session is null, the gate uses
    // the fallback constants: claimEvidence = CLAIM_EVIDENCE_WITHOUT_OWNER
    // (settled, skipped-nothing-to-claim) and absentEvidence =
    // ABSENT_EVIDENCE_WITHOUT_OWNER (checking). These mocks drive the evidence
    // when a session is present.
    mockUseVaultClaimEvidence.mockReturnValue({ status: 'checking' });
    mockUseVaultAbsentEvidence.mockReturnValue({
      status: 'settled',
      result: { kind: 'no-server-vault' },
    });
    mockUseLocalVaultRevision.mockReturnValue(0);
  });

  function createStubHandle(overrides?: Partial<VaultHandle>): VaultHandle {
    return {
      owner: 'user-1',
      isUnlocked: false,
      hasVault: jest.fn(() => true),
      vaultStatus: jest.fn(() => 'absent'),
      hasUnclaimedLocalVault: jest.fn(() => true),
      loadVault: jest.fn(() => null),
      saveVault: jest.fn(),
      initialize: jest.fn(),
      claimUnclaimedLocalVaultLocked: jest.fn(),
      unlockWithPassphrase: jest.fn(),
      unlockWithRecoveryKey: jest.fn(),
      changePassphrase: jest.fn(),
      resetPassphrase: jest.fn(),
      loadDecryptedData: jest.fn(),
      loadDecryptedDataWithCiphertext: jest.fn(),
      saveEncryptedData: jest.fn(),
      isRecoveryKeyUnacknowledged: jest.fn().mockResolvedValue(false),
      acknowledgeRecoveryKey: jest.fn(),
      ...overrides,
    } as unknown as VaultHandle;
  }

  describe('three-state resolution', () => {
    test('should render unlock panel when vaultStatus is "owned"', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Test: Set encryption passphrase/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/A vault is already on this device/),
      ).not.toBeInTheDocument();
    });

    test('should render create panel when vaultStatus is "absent"', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByText(/Test: Set encryption passphrase/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/A vault is already on this device/),
      ).not.toBeInTheDocument();
    });

    test('should render checking message and no passphrase input when unclaimed and evidence check is in flight', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({ status: 'checking' });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByText(/Setting up your vault on this device/),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/A vault is already on this device/),
      ).not.toBeInTheDocument();
    });

    test('should render unlock panel when unclaimed and evidence settled with claimed result', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'claimed' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/A vault is already on this device/),
      ).not.toBeInTheDocument();
    });

    test('should render could not check card when unclaimed and evidence settled with postponed result', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'postponed' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: 'We could not reach the server',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/We could not reach the server/),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Create encrypted vault/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/A vault is already on this device/),
      ).not.toBeInTheDocument();
    });

    test('should render sign in again card when unclaimed and evidence settled with session-lost result', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'session-lost' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Please sign in again' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Please sign in again/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Create encrypted vault/ }),
      ).not.toBeInTheDocument();
    });

    test('should render setup panel when unclaimed and evidence settled with refused-not-this-vault result', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'refused-not-this-vault' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByText(/Test: Set encryption passphrase/),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/A vault is already on this device/),
      ).not.toBeInTheDocument();
    });

    test('should render setup panel when unclaimed and evidence settled with no-evidence result', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'no-evidence' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByText(/Test: Set encryption passphrase/),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/A vault is already on this device/),
      ).not.toBeInTheDocument();
    });

    test('should render create panel when vaultStatus is "owner-mismatch"', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owner-mismatch'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByText(/Test: Set encryption passphrase/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/A vault is already on this device/),
      ).not.toBeInTheDocument();
    });

    test('should render children when masterKeyBytes is present', () => {
      const masterKeyBytes = new Uint8Array([1, 2, 3, 4]);
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(
        <VaultGate title="Test">
          {(ctx) => <div>unlocked-{ctx.handle ? 'yes' : 'no'}</div>}
        </VaultGate>,
      );

      expect(screen.getByText(/unlocked-yes/)).toBeInTheDocument();
      expect(
        screen.queryByText(/Test: Set encryption passphrase/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('failure copy and error handling', () => {
    test('should show secret mismatch toast without corruption language when unlock fails with wrong passphrase', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        unlockWithPassphrase: jest
          .fn()
          .mockRejectedValue(new VaultSecretMismatchError('passphrase')),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(
        <VaultGate title="MyVault">{() => <div>children</div>}</VaultGate>,
      );

      // Fill passphrase and try to unlock
      const passphraseInput = screen.getByLabelText(
        'Passphrase',
      ) as HTMLInputElement;
      fireEvent.change(passphraseInput, { target: { value: 'gate-pass-1' } });

      const unlockButton = screen.getByRole('button', { name: /Unlock/ });
      fireEvent.click(unlockButton);

      // Verify error toast is shown
      await waitFor(() => {
        expect(toastFn).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "That passphrase didn't unlock this vault",
            description: expect.stringContaining('does not match this vault'),
            variant: 'destructive',
          }),
        );
      });

      // Verify no corruption language in toast message
      const toastCall = toastFn.mock.calls.find(
        (call) => call[0].title === "That passphrase didn't unlock this vault",
      );
      if (toastCall) {
        const toastText =
          `${toastCall[0].title} ${toastCall[0].description}`.toLowerCase();
        expect(toastText).not.toMatch(
          /corrupt|damaged|reset|wipe|delete|start over/i,
        );
      }
    });

    test('should show secret mismatch toast without corruption language when recovery fails with wrong recovery key', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        unlockWithRecoveryKey: jest
          .fn()
          .mockRejectedValue(new VaultSecretMismatchError('recovery-key')),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(
        <VaultGate title="MyVault">{() => <div>children</div>}</VaultGate>,
      );

      // Click "Forgot it? Use your Recovery Key" to switch to recovery
      const forgotButton = screen.getByRole('button', {
        name: 'Forgot it? Use your Recovery Key',
      });
      fireEvent.click(forgotButton);

      // Fill recovery key and try to recover
      const recoveryInput = screen.getByLabelText(
        'Recovery key',
      ) as HTMLInputElement;
      fireEvent.change(recoveryInput, { target: { value: 'gate-recover-1' } });

      const recoverButton = screen.getByRole('button', {
        name: /Unlock with recovery key/i,
      });
      fireEvent.click(recoverButton);

      // Verify error toast is shown
      await waitFor(() => {
        expect(toastFn).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "That recovery key didn't unlock this vault",
            description: expect.stringContaining('does not match this vault'),
            variant: 'destructive',
          }),
        );
      });

      // Verify no corruption language in toast message
      const toastCall = toastFn.mock.calls.find(
        (call) =>
          call[0].title === "That recovery key didn't unlock this vault",
      );
      if (toastCall) {
        const toastText =
          `${toastCall[0].title} ${toastCall[0].description}`.toLowerCase();
        expect(toastText).not.toMatch(
          /corrupt|damaged|reset|wipe|delete|start over/i,
        );
      }
    });

    test('should show fixed toast without error message when unlock fails with non-mismatch error', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        unlockWithPassphrase: jest.fn().mockRejectedValue(new Error('boom')),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(
        <VaultGate title="MyVault">{() => <div>children</div>}</VaultGate>,
      );

      const passphraseInput = screen.getByLabelText(
        'Passphrase',
      ) as HTMLInputElement;
      fireEvent.change(passphraseInput, { target: { value: 'gate-pass-1' } });

      const unlockButton = screen.getByRole('button', { name: /Unlock/ });
      fireEvent.click(unlockButton);

      await waitFor(() => {
        expect(toastFn).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Unlock failed',
            description:
              'Something went wrong. Nothing on this device was changed.',
            variant: 'destructive',
          }),
        );
      });

      // Ensure error message does not leak
      const toastCall = toastFn.mock.calls.find(
        (call) => call[0].title === 'Unlock failed',
      );
      if (toastCall) {
        expect(toastCall[0].description).not.toContain('boom');
      }
    });

    test('should show fixed toast without error message when recovery fails with non-mismatch error', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        unlockWithRecoveryKey: jest.fn().mockRejectedValue(new Error('boom')),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(
        <VaultGate title="MyVault">{() => <div>children</div>}</VaultGate>,
      );

      const forgotButton = screen.getByRole('button', {
        name: 'Forgot it? Use your Recovery Key',
      });
      fireEvent.click(forgotButton);

      const recoveryInput = screen.getByLabelText(
        'Recovery key',
      ) as HTMLInputElement;
      fireEvent.change(recoveryInput, { target: { value: 'gate-recover-1' } });

      const recoverButton = screen.getByRole('button', {
        name: /Unlock with recovery key/i,
      });
      fireEvent.click(recoverButton);

      await waitFor(() => {
        expect(toastFn).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Recovery failed',
            description:
              'Something went wrong. Nothing on this device was changed.',
            variant: 'destructive',
          }),
        );
      });

      // Ensure error message does not leak
      const toastCall = toastFn.mock.calls.find(
        (call) => call[0].title === 'Recovery failed',
      );
      if (toastCall) {
        expect(toastCall[0].description).not.toContain('boom');
      }
    });
  });

  describe('handle identity change recovery', () => {
    test('should show unlock panel not create panel when handle changes from absent to owned status', () => {
      const handleAbsent = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      const handleOwned = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });

      // Initially render with handle whose vaultStatus is 'absent'
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle: handleAbsent,
      });

      const { rerender } = render(
        <VaultGate title="MyVault">{() => <div>children</div>}</VaultGate>,
      );

      // Initially shows create panel because vaultStatus is 'absent'
      expect(
        screen.getByText(/MyVault: Set encryption passphrase/),
      ).toBeInTheDocument();

      // Rerender with handle now owned
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle: handleOwned,
      });

      rerender(
        <VaultGate title="MyVault">{() => <div>children</div>}</VaultGate>,
      );

      // Must show unlock panel after handle change
      expect(
        screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).toBeInTheDocument();

      // Must NOT show create panel — this is the whole point of the fix
      expect(
        screen.queryByText(/MyVault: Set encryption passphrase/),
      ).not.toBeInTheDocument();
    });

    test('should show unlock panel when local vault revision changes without handle identity change (reconcile scenario)', () => {
      const handle = createStubHandle({
        vaultStatus: jest
          .fn()
          .mockReturnValueOnce('absent')
          .mockReturnValue('owned'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultAbsentEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'no-server-vault' },
      });
      mockUseLocalVaultRevision.mockReturnValue(0);

      const { rerender } = render(
        <VaultGate title="MyVault">{() => <div>children</div>}</VaultGate>,
      );

      // Initially shows create panel because vaultStatus is 'absent' and absent
      // evidence is settled to no-server-vault
      expect(
        screen.getByText(/MyVault: Set encryption passphrase/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).not.toBeInTheDocument();

      // Simulate Local Vault Revision bump (from VaultReconcileRunner's saveVault call).
      // The handle object identity stays the same; only the revision changes.
      // This triggers the render-phase reset that re-reads vaultStatus().
      mockUseLocalVaultRevision.mockReturnValue(1);

      rerender(
        <VaultGate title="MyVault">{() => <div>children</div>}</VaultGate>,
      );

      // Must show unlock panel after revision change alone.
      // This proves the revision bump (without handle identity change) is sufficient
      // to trigger re-read of vaultStatus() and update the UI — the whole point of
      // Slice #647's render-phase reset.
      expect(
        screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).toBeInTheDocument();

      // Must NOT show create panel anymore
      expect(
        screen.queryByText(/MyVault: Set encryption passphrase/),
      ).not.toBeInTheDocument();
    });
  });

  describe('remount recovery key banner vs passphrase reset prompt', () => {
    const bannerText = /No Recovery Key was ever saved for this vault/;

    test('defers remount banner while passphrase reset prompt is owed and shows it once the prompt is answered', async () => {
      const masterKeyBytes = new Uint8Array([1, 2, 3, 4]);
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        isRecoveryKeyUnacknowledged: jest.fn().mockResolvedValue(true),
      });
      let passphraseResetPromptOwed = true;

      mockUseOptionalVaultSession.mockImplementation(() => ({
        masterKeyBytes,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
        passphraseResetPromptOwed,
      }));
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'skipped-already-owned' },
      });

      const view = render(
        <VaultGate title="Test">
          {(ctx) => <div>unlocked-{ctx.handle ? 'yes' : 'no'}</div>}
        </VaultGate>,
      );

      expect(screen.getByText(/unlocked-yes/)).toBeInTheDocument();

      await waitFor(() => {
        expect(
          screen.queryByTestId('unacknowledged-recovery-key-banner'),
        ).not.toBeInTheDocument();
      });

      passphraseResetPromptOwed = false;
      view.rerender(
        <VaultGate title="Test">
          {(ctx) => <div>unlocked-{ctx.handle ? 'yes' : 'no'}</div>}
        </VaultGate>,
      );

      expect(screen.getByText(/unlocked-yes/)).toBeInTheDocument();

      await waitFor(() => {
        expect(
          screen.getByTestId('unacknowledged-recovery-key-fact'),
        ).toHaveTextContent(bannerText);
      });
    });
  });

  describe('Guard — vaultGate does not host passphrase reset', () => {
    /**
     * Asserted against the source text rather than by driving dead UI.
     * Authorization now lives on the session unlock secret; the Vault page
     * hook is the caller of resetPassphraseAfterRecovery.
     *
     * What it protects: resetPassphraseAfterRecovery skips current-passphrase
     * verification and belongs on a surface that has recorded a recovery-key
     * unlock. changePassphraseWithCurrent belongs on a passphrase-unlocked
     * session. Neither belongs in VaultGate.
     */
    test('vaultGate.tsx does not reference passphrase reset or change entry points', () => {
      const source = readFileSync(join(__dirname, 'vaultGate.tsx'), 'utf8');

      expect(source).not.toContain('resetPassphraseAfterRecovery');
      expect(source).not.toContain('RecoverySetNewPassphraseForm');
      expect(source).not.toContain('Set a new passphrase');
      expect(source).not.toContain('changePassphraseWithCurrent');
    });
  });

  describe('gate screen headings (VaultGateFrame contract)', () => {
    const claimOfferName = /I have a recovery key for a vault on this device/;
    const unlockClaimOfferName =
      /I have a Recovery Key for a different vault on this device/;

    test('unlock screen has one level 1 heading "Unlock your vault" and renders the claim offer', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(<VaultGate title="Tasks">{() => <div>children</div>}</VaultGate>);

      await act(async () => {});

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: unlockClaimOfferName }),
      ).toBeInTheDocument();
    });

    test('create screen has one level 1 heading named "<title>: Set encryption passphrase" and renders the claim offer', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(<VaultGate title="Tasks">{() => <div>children</div>}</VaultGate>);

      await act(async () => {});

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: 'Tasks: Set encryption passphrase',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: claimOfferName }),
      ).toBeInTheDocument();
    });

    test('evidence-check screen uses the bare title as its only level 1 heading and renders the claim offer', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({ status: 'checking' });

      render(<VaultGate title="Tasks">{() => <div>children</div>}</VaultGate>);

      await act(async () => {});

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Tasks' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: claimOfferName }),
      ).toBeInTheDocument();
    });

    test('recover screen is titled "<title>: Recover" after the User picks Forgot it? Use your Recovery Key', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });

      render(<VaultGate title="Tasks">{() => <div>children</div>}</VaultGate>);

      await act(async () => {});

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Forgot it? Use your Recovery Key',
        }),
      );

      expect(
        screen.getByRole('heading', { level: 1, name: 'Tasks: Recover' }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('button', { name: unlockClaimOfferName }),
      ).toBeInTheDocument();
    });

    test('replace offer is titled "<title>: Replace this device\'s vault?" as its only level 1 heading', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'replace-offer' },
      });

      render(<VaultGate title="Tasks">{() => <div>children</div>}</VaultGate>);

      await act(async () => {});

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: "Tasks: Replace this device's vault?",
        }),
      ).toBeInTheDocument();
    });
  });

  describe('recovery key claim offer', () => {
    /**
     * Tests for the recovery-key half of the Claim Offer: the deliberate path
     * where a User says they hold a recovery key and supplies one, on a device
     * that may or may not hold an Unclaimed Local Vault.
     *
     * The load-bearing property: a correct recovery key on a device holding an
     * Unclaimed Local Vault produces the same observable state (same alert text,
     * no toast, no claim) as a wrong key on a device holding nothing. This means
     * the component offers the claim button whether or not an Unclaimed Local
     * Vault is present, and the button's result is indistinguishable from one
     * device to the next.
     *
     * Rows 17 and 18 explicitly test this: row 17 renders a wrong-key on an
     * unclaimed vault; row 18 renders the same key on an absent vault and
     * compares the rendered state to row 17 to assert they are identical.
     */

    test('should offer recovery key claim on device holding nothing (vaultStatus: absent)', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'no-evidence' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByText(/Test: Set encryption passphrase/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();
    });

    test('should offer recovery key claim on device holding unclaimed vault with no evidence', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'no-evidence' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByText(/Test: Set encryption passphrase/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();
    });

    test('should offer recovery key claim when server could not be reached (vaultStatus: unclaimed + postponed)', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'postponed' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByText(/We could not reach the server/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();
    });

    test('should offer recovery key claim when evidence check is in flight because the action needs no server', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({ status: 'checking' });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();
    });

    test('should offer recovery key claim on unlock screen when server vault meta claims the vault, so user can claim a second unclaimed vault with recovery key', () => {
      // This slice adds the recovery key offer to the Unlock screen so a User
      // who already owns a Vault (either on this device initially, or via just-proved
      // server evidence) can also offer a recovery key for a second, unclaimed Vault
      // on the same device (ADR 0061, vaultGate.tsx line 710).
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'claimed' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /I have a Recovery Key for a different vault on this device/,
        }),
      ).toBeInTheDocument();
    });

    test('should send recovery key to onClaim handler when claim is submitted', async () => {
      const setMasterKeyBytesFn = jest.fn();
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockClaimUnclaimedLocalVaultWithRecoveryKey.mockResolvedValue({
        kind: 'no-match',
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: setMasterKeyBytesFn,
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'no-evidence' },
      });
      const toastFn = jest.fn();
      mockUseToast.mockReturnValue({ toast: toastFn });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      // Verify the claim offer button is present on the setup screen
      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();

      // Expand and fill in recovery key
      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'test-recovery-key' } });

      // Verify submit is enabled when input is non-empty
      const submitButton = screen.getByRole('button', {
        name: /Claim this vault/,
      }) as HTMLButtonElement;
      expect(submitButton.disabled).toBe(false);

      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          mockClaimUnclaimedLocalVaultWithRecoveryKey,
        ).toHaveBeenCalledWith({
          handle,
          recoveryKey: 'test-recovery-key',
        });
      });

      // The claim offer handles the key submission and shows the result.
      // An unclaimed vault with no server evidence receives the no-match response.
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(screen.getByRole('alert').textContent).toBe(
        'That recovery key did not unlock a vault on this device. Nothing on this device was changed.',
      );
    });

    test('should show alert and keep setup screen when recovery key is wrong', async () => {
      const setMasterKeyBytesFn = jest.fn();
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockClaimUnclaimedLocalVaultWithRecoveryKey.mockResolvedValue({
        kind: 'no-match',
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: setMasterKeyBytesFn,
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'no-evidence' },
      });
      const toastFn = jest.fn();
      mockUseToast.mockReturnValue({ toast: toastFn });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      // Expand and fill in recovery key
      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'wrong-recovery-key' } });

      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      await waitFor(() => {
        expect(
          mockClaimUnclaimedLocalVaultWithRecoveryKey,
        ).toHaveBeenCalledWith({
          handle,
          recoveryKey: 'wrong-recovery-key',
        });
      });

      // Wait for the error alert to appear
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(
        'That recovery key did not unlock a vault on this device. Nothing on this device was changed.',
      );

      expect(
        screen.getByText(/Test: Set encryption passphrase/),
      ).toBeInTheDocument();

      expect(setMasterKeyBytesFn).not.toHaveBeenCalled();
      expect(toastFn).not.toHaveBeenCalled();
    });

    test('should make device holding nothing indistinguishable from device holding unclaimed vault with wrong key', async () => {
      const setMasterKeyBytesFn1 = jest.fn();
      const setMasterKeyBytesFn2 = jest.fn();

      // === Setup 1: device with unclaimed vault, wrong recovery key ===
      const handle1 = createStubHandle({
        vaultStatus: jest.fn(() => 'unclaimed'),
      });
      mockClaimUnclaimedLocalVaultWithRecoveryKey.mockResolvedValue({
        kind: 'no-match',
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: setMasterKeyBytesFn1,
        lock: jest.fn(),
        handle: handle1,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'no-evidence' },
      });
      const toastFn1 = jest.fn();
      mockUseToast.mockReturnValue({ toast: toastFn1 });

      const { unmount: unmount1 } = render(
        <VaultGate title="Test">{() => <div>children</div>}</VaultGate>,
      );

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input1 = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input1, { target: { value: 'test-key' } });

      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      await waitFor(() => {
        expect(
          mockClaimUnclaimedLocalVaultWithRecoveryKey,
        ).toHaveBeenCalledWith({
          handle: handle1,
          recoveryKey: 'test-key',
        });
      });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      const alertText1 = screen.getByRole('alert').textContent || '';
      const cardTitle1 =
        screen.getByText(/Test: Set encryption passphrase/).textContent || '';

      unmount1();

      // === Setup 2: device with nothing, same recovery key ===
      jest.clearAllMocks();
      mockClaimUnclaimedLocalVaultWithRecoveryKey.mockResolvedValue({
        kind: 'no-match',
      });
      const handle2 = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: setMasterKeyBytesFn2,
        lock: jest.fn(),
        handle: handle2,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'no-evidence' },
      });
      const toastFn2 = jest.fn();
      mockUseToast.mockReturnValue({ toast: toastFn2 });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      );

      const input2 = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input2, { target: { value: 'test-key' } });

      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      await waitFor(() => {
        expect(
          mockClaimUnclaimedLocalVaultWithRecoveryKey,
        ).toHaveBeenCalledWith({
          handle: handle2,
          recoveryKey: 'test-key',
        });
      });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      const alertText2 = screen.getByRole('alert').textContent || '';
      const cardTitle2 =
        screen.getByText(/Test: Set encryption passphrase/).textContent || '';

      // === Assertion: both are indistinguishable ===
      expect(alertText1).toBe(alertText2);
      expect(cardTitle1).toBe(cardTitle2);
      expect(setMasterKeyBytesFn1).not.toHaveBeenCalled();
      expect(setMasterKeyBytesFn2).not.toHaveBeenCalled();
      expect(toastFn1).not.toHaveBeenCalled();
      expect(toastFn2).not.toHaveBeenCalled();
    });
  });

  describe('vault replace offer integration', () => {
    test('should render automatic server-meta replace offer when vaultStatus is owned and evidence settles to replace-offer', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'replace-offer' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      // VaultReplaceOffer should be rendered
      expect(
        screen.getByText(/This device holds two vaults that are both yours/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /Export the vault I'm using now/,
        }),
      ).toBeInTheDocument();
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    test('should not render replace offer when vaultStatus is owned but evidence is not replace-offer', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'skipped-already-owned' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      // Should show the ordinary Unlock screen instead
      expect(
        screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/This device holds two vaults that are both yours/),
      ).not.toBeInTheDocument();
    });

    test('should decline automatic replace offer without calling vault write functions and show unlock screen', async () => {
      const setMasterKeyBytesFn = jest.fn();
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: setMasterKeyBytesFn,
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'replace-offer' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      // Verify replace offer is shown
      expect(
        screen.getByText(/This device holds two vaults that are both yours/),
      ).toBeInTheDocument();

      // Click Decline
      const declineButton = screen.getByRole('button', { name: /Decline/ });
      fireEvent.click(declineButton);

      // Should show Unlock screen
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
        ).toBeInTheDocument();
      });

      // Verify no vault write functions were called
      expect(mockReplaceOwnedLocalVaultOnEvidence).not.toHaveBeenCalled();
      expect(mockReplaceOwnedLocalVaultWithRecoveryKey).not.toHaveBeenCalled();
      expect(setMasterKeyBytesFn).not.toHaveBeenCalled();
    });

    test('should confirm automatic replace offer, call replaceOwnedLocalVaultOnEvidence, and show success toast', async () => {
      const setMasterKeyBytesFn = jest.fn();
      mockReplaceOwnedLocalVaultOnEvidence.mockReturnValue({
        kind: 'replaced',
      });
      const toastFn = jest.fn();
      mockUseToast.mockReturnValue({ toast: toastFn });

      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: setMasterKeyBytesFn,
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'replace-offer' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      // Check acknowledgement and confirm
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      const confirmButton = screen.getByRole('button', { name: /Confirm/ });
      fireEvent.click(confirmButton);

      // Wait for the operation to complete
      await waitFor(() => {
        expect(mockReplaceOwnedLocalVaultOnEvidence).toHaveBeenCalledWith({
          handle,
        });
      });

      // Verify success toast
      expect(toastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Vault replaced',
          description: expect.stringContaining(
            'This device now uses the other vault',
          ),
        }),
      );

      // Should show Unlock screen next
      expect(
        screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).toBeInTheDocument();
    });

    test('should allow recovery key offer on decline, and show replace offer again if recovery key matches', async () => {
      const setMasterKeyBytesFn = jest.fn();
      mockClaimUnclaimedLocalVaultWithRecoveryKey.mockResolvedValue({
        kind: 'replace-offer',
      });

      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: setMasterKeyBytesFn,
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'replace-offer' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      // Decline the automatic offer
      const declineButton = screen.getByRole('button', { name: /Decline/ });
      fireEvent.click(declineButton);

      // Should show Unlock screen with recovery key offer
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByRole('button', {
          name: /I have a Recovery Key for a different vault on this device/,
        }),
      ).toBeInTheDocument();

      // Expand and submit recovery key
      fireEvent.click(
        screen.getByRole('button', {
          name: /I have a Recovery Key for a different vault on this device/,
        }),
      );

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'test-recovery-key' } });

      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      // Wait for recovery key to be processed and replace offer to appear
      await waitFor(() => {
        expect(
          screen.getByText(/This device holds two vaults that are both yours/),
        ).toBeInTheDocument();
      });

      // The recovery key offer should be collapsed again
      expect(screen.queryByLabelText(/Recovery key/)).not.toBeInTheDocument();
    });

    test('should confirm recovery-key-triggered replace offer with correct key and unlock vault', async () => {
      const masterKeyBytes = new Uint8Array([1, 2, 3, 4]);
      mockClaimUnclaimedLocalVaultWithRecoveryKey.mockResolvedValue({
        kind: 'replace-offer',
      });
      mockReplaceOwnedLocalVaultWithRecoveryKey.mockResolvedValue({
        kind: 'replaced',
        masterKeyBytes,
      });
      const toastFn = jest.fn();
      mockUseToast.mockReturnValue({ toast: toastFn });

      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });

      // Use a state that will be updated to reflect the new masterKeyBytes
      let currentMasterKeyBytes: Uint8Array | null = null;
      const setMasterKeyBytesFn = jest.fn(
        (newBytes: Uint8Array | null, unlockSecret?: string) => {
          currentMasterKeyBytes = newBytes;
          void unlockSecret;
        },
      );
      mockUseOptionalVaultSession.mockImplementation(() => {
        return {
          masterKeyBytes: currentMasterKeyBytes,
          setMasterKeyBytes: setMasterKeyBytesFn,
          lock: jest.fn(),
          handle,
        };
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'replace-offer' },
      });

      const { rerender } = render(
        <VaultGate title="Test">{() => <div>children</div>}</VaultGate>,
      );

      // Decline the automatic offer
      fireEvent.click(screen.getByRole('button', { name: /Decline/ }));

      // Submit recovery key
      await waitFor(() => {
        fireEvent.click(
          screen.getByRole('button', {
            name: /I have a Recovery Key for a different vault on this device/,
          }),
        );
      });

      const input = screen.getByLabelText(/Recovery key/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'recovery-key-xyz' } });
      fireEvent.click(screen.getByRole('button', { name: /Claim this vault/ }));

      // Wait for replace offer to appear
      await waitFor(() => {
        expect(
          screen.getByText(/This device holds two vaults that are both yours/),
        ).toBeInTheDocument();
      });

      // Check acknowledgement and confirm
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      const confirmButton = screen.getByRole('button', { name: /Confirm/ });
      fireEvent.click(confirmButton);

      // Wait for the operation to complete
      await waitFor(() => {
        expect(mockReplaceOwnedLocalVaultWithRecoveryKey).toHaveBeenCalledWith({
          handle,
          recoveryKey: 'recovery-key-xyz',
        });
      });

      expect(setMasterKeyBytesFn).toHaveBeenCalledWith(
        masterKeyBytes,
        'recovery-key',
      );

      // Update state and rerender to reflect the new masterKeyBytes
      currentMasterKeyBytes = masterKeyBytes;
      rerender(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      // Should show children (unlocked state) after re-render
      expect(screen.getByText(/children/)).toBeInTheDocument();
    });

    test('should export current owned vault when export button is clicked in replace offer', async () => {
      const loadedVault = {
        version: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 310000,
          salt: 'test-salt-export',
        },
        masterKeyWrappedWithPassphrase: {
          iv: 'test-iv-passphrase',
          ciphertext: 'test-ciphertext-passphrase',
        },
        masterKeyWrappedWithRecoveryKey: {
          iv: 'test-iv-recovery',
          ciphertext: 'test-ciphertext-recovery',
        },
        data: {},
      } as const;
      mockExportVault.mockResolvedValue({ text: '{"vault":"data"}' });
      mockCreateDefaultAuditReporter.mockReturnValue({});

      // Mock URL.createObjectURL and URL.revokeObjectURL for the download functionality
      const mockClick = jest.fn();
      const originalCreateElement = document.createElement;
      jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
        const element = originalCreateElement.call(document, tagName);
        if (tagName === 'a') {
          element.click = mockClick;
        }
        return element;
      });

      // Mock global URL methods
      Object.defineProperty(global.URL, 'createObjectURL', {
        writable: true,
        value: jest.fn(() => 'blob:mock-url'),
      });
      Object.defineProperty(global.URL, 'revokeObjectURL', {
        writable: true,
        value: jest.fn(),
      });

      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        loadVault: jest.fn(() => loadedVault),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultClaimEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'replace-offer' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      // Click export button
      const exportButton = screen.getByRole('button', {
        name: /Export the vault I'm using now/,
      });
      fireEvent.click(exportButton);

      // Wait for export to complete
      await waitFor(() => {
        expect(mockExportVault).toHaveBeenCalledWith(
          expect.objectContaining({
            localVault: loadedVault,
            source: 'local-file',
          }),
        );
      });

      // Verify handle.loadVault was called (current vault)
      expect(handle.loadVault).toHaveBeenCalled();

      // Should show success state
      expect(screen.getByText(/Exported/)).toBeInTheDocument();
    });
  });

  describe('vault absent evidence gate discipline', () => {
    test('should render checking message when absent and evidence is checking', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultAbsentEvidence.mockReturnValue({ status: 'checking' });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Test' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Checking whether your vault is already on the server/,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();
    });

    test('should render awaiting-download message when absent and server holds vault', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultAbsentEvidence.mockReturnValue({
        status: 'settled',
        result: {
          kind: 'server-holds-vault',
          serverMeta: { etag: 'e1', updatedAt: 't1', meta: {} as any },
        },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: 'Getting your vault back',
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Getting your vault back/)).toBeInTheDocument();
      expect(
        screen.getByText(/The server already holds a vault for your account/),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Create encrypted vault/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();
    });

    test('should render cannot-check message when absent and server cannot be reached', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultAbsentEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'postponed' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: 'We could not reach the server',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/We could not reach the server/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Checking for your vault needs the server, and we could not reach it/,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Create encrypted vault/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();
    });

    test('should render session-lost message when absent and session expired', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultAbsentEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'session-lost' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Please sign in again' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Please sign in again/)).toBeInTheDocument();
      expect(
        screen.getByText(
          /Your session ended before we could check for your vault/,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Create encrypted vault/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();
    });

    test('should render create passphrase screen when absent and no server vault', () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
      mockUseVaultAbsentEvidence.mockReturnValue({
        status: 'settled',
        result: { kind: 'no-server-vault' },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      expect(
        screen.getByText(/Test: Set encryption passphrase/),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/Encryption passphrase/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Create encrypted vault/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();
    });

    test('should allow recovery key claim from awaiting-download screen', async () => {
      const setMasterKeyBytesFn = jest.fn();
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'absent'),
      });
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: setMasterKeyBytesFn,
        lock: jest.fn(),
        handle,
      });
      mockUseVaultAbsentEvidence.mockReturnValue({
        status: 'settled',
        result: {
          kind: 'server-holds-vault',
          serverMeta: { etag: 'e1', updatedAt: 't1', meta: {} as any },
        },
      });

      render(<VaultGate title="Test">{() => <div>children</div>}</VaultGate>);

      // Verify recovery key offer button is present on the awaiting-download screen
      expect(
        screen.getByRole('button', {
          name: /I have a recovery key for a vault on this device/,
        }),
      ).toBeInTheDocument();
    });
  });

  describe('passphrase unlock form', () => {
    const PASSPHRASE_MISMATCH =
      "That passphrase didn't unlock your vault. Nothing was changed.";

    // Unlock writes the key through setMasterKeyBytes. The gate reads the
    // session again on the render that follows the unlock, so the mock session
    // has to hold what was written.
    function mockUnlockableSession(handle: VaultHandle): void {
      let unlockedBytes: Uint8Array | null = null;
      mockUseOptionalVaultSession.mockImplementation(() => ({
        masterKeyBytes: unlockedBytes,
        setMasterKeyBytes: (bytes: Uint8Array | null) => {
          unlockedBytes = bytes;
        },
        lock: jest.fn(),
        handle,
      }));
    }

    function mockLockedSession(handle: VaultHandle): void {
      mockUseOptionalVaultSession.mockReturnValue({
        masterKeyBytes: null,
        setMasterKeyBytes: jest.fn(),
        lock: jest.fn(),
        handle,
      });
    }

    test('submitting the form (what Enter in the passphrase field produces) unlocks and opens the gate', async () => {
      const masterKeyBytes = new Uint8Array([1, 2, 3, 4]);
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        unlockWithPassphrase: jest.fn().mockResolvedValue({ masterKeyBytes }),
      });
      mockUnlockableSession(handle);

      render(
        <VaultGate title="Tasks">{() => <div>Unlocked tasks</div>}</VaultGate>,
      );

      // jsdom does not turn a keydown into implicit form submission, so the
      // submit event is dispatched directly on the form the field lives in.
      const field = screen.getByLabelText('Passphrase') as HTMLInputElement;
      fireEvent.change(field, { target: { value: 'pw' } });

      // Enter triggers implicit submission only when the field's form has an
      // enabled submit button and it is the first one in tree order.
      const form = field.closest('form') as HTMLFormElement;
      expect(field.form).toBe(form);
      const firstSubmit = form.querySelector('button[type="submit"]');
      expect(firstSubmit).toBe(screen.getByRole('button', { name: 'Unlock' }));
      expect(firstSubmit).toBeEnabled();

      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText('Unlocked tasks')).toBeInTheDocument();
      });
      expect(handle.unlockWithPassphrase).toHaveBeenCalledWith({
        passphrase: 'pw',
      });
    });

    test('a wrong passphrase shows the inline error on the field and still fires the toast', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        unlockWithPassphrase: jest
          .fn()
          .mockRejectedValue(new VaultSecretMismatchError('passphrase')),
      });
      mockLockedSession(handle);

      render(
        <VaultGate title="Tasks">{() => <div>Unlocked tasks</div>}</VaultGate>,
      );

      const field = screen.getByLabelText('Passphrase');
      fireEvent.change(field, { target: { value: 'gate-pass-1' } });
      fireEvent.submit(field.closest('form') as HTMLFormElement);

      expect(await screen.findByText(PASSPHRASE_MISMATCH)).toBeInTheDocument();
      expect(handle.unlockWithPassphrase).toHaveBeenCalledWith({
        passphrase: 'gate-pass-1',
      });
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAccessibleDescription(PASSPHRASE_MISMATCH);
      expect(toastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "That passphrase didn't unlock this vault",
          variant: 'destructive',
        }),
      );
    });

    test('editing the passphrase after a wrong attempt clears the inline error and its invalid state', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        unlockWithPassphrase: jest
          .fn()
          .mockRejectedValue(new VaultSecretMismatchError('passphrase')),
      });
      mockLockedSession(handle);

      render(
        <VaultGate title="Tasks">{() => <div>Unlocked tasks</div>}</VaultGate>,
      );

      const field = screen.getByLabelText('Passphrase');
      fireEvent.change(field, { target: { value: 'gate-pass-1' } });
      fireEvent.submit(field.closest('form') as HTMLFormElement);
      await screen.findByText(PASSPHRASE_MISMATCH);

      fireEvent.change(field, { target: { value: 'gate-pass-2' } });

      expect(screen.queryByText(PASSPHRASE_MISMATCH)).not.toBeInTheDocument();
      expect(field).not.toHaveAttribute('aria-invalid');
      expect(field).not.toHaveAttribute('aria-describedby');
    });

    test('a failure that is not a mismatch shows the fixed toast and no inline error', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        unlockWithPassphrase: jest.fn().mockRejectedValue(new Error('boom')),
      });
      mockLockedSession(handle);

      render(
        <VaultGate title="Tasks">{() => <div>Unlocked tasks</div>}</VaultGate>,
      );

      const field = screen.getByLabelText('Passphrase');
      fireEvent.change(field, { target: { value: 'gate-pass-1' } });
      fireEvent.submit(field.closest('form') as HTMLFormElement);

      await waitFor(() => {
        expect(toastFn).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Unlock failed' }),
        );
      });
      expect(screen.queryByText(PASSPHRASE_MISMATCH)).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(field).not.toHaveAttribute('aria-invalid');
    });

    test('while the unlock is in flight the button reads Unlocking and a second submit is ignored', async () => {
      const masterKeyBytes = new Uint8Array([1, 2, 3, 4]);
      let resolveUnlock: (result: {
        masterKeyBytes: Uint8Array;
      }) => void = () => undefined;
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        unlockWithPassphrase: jest.fn(
          () =>
            new Promise<{ masterKeyBytes: Uint8Array }>((resolve) => {
              resolveUnlock = resolve;
            }),
        ),
      });
      mockUnlockableSession(handle);

      render(
        <VaultGate title="Tasks">{() => <div>Unlocked tasks</div>}</VaultGate>,
      );

      const field = screen.getByLabelText('Passphrase');
      fireEvent.change(field, { target: { value: 'gate-pass-1' } });
      const form = field.closest('form') as HTMLFormElement;
      fireEvent.submit(form);

      const busyButton = await screen.findByRole('button', {
        name: 'Unlocking…',
      });
      expect(busyButton).toBeDisabled();
      expect(busyButton).toHaveAttribute('aria-busy', 'true');

      fireEvent.submit(form);
      expect(handle.unlockWithPassphrase).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveUnlock({ masterKeyBytes });
      });
      await waitFor(() => {
        expect(screen.getByText('Unlocked tasks')).toBeInTheDocument();
      });
    });

    test('the reveal control toggles the passphrase between hidden and visible without submitting', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockLockedSession(handle);

      render(
        <VaultGate title="Tasks">{() => <div>Unlocked tasks</div>}</VaultGate>,
      );

      await act(async () => {});

      const field = screen.getByLabelText('Passphrase') as HTMLInputElement;
      const reveal = screen.getByRole('button', { name: 'Show passphrase' });
      expect(field.type).toBe('password');
      expect(reveal).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(reveal);
      expect(field.type).toBe('text');
      expect(reveal).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Show passphrase' })).toBe(
        reveal,
      );

      fireEvent.click(reveal);
      expect(field.type).toBe('password');
      expect(reveal).toHaveAttribute('aria-pressed', 'false');

      expect(handle.unlockWithPassphrase).not.toHaveBeenCalled();
    });

    test('the explanatory line names the encrypted items when the gate is told what they are', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockLockedSession(handle);

      render(
        <VaultGate title="Tasks" encryptedItems="tasks">
          {() => <div>Unlocked tasks</div>}
        </VaultGate>,
      );

      await act(async () => {});

      expect(
        screen.getByText(
          'Your tasks are encrypted. Enter your passphrase to open them on this device.',
        ),
      ).toBeInTheDocument();
    });

    test('the explanatory line is generic when no encrypted items are named', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockLockedSession(handle);

      render(
        <VaultGate title="Tasks">{() => <div>Unlocked tasks</div>}</VaultGate>,
      );

      await act(async () => {});

      expect(
        screen.getByText(
          'Your data is encrypted. Enter your passphrase to open it on this device.',
        ),
      ).toBeInTheDocument();
    });

    test('Forgot it? opens the recovery screen, and submitting the recovery key field unlocks with the trimmed key', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
        unlockWithRecoveryKey: jest.fn().mockResolvedValue({
          masterKeyBytes: new Uint8Array([1, 2, 3, 4]),
        }),
      });
      mockLockedSession(handle);

      render(
        <VaultGate title="Tasks">{() => <div>Unlocked tasks</div>}</VaultGate>,
      );

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Forgot it? Use your Recovery Key',
        }),
      );

      expect(
        screen.getByRole('heading', { level: 1, name: 'Tasks: Recover' }),
      ).toBeInTheDocument();

      const recoveryField = screen.getByLabelText(
        'Recovery key',
      ) as HTMLInputElement;
      fireEvent.change(recoveryField, {
        target: { value: '  gate-recover-1  ' },
      });

      const recoverForm = recoveryField.closest('form') as HTMLFormElement;
      expect(recoveryField.form).toBe(recoverForm);
      const firstSubmit = recoverForm.querySelector('button[type="submit"]');
      expect(firstSubmit).toBe(
        screen.getByRole('button', { name: 'Unlock with recovery key' }),
      );
      expect(firstSubmit).toBeEnabled();

      fireEvent.submit(recoverForm);

      await waitFor(() => {
        expect(handle.unlockWithRecoveryKey).toHaveBeenCalledWith({
          recoveryKey: 'gate-recover-1',
        });
      });
      await waitFor(() => {
        expect(toastFn).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Recovered' }),
        );
      });
    });

    test('Use passphrase on the recovery screen returns to the unlock screen', async () => {
      const handle = createStubHandle({
        vaultStatus: jest.fn(() => 'owned'),
      });
      mockLockedSession(handle);

      render(
        <VaultGate title="Tasks">{() => <div>Unlocked tasks</div>}</VaultGate>,
      );

      await act(async () => {});

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Forgot it? Use your Recovery Key',
        }),
      );
      expect(screen.getByLabelText('Recovery key')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Use passphrase' }));

      expect(
        screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
      expect(screen.queryByLabelText('Recovery key')).not.toBeInTheDocument();
    });
  });
});
