/* eslint-disable import/first -- jest.mock must precede application imports */

// Drives the User Deletion flow from the section button through the real
// dialog and both steps. Only boundaries are mocked: the users API, the Escape
// Copy export hook, the auth session, and the router.

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

jest.mock('@myorganiser/auth', () => ({
  clearAuthSession: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  useExportVault: jest.fn(),
}));

jest.mock('../lib/apiClient', () => ({
  createUsersApi: jest.fn(),
}));

import { clearAuthSession } from '@myorganiser/auth';
import { useExportVault } from '@myorganiser/web-vault-ui';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';

import { createUsersApi } from '../lib/apiClient';

import { DeleteAccountSection } from './DeleteAccountSection';

const mockDeleteMe = jest.fn();
const mockExportVaultNow = jest.fn();

const PASSWORD = 'hunter2-pass';

function createAxiosError(
  status: number | undefined,
  message: string | undefined,
) {
  return Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response:
      status === undefined
        ? undefined
        : { status, data: message === undefined ? {} : { message } },
  });
}

function renderSection() {
  return render(<DeleteAccountSection />);
}

async function openDialog() {
  fireEvent.click(screen.getByTestId('delete-account-button'));
  return screen.findByTestId('delete-account-dialog');
}

async function continueToConfirm() {
  fireEvent.click(screen.getByTestId('delete-account-continue'));
  return screen.findByTestId('delete-account-password');
}

function fillConfirm(password: string, confirmation: string) {
  fireEvent.change(screen.getByTestId('delete-account-password'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByTestId('delete-account-confirmation'), {
    target: { value: confirmation },
  });
}

function submitConfirm() {
  fireEvent.click(screen.getByTestId('delete-account-submit'));
}

beforeEach(() => {
  jest.clearAllMocks();

  (createUsersApi as jest.Mock).mockReturnValue({ deleteMe: mockDeleteMe });
  mockDeleteMe.mockResolvedValue({});
  mockExportVaultNow.mockResolvedValue(true);
  (useExportVault as jest.Mock).mockReturnValue({
    exporting: false,
    exportVaultNow: mockExportVaultNow,
  });
});

describe('DeleteAccountSection', () => {
  it('opens on the Escape Copy step without showing the password field', async () => {
    renderSection();

    await openDialog();

    expect(screen.getByTestId('escape-copy-button')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-account-password')).toBeNull();
    expect(screen.getByTestId('delete-account-continue').textContent).toBe(
      'Continue without a copy',
    );
  });

  it('shows the downloaded line and switches to Continue after a successful Escape Copy', async () => {
    renderSection();
    await openDialog();

    fireEvent.click(screen.getByTestId('escape-copy-button'));

    expect(await screen.findByText('Escape Copy downloaded.')).toBeVisible();
    expect(mockExportVaultNow).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('delete-account-continue').textContent).toBe(
      'Continue',
    );
  });

  it('keeps the skip label and no downloaded line when the Escape Copy fails', async () => {
    mockExportVaultNow.mockResolvedValue(false);
    renderSection();
    await openDialog();

    fireEvent.click(screen.getByTestId('escape-copy-button'));

    await waitFor(() => expect(mockExportVaultNow).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByText('Escape Copy downloaded.')).toBeNull();
    expect(screen.getByTestId('delete-account-continue').textContent).toBe(
      'Continue without a copy',
    );
  });

  it('goes to the confirm step without exporting when the user skips the copy', async () => {
    renderSection();
    await openDialog();

    await continueToConfirm();

    expect(mockExportVaultNow).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: 'Confirm account deletion' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Feedback Reports you've sent stay on our servers/),
    ).toBeInTheDocument();
  });

  it('shows both required messages and does not call the API when submitted empty', async () => {
    renderSection();
    await openDialog();
    await continueToConfirm();

    submitConfirm();

    expect(await screen.findByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByText('Type DELETE to confirm.')).toBeInTheDocument();
    expect(mockDeleteMe).not.toHaveBeenCalled();
  });

  it('rejects a lowercase confirmation and does not call the API', async () => {
    renderSection();
    await openDialog();
    await continueToConfirm();

    fillConfirm(PASSWORD, 'delete');
    submitConfirm();

    expect(
      await screen.findByText('Type DELETE to confirm.'),
    ).toBeInTheDocument();
    expect(mockDeleteMe).not.toHaveBeenCalled();
  });

  it('rejects a confirmation with trailing whitespace and does not call the API', async () => {
    renderSection();
    await openDialog();
    await continueToConfirm();

    fillConfirm(PASSWORD, 'DELETE ');
    submitConfirm();

    expect(
      await screen.findByText('Type DELETE to confirm.'),
    ).toBeInTheDocument();
    expect(mockDeleteMe).not.toHaveBeenCalled();
  });

  it('deletes with the password and DELETE, clears the session, then navigates to /account-deleted', async () => {
    renderSection();
    await openDialog();
    await continueToConfirm();

    fillConfirm(PASSWORD, 'DELETE');
    submitConfirm();

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/account-deleted'),
    );
    expect(mockDeleteMe).toHaveBeenCalledTimes(1);
    expect(mockDeleteMe).toHaveBeenCalledWith({
      userDeletionBody: { password: PASSWORD, confirmation: 'DELETE' },
    });
    expect(clearAuthSession).toHaveBeenCalledTimes(1);
    expect(
      (clearAuthSession as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(mockReplace.mock.invocationCallOrder[0]);
  });

  it('shows a wrong-password error on the password field and stays on the dialog', async () => {
    mockDeleteMe.mockRejectedValue(
      createAxiosError(403, 'Incorrect password.'),
    );
    renderSection();
    await openDialog();
    await continueToConfirm();

    fillConfirm(PASSWORD, 'DELETE');
    submitConfirm();

    expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
    expect(screen.getByTestId('delete-account-password')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.queryByTestId('delete-account-error')).toBeNull();
    expect(screen.getByTestId('delete-account-dialog')).toBeInTheDocument();
    expect(clearAuthSession).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows the server conflict message in the alert and does not sign out or navigate', async () => {
    const serverMessage =
      'A YouTube sync is running. Try again when it finishes.';
    mockDeleteMe.mockRejectedValue(createAxiosError(409, serverMessage));
    renderSection();
    await openDialog();
    await continueToConfirm();

    fillConfirm(PASSWORD, 'DELETE');
    submitConfirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(serverMessage);
    expect(screen.getByTestId('delete-account-error')).toHaveTextContent(
      serverMessage,
    );
    expect(clearAuthSession).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows the fallback message when the request fails without a server message', async () => {
    mockDeleteMe.mockRejectedValue(createAxiosError(undefined, undefined));
    renderSection();
    await openDialog();
    await continueToConfirm();

    fillConfirm(PASSWORD, 'DELETE');
    submitConfirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your account was not deleted. Try again.',
    );
    expect(clearAuthSession).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows the fallback instead of a 5xx body message and does not sign out or navigate', async () => {
    mockDeleteMe.mockRejectedValue(
      createAxiosError(500, 'Internal Server Error'),
    );
    renderSection();
    await openDialog();
    await continueToConfirm();

    fillConfirm(PASSWORD, 'DELETE');
    submitConfirm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Your account was not deleted. Try again.');
    expect(clearAuthSession).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('disables the submit button and shows a busy label while the deletion is pending', async () => {
    let resolveDelete: (value: unknown) => void = () => undefined;
    mockDeleteMe.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    renderSection();
    await openDialog();
    await continueToConfirm();

    fillConfirm(PASSWORD, 'DELETE');
    submitConfirm();

    const busy = await screen.findByRole('button', { name: 'Deleting…' });
    expect(busy).toBeDisabled();

    await act(async () => {
      resolveDelete({});
    });

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/account-deleted'),
    );
  });

  it('returns to the Escape Copy step from Back and keeps the downloaded state', async () => {
    renderSection();
    await openDialog();
    fireEvent.click(screen.getByTestId('escape-copy-button'));
    await screen.findByText('Escape Copy downloaded.');
    fireEvent.click(screen.getByTestId('delete-account-continue'));
    await screen.findByTestId('delete-account-password');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByTestId('escape-copy-button')).toBeInTheDocument();
    expect(screen.getByText('Escape Copy downloaded.')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-account-password')).toBeNull();
  });

  it('closes on Cancel and removes the dialog', async () => {
    renderSection();
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByTestId('delete-account-dialog')).toBeNull(),
    );
  });

  it('reopens on the Escape Copy step with an empty form after dismissing from the confirm step', async () => {
    renderSection();
    await openDialog();
    fireEvent.click(screen.getByTestId('escape-copy-button'));
    await screen.findByText('Escape Copy downloaded.');
    await continueToConfirm();
    fillConfirm(PASSWORD, 'DELETE');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByTestId('delete-account-dialog')).toBeNull(),
    );

    await openDialog();

    expect(screen.getByTestId('escape-copy-button')).toBeInTheDocument();
    expect(screen.queryByText('Escape Copy downloaded.')).toBeNull();
    expect(screen.getByTestId('delete-account-continue').textContent).toBe(
      'Continue without a copy',
    );

    await continueToConfirm();
    expect(
      (screen.getByTestId('delete-account-password') as HTMLInputElement).value,
    ).toBe('');
    expect(
      (screen.getByTestId('delete-account-confirmation') as HTMLInputElement)
        .value,
    ).toBe('');
  });

  describe('desktop step eyebrow', () => {
    it('labels the first step of the desktop dialog as Step 1 of 2', async () => {
      renderSection();

      const dialog = await openDialog();

      expect(within(dialog).getByText('Step 1 of 2')).toBeInTheDocument();
    });
  });

  describe('phone variant', () => {
    function renderPhoneSection() {
      return render(<DeleteAccountSection variant="phone" />);
    }

    it('shows the row with its description and opens the Step 1 sheet', async () => {
      renderPhoneSection();

      const row = screen.getByTestId('delete-account-button');
      expect(row).toHaveTextContent('Delete account…');
      expect(row).toHaveTextContent(
        'Deleting your account removes the account itself',
      );

      const dialog = await openDialog();

      expect(within(dialog).getByText('Step 1 of 2')).toBeInTheDocument();
      expect(
        within(dialog).getByRole('heading', { name: 'Delete account' }),
      ).toBeInTheDocument();
      expect(within(dialog).getByTestId('escape-copy-button')).toBeVisible();
    });

    it('moves to Step 2 from Continue without a copy with labelled password and confirmation fields', async () => {
      renderPhoneSection();
      const dialog = await openDialog();

      fireEvent.click(screen.getByTestId('delete-account-continue'));
      await screen.findByTestId('delete-account-password');

      expect(within(dialog).getByText('Step 2 of 2')).toBeInTheDocument();
      expect(
        within(dialog).getByRole('heading', {
          name: 'Confirm account deletion',
        }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Account password')).toBe(
        screen.getByTestId('delete-account-password'),
      );
      expect(screen.getByLabelText('Type DELETE to confirm')).toBe(
        screen.getByTestId('delete-account-confirmation'),
      );
    });

    it('shows both required messages and does not call the API when submitted empty', async () => {
      renderPhoneSection();
      await openDialog();
      await continueToConfirm();

      submitConfirm();

      expect(
        await screen.findByText('Enter your password.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Type DELETE to confirm.')).toBeInTheDocument();
      expect(mockDeleteMe).not.toHaveBeenCalled();
    });

    it('returns to Step 1 from Back', async () => {
      renderPhoneSection();
      await openDialog();
      await continueToConfirm();

      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(
        await screen.findByTestId('escape-copy-button'),
      ).toBeInTheDocument();
      expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
      expect(screen.queryByTestId('delete-account-password')).toBeNull();
    });

    it('switches the continue button to Continue after a successful Escape Copy download', async () => {
      renderPhoneSection();
      await openDialog();

      fireEvent.click(screen.getByTestId('escape-copy-button'));

      expect(await screen.findByText('Escape Copy downloaded.')).toBeVisible();
      expect(mockExportVaultNow).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('delete-account-continue').textContent).toBe(
        'Continue',
      );
    });
  });
});
