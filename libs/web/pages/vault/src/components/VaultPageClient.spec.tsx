/* eslint-disable import/first -- jest.mock must precede application imports */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The export the page drives. Declared here rather than inside the factory so
 * a test can decide, per case, whether the export succeeded — which is the
 * whole question the co-locate prompt turns on. The `mock` prefix is what lets
 * `jest.mock`'s hoisting reach it.
 */
const mockExportVaultNow = jest.fn<Promise<boolean>, []>();

// Mock useVaultDisabledState at its module path so the real useVaultOperationAvailability
// (which imports it from the same file) will use the mock when it calls useVaultDisabledState().
jest.mock('../hooks/useVaultDisabledState.ts', () => ({
  useVaultDisabledState: jest.fn(),
}));

jest.mock('../hooks', () => {
  const actual = jest.requireActual('../hooks');
  return {
    ...actual,
    useGoogleIdentityScript: jest.fn(() => 'loading'),
    useLatestCloudBackup: () => ({ status: 'empty', record: null }),
    useExportVault: () => ({
      exporting: false,
      exportVaultNow: mockExportVaultNow,
    }),
    useChangePassphrase: () => ({
      changing: false,
      changePassphrase: jest.fn(),
    }),
    useRecoveryKeyRotation: () => ({
      rotating: false,
      rotateRecoveryKey: jest.fn(),
    }),
    useVaultUnlock: () => ({ unlocking: false, unlock: jest.fn() }),
    useCloudBackup: () => ({
      status: 'idle',
      backup: jest.fn(),
      clear: jest.fn(),
    }),
  };
});

jest.mock('@myorganiser/web-vault-ui', () => {
  const actual = jest.requireActual('@myorganiser/web-vault-ui');
  return {
    ...actual,
    useOptionalVaultSession: () => ({
      masterKeyBytes: null,
      setMasterKeyBytes: jest.fn(),
      lock: jest.fn(),
      handle: {
        owner: 'test-owner',
        hasOwnedVault: () => true,
        hasVault: () => true,
        hasUnclaimedLocalVault: () => false,
        loadVault: () => null,
        removeVault: jest.fn(),
      },
    }),
    // Stub useServerReachability to avoid real network probes. Even though
    // no current test mounts RecoveryKeyMintedSection (which uses it), the stub
    // prevents a future author from accidentally triggering real jsdom probes
    // when they add a test that drives a successful key rotation.
    // The hero reads the lock state from the real module, not from the session
    // mock above. Set per test through setDisabledState, which derives it from
    // the disabled state. A non-null session without masterKeyBytes is 'locked'.
    useVaultLockState: jest.fn(),
    useServerReachability: () => ({
      reachability: 'reachable',
      recheck: jest.fn(),
    }),
  };
});

jest.mock('@myorganiser/web-ui', () => {
  const actual = jest.requireActual('@myorganiser/web-ui');
  return {
    ...actual,
    useIsMobile: jest.fn(() => false),
  };
});

jest.mock('./CloudBackupLiveCard', () => ({
  // Carries the callback through so the Drive path can be driven from a test.
  // The real card fires it on a `backupCounter` increment; what this page owes
  // is to raise the prompt when it does, and that is what this stands in for.
  CloudBackupLiveCard: ({
    onEscapeCopyMade,
    onSummaryChange,
  }: {
    onEscapeCopyMade?: () => void;
    onSummaryChange?: (summary: {
      linked: boolean;
      newestCopyCreatedAt: string | null | undefined;
    }) => void;
  }) => (
    <div data-testid="cloud-backup-live-card">
      Encrypted cloud backup
      <button
        type="button"
        data-testid="stub-drive-backup-succeeded"
        onClick={() => onEscapeCopyMade?.()}
      >
        backup succeeded
      </button>
      <button
        type="button"
        data-testid="stub-summary-linked-dated"
        onClick={() =>
          onSummaryChange?.({
            linked: true,
            newestCopyCreatedAt: new Date(
              Date.now() - 3 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          })
        }
      >
        report linked and dated
      </button>
      <button
        type="button"
        data-testid="stub-summary-unlinked-empty"
        onClick={() =>
          onSummaryChange?.({ linked: false, newestCopyCreatedAt: null })
        }
      >
        report unlinked and empty
      </button>
    </div>
  ),
}));

import { VaultPageClient } from './VaultPageClient';
import { useIsMobile } from '@myorganiser/web-ui';
import { useVaultLockState } from '@myorganiser/web-vault-ui';
import { useGoogleIdentityScript } from '../hooks';
import { useVaultDisabledState } from '../hooks/useVaultDisabledState';

/** The lock state each disabled state implies: a session that is null is 'no-session'. */
const LOCK_STATE_FOR: Record<string, string> = {
  enabled: 'unlocked',
  locked: 'locked',
  'no-local-vault': 'locked',
  'signed-out': 'no-session',
};

/** Sets the disabled state and the lock state the hero reads, together. */
function setDisabledState(state: string) {
  (useVaultDisabledState as jest.Mock).mockReturnValue(state);
  (useVaultLockState as jest.Mock).mockReturnValue(LOCK_STATE_FOR[state]);
}

describe('VaultPageClient', () => {
  const ORIGINAL_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    (useGoogleIdentityScript as jest.Mock).mockReturnValue('loading');
    setDisabledState('locked');
    (useIsMobile as jest.Mock).mockReturnValue(false);
    mockExportVaultNow.mockResolvedValue(true);
  });

  afterEach(() => {
    if (ORIGINAL_CLIENT_ID === undefined) {
      delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    } else {
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = ORIGINAL_CLIENT_ID;
    }
  });

  test('renders cloud backup unavailable, removal, export, and import cards when no client ID is configured', () => {
    render(<VaultPageClient />);

    // Recovery key rotation card
    expect(screen.getByText('Rotate recovery key')).toBeInTheDocument();

    // Cloud backup card (unavailable because clientId is empty)
    expect(screen.getByText('Encrypted cloud backup')).toBeInTheDocument();

    // Verify the specific reason text for missing clientId
    expect(
      screen.getByText(
        'Cloud backup is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google Drive backup.',
      ),
    ).toBeInTheDocument();

    // Export vault card
    expect(screen.getByText('Export encrypted vault')).toBeInTheDocument();

    // Removal vault card
    expect(screen.getByTestId('remove-vault-button')).toBeInTheDocument();

    // Import vault card
    expect(screen.getByText('Import encrypted vault')).toBeInTheDocument();

    // Verify cross-source last-backup summary card is NOT rendered
    // (it belongs on the account page, not the vault page)
    expect(screen.queryByTestId('last-backup-card')).not.toBeInTheDocument();
  });

  test('positions the export and import cards, then the escape copy reader, then removal in the Danger zone', () => {
    render(<VaultPageClient />);

    const exportHeading = screen.getByText('Export encrypted vault');
    const importHeading = screen.getByText('Import encrypted vault');
    const escapeCopyHeading = screen.getByText(
      'Open your Escape Copy without us',
    );
    const dangerHeading = screen.getByRole('heading', { name: 'Danger zone' });
    const removeButton = screen.getByTestId('remove-vault-button');

    // Assert the order: ExportVaultCard + ImportVaultCard grid → EscapeCopyReaderCard → Danger zone → RemoveVaultCard
    expect(
      exportHeading.compareDocumentPosition(importHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      importHeading.compareDocumentPosition(escapeCopyHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      escapeCopyHeading.compareDocumentPosition(dangerHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      dangerHeading.compareDocumentPosition(removeButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('renders VaultUnlockCard when vault is locked', () => {
    render(<VaultPageClient />);

    // Assert unlock card is present when vault is in locked state
    expect(screen.getByText('Unlock your vault')).toBeInTheDocument();
    expect(screen.getByTestId('vault-unlock-submit')).toBeInTheDocument();
  });

  test('hides VaultUnlockCard when vault is unlocked', () => {
    // Override the default mock for this test to return 'enabled'
    setDisabledState('enabled');

    render(<VaultPageClient />);

    // Assert unlock card is not present when vault is enabled
    expect(screen.queryByText('Unlock your vault')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vault-unlock-submit')).not.toBeInTheDocument();

    // Reset the mock for other tests
    setDisabledState('locked');
  });

  test('positions VaultUnlockCard before ChangePassphraseCard', () => {
    render(<VaultPageClient />);

    const unlockTitle = screen.getByText('Unlock your vault');
    // "Change passphrase" appears twice (heading and button), so get the first one
    const changePassphraseTitles = screen.getAllByText('Change passphrase');
    const changePassphraseTitle = changePassphraseTitles[0];

    // Assert VaultUnlockCard comes before ChangePassphraseCard in the DOM
    expect(
      unlockTitle.compareDocumentPosition(changePassphraseTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  describe('Cloud backup unavailability policy (ADR 0068)', () => {
    test('E1: no-local-vault state shows vault policy reason, not config reason', () => {
      // Policy takes precedence: with no Local Vault, how Google Drive is configured
      // is not the reason the card is unavailable.
      setDisabledState('no-local-vault');

      render(<VaultPageClient />);

      // Should show the policy reason from vaultOperationAvailability
      expect(
        screen.getByText('There is no vault on this device to back up.'),
      ).toBeInTheDocument();

      // Should NOT show the config reason
      expect(
        screen.queryByText(
          /Cloud backup is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID/,
        ),
      ).not.toBeInTheDocument();
    });

    test('E2: signed-out state shows vault policy reason, not config reason', () => {
      setDisabledState('signed-out');

      render(<VaultPageClient />);

      // Should show the policy reason (signed-out copy) in multiple cards that show
      // VaultUnavailableNotice: RemoveVaultCard, ExportVaultCard, ChangePassphraseCard,
      // RecoveryKeyRotationCard, ImportVaultCard, and CloudBackupUnavailableCard.
      // Exact count ensures that if a new card were added without proper integration
      // or if an existing card stopped showing the notice, the test catches it.
      const signedOutMessages = screen.getAllByText(
        'Your vault is not available on this device right now.',
      );
      expect(signedOutMessages.length).toBe(6);

      // Should NOT show the old "Sign in to enable cloud backup" string
      expect(
        screen.queryByText(/Sign in to enable cloud backup/),
      ).not.toBeInTheDocument();

      // Should NOT show the config reason
      expect(
        screen.queryByText(
          /Cloud backup is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID/,
        ),
      ).not.toBeInTheDocument();
    });

    test('E3: locked state allows cloud backup (does not need Master Key per ADR 0068), renders live card when clientId is set', () => {
      // A locked Vault does not block cloud backup: it touches Ciphertext only,
      // not plaintext, so unlock is not a plaintext-access boundary for it.
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id';
      setDisabledState('locked');
      mockExportVaultNow.mockResolvedValue(true);
      (useGoogleIdentityScript as jest.Mock).mockReturnValue('ready');

      render(<VaultPageClient />);

      // Should NOT show a policy reason (locked state does not block backup)
      expect(
        screen.queryByText(
          /There is no vault on this device to back up|Your vault is not available/,
        ),
      ).not.toBeInTheDocument();

      // Should NOT show the "Cloud backup is not configured" reason
      expect(
        screen.queryByText(
          /Cloud backup is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID/,
        ),
      ).not.toBeInTheDocument();

      // Should render the live cloud backup card (CloudBackupLiveCard renders a heading
      // "Encrypted cloud backup" and the provider/handle are present)
      expect(screen.getByText('Encrypted cloud backup')).toBeInTheDocument();
    });

    test('E4: enabled state allows cloud backup, renders live card when clientId is set', () => {
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id';
      setDisabledState('enabled');
      (useGoogleIdentityScript as jest.Mock).mockReturnValue('ready');

      render(<VaultPageClient />);

      // Should NOT show any policy reason (enabled state allows everything)
      expect(
        screen.queryByText(
          /There is no vault on this device to back up|Your vault is not available/,
        ),
      ).not.toBeInTheDocument();

      // Should NOT show the config reason
      expect(
        screen.queryByText(
          /Cloud backup is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID/,
        ),
      ).not.toBeInTheDocument();

      // Should render the live cloud backup card
      expect(screen.getByText('Encrypted cloud backup')).toBeInTheDocument();
    });
  });

  describe('Heading and layout', () => {
    test('renders exactly one h1 for each of the enabled, locked, and no-local-vault states', () => {
      const cases: Array<[string, string]> = [
        ['enabled', 'Your vault is unlocked'],
        ['locked', 'Unlock your vault'],
        ['no-local-vault', 'Vault'],
        ['signed-out', 'Vault'],
      ];

      for (const [state, title] of cases) {
        setDisabledState(state);
        const { unmount } = render(<VaultPageClient />);

        const h1s = screen.getAllByRole('heading', { level: 1 });
        expect(h1s).toHaveLength(1);
        expect(h1s[0].textContent).toBe(title);

        unmount();
      }
    });

    test('below md renders the phone sections and not the desktop cards', () => {
      (useIsMobile as jest.Mock).mockReturnValue(true);
      setDisabledState('enabled');

      render(<VaultPageClient />);

      // The phone ListGroups: each section heading, and the passphrase row as a link
      expect(
        screen.getByRole('heading', { level: 2, name: 'Access' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Danger zone' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /Change passphrase/ }),
      ).toHaveAttribute('href', '/dashboard/vault/passphrase');

      // The desktop cards are not mounted alongside them
      expect(
        screen.queryByTestId('change-passphrase-open'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Encrypted cloud backup'),
      ).not.toBeInTheDocument();
      expect(screen.getAllByTestId('remove-vault-button')).toHaveLength(1);
    });
  });

  describe('Escape copy summary in the unlocked hero', () => {
    test('a linked, dated summary raises the linked and newest-copy chips', async () => {
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id';
      setDisabledState('enabled');
      (useGoogleIdentityScript as jest.Mock).mockReturnValue('ready');
      render(<VaultPageClient />);

      fireEvent.click(screen.getByTestId('stub-summary-linked-dated'));

      await waitFor(() =>
        expect(screen.getByText('Linked to Google Drive')).toBeInTheDocument(),
      );
      expect(screen.getByText('Newest copy: 3 days old')).toBeInTheDocument();
    });

    test('an unlinked summary with no copy removes the chips a linked summary raised', async () => {
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id';
      setDisabledState('enabled');
      (useGoogleIdentityScript as jest.Mock).mockReturnValue('ready');
      render(<VaultPageClient />);

      // Raise the chips first, so the removal below is observable
      fireEvent.click(screen.getByTestId('stub-summary-linked-dated'));
      await waitFor(() =>
        expect(screen.getByText('Linked to Google Drive')).toBeInTheDocument(),
      );
      expect(screen.getByText(/Newest copy:/)).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('stub-summary-unlinked-empty'));

      await waitFor(() =>
        expect(
          screen.queryByText('Linked to Google Drive'),
        ).not.toBeInTheDocument(),
      );
      expect(screen.queryByText(/Newest copy:/)).not.toBeInTheDocument();
    });
  });

  describe('Escape Copy reader card', () => {
    test('renders the escape copy reader card', () => {
      render(<VaultPageClient />);

      expect(
        screen.getByText('Open your Escape Copy without us'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('escape-copy-reader-download-link'),
      ).toBeInTheDocument();
    });

    test('does not show the "just made" callout on initial render', () => {
      render(<VaultPageClient />);

      expect(
        screen.queryByTestId('escape-copy-reader-just-made'),
      ).not.toBeInTheDocument();
    });

    test('raises the callout once a local export has actually succeeded', async () => {
      setDisabledState('enabled');
      mockExportVaultNow.mockResolvedValue(true);
      render(<VaultPageClient />);

      fireEvent.click(screen.getByTestId('export-vault-button'));

      await waitFor(() =>
        expect(
          screen.getByTestId('escape-copy-reader-just-made'),
        ).toBeInTheDocument(),
      );
    });

    test('leaves the callout down when the export failed', async () => {
      // The prompt says "you just made an Escape Copy". Raising it when no
      // copy was made tells the User a file exists that does not.
      setDisabledState('enabled');
      mockExportVaultNow.mockResolvedValue(false);
      render(<VaultPageClient />);

      fireEvent.click(screen.getByTestId('export-vault-button'));

      await waitFor(() => expect(mockExportVaultNow).toHaveBeenCalled());
      expect(
        screen.queryByTestId('escape-copy-reader-just-made'),
      ).not.toBeInTheDocument();
    });

    test('raises the callout when a Drive Escape Copy succeeds', async () => {
      setDisabledState('enabled');
      (useGoogleIdentityScript as jest.Mock).mockReturnValue('ready');
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id';
      render(<VaultPageClient />);

      fireEvent.click(screen.getByTestId('stub-drive-backup-succeeded'));

      await waitFor(() =>
        expect(
          screen.getByTestId('escape-copy-reader-just-made'),
        ).toBeInTheDocument(),
      );
    });

    test('keeps the callout up afterwards, because the reminder outlives the moment', async () => {
      // Sticky on purpose: a User who leaves to go find the downloaded file
      // and comes back is exactly the User the reminder is for.
      setDisabledState('enabled');
      mockExportVaultNow.mockResolvedValue(true);
      render(<VaultPageClient />);

      fireEvent.click(screen.getByTestId('export-vault-button'));
      await waitFor(() =>
        expect(
          screen.getByTestId('escape-copy-reader-just-made'),
        ).toBeInTheDocument(),
      );

      mockExportVaultNow.mockResolvedValue(false);
      fireEvent.click(screen.getByTestId('export-vault-button'));

      await waitFor(() => expect(mockExportVaultNow).toHaveBeenCalledTimes(2));
      expect(
        screen.getByTestId('escape-copy-reader-just-made'),
      ).toBeInTheDocument();
    });
  });
});
