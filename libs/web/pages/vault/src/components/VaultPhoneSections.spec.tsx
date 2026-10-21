/* eslint-disable import/first -- jest.mock must precede application imports */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

/**
 * Mock useVaultDisabledState at its module path so the real
 * useVaultOperationAvailability (which imports it from the same file) reads the
 * mocked state, the same way RemoveVaultCard.spec.tsx does.
 */
jest.mock('../hooks/useVaultDisabledState', () => ({
  useVaultDisabledState: jest.fn(),
}));

/**
 * The passphrase row reads its title from useChangePassphraseMode, which imports
 * useChangePassphrase from its module path. Mock it there so the mode is set per test.
 */
jest.mock('../hooks/useChangePassphrase', () => ({
  ...jest.requireActual('../hooks/useChangePassphrase'),
  useChangePassphrase: jest.fn(),
}));

/**
 * The dialog is a collaborator with its own hooks. This stub exposes only its
 * open state, which is what the Danger zone row controls.
 */
jest.mock('./RemoveVaultDialog', () => ({
  RemoveVaultDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid="remove-vault-dialog" data-open={String(open)}>
      <button type="button" onClick={() => onOpenChange(false)}>
        Close remove dialog
      </button>
    </div>
  ),
}));

import { VaultPhoneSections } from './VaultPhoneSections';
import { useChangePassphrase } from '../hooks/useChangePassphrase';
import { useVaultDisabledState } from '../hooks/useVaultDisabledState';

describe('VaultPhoneSections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useVaultDisabledState as jest.Mock).mockReturnValue('enabled');
    (useChangePassphrase as jest.Mock).mockReturnValue({
      changing: false,
      unlockSecret: 'passphrase',
      changePassphrase: jest.fn(),
    });
  });

  test('the passphrase row reads "Set new passphrase" when the vault was unlocked with the recovery key', () => {
    (useChangePassphrase as jest.Mock).mockReturnValue({
      changing: false,
      unlockSecret: 'recovery-key',
      changePassphrase: jest.fn(),
    });

    render(<VaultPhoneSections />);

    expect(
      screen.getByRole('link', { name: /Set new passphrase/ }),
    ).toHaveAttribute('href', '/dashboard/vault/passphrase');
    expect(
      screen.queryByRole('link', { name: /Change passphrase/ }),
    ).not.toBeInTheDocument();
  });

  test('renders the Access, Backups, and Danger zone sections as h2 headings in that order', () => {
    render(<VaultPhoneSections />);

    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Access',
      'Backups and moving your vault',
      'Danger zone',
    ]);
  });

  test('links the Access rows to the passphrase and recovery-key routes when unlocked', () => {
    render(<VaultPhoneSections />);

    expect(
      screen.getByRole('link', { name: /Change passphrase/ }),
    ).toHaveAttribute('href', '/dashboard/vault/passphrase');
    expect(
      screen.getByRole('link', { name: /Rotate recovery key/ }),
    ).toHaveAttribute('href', '/dashboard/vault/recovery-key');
  });

  test('shows the Access rows as not links, aria-disabled, with the policy reason when locked', () => {
    (useVaultDisabledState as jest.Mock).mockReturnValue('locked');

    render(<VaultPhoneSections />);

    expect(
      screen.queryByRole('link', { name: /Change passphrase/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Rotate recovery key/ }),
    ).not.toBeInTheDocument();

    const passphraseRow = screen
      .getByText('Change passphrase')
      .closest('[aria-disabled="true"]');
    expect(passphraseRow).toHaveTextContent(
      'Unlock your vault to change its passphrase.',
    );

    const rotationRow = screen
      .getByText('Rotate recovery key')
      .closest('[aria-disabled="true"]');
    expect(rotationRow).toHaveTextContent(
      'Unlock your vault to rotate its recovery key.',
    );
  });

  test('links the backup rows to the backups route and the reader row to the reader route', () => {
    render(<VaultPhoneSections />);

    for (const title of [
      'Encrypted Escape Copy',
      'Export encrypted vault',
      'Import encrypted vault',
    ]) {
      expect(
        screen.getByRole('link', { name: new RegExp(title) }),
      ).toHaveAttribute('href', '/dashboard/vault/backups');
    }
    expect(
      screen.getByRole('link', { name: /Open your Escape Copy without us/ }),
    ).toHaveAttribute('href', '/dashboard/vault/reader');
  });

  test('the Remove row opens the Remove dialog', () => {
    render(<VaultPhoneSections />);

    const dialog = screen.getByTestId('remove-vault-dialog');
    expect(dialog).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByTestId('remove-vault-button'));

    expect(dialog).toHaveAttribute('data-open', 'true');
  });

  test('closing the Remove dialog hands its open state back to false', () => {
    render(<VaultPhoneSections />);

    const dialog = screen.getByTestId('remove-vault-dialog');
    fireEvent.click(screen.getByTestId('remove-vault-button'));
    expect(dialog).toHaveAttribute('data-open', 'true');

    fireEvent.click(
      screen.getByRole('button', { name: 'Close remove dialog' }),
    );

    expect(dialog).toHaveAttribute('data-open', 'false');
  });

  test('the Remove row is disabled with the policy reason and does not open the dialog when signed out', () => {
    (useVaultDisabledState as jest.Mock).mockReturnValue('signed-out');

    render(<VaultPhoneSections />);

    const removeButton = screen.getByTestId('remove-vault-button');
    expect(removeButton).toBeDisabled();
    expect(removeButton).toHaveTextContent(
      'Your vault is not available on this device right now.',
    );

    fireEvent.click(removeButton);

    expect(screen.getByTestId('remove-vault-dialog')).toHaveAttribute(
      'data-open',
      'false',
    );
  });
});
