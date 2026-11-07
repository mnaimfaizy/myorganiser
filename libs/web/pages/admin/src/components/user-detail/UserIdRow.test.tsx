/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import { useToast } from '@myorganiser/web-ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserIdRow } from './UserIdRow';
import { UserIdentityCard } from './UserIdentityCard';

const mockToast = jest.fn();

const USER_ID = 'u-2c9f1e7a-4b3d-4e8a-9f10-5d6c7b8a9e01';

const user: AdminUserIdentity = {
  id: USER_ID,
  name: 'Grace Hopper',
  email: 'grace@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
  phone: '+1-555-0100',
  role: 'user',
  disabled: false,
  emailVerified: true,
  youtubeAccess: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActiveAt: null,
};

function setClipboard(value: unknown) {
  Object.defineProperty(window.navigator, 'clipboard', {
    value,
    configurable: true,
  });
}

function clearClipboard() {
  delete (window.navigator as { clipboard?: unknown }).clipboard;
}

beforeEach(() => {
  mockToast.mockReset();
  (useToast as jest.Mock).mockReset();
  (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
  clearClipboard();
});

afterEach(() => {
  clearClipboard();
});

describe('UserIdRow', () => {
  it.each(['desktop', 'phone'] as const)(
    'renders the User ID label and full id in the %s variant',
    (variant) => {
      render(<UserIdRow userId={USER_ID} variant={variant} />);

      expect(screen.getByText('User ID')).toBeInTheDocument();
      expect(screen.getByText(USER_ID)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Copy User ID' }),
      ).toBeInTheDocument();
    },
  );

  it.each(['desktop', 'phone'] as const)(
    'shows the ID row inside UserIdentityCard in the %s variant',
    (variant) => {
      render(<UserIdentityCard user={user} variant={variant} />);

      const identity = screen.getByRole('region', { name: 'Identity' });
      expect(identity).toHaveTextContent('User ID');
      expect(screen.getByText(USER_ID)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Copy User ID' }),
      ).toBeInTheDocument();
    },
  );

  it('writes the exact id to the clipboard and toasts success on click', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<UserIdRow userId={USER_ID} variant="desktop" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy User ID' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({ title: 'User ID copied' });
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(USER_ID);
  });

  it('toasts a destructive failure when the clipboard write rejects', async () => {
    const writeText = jest
      .fn()
      .mockRejectedValue(new Error('Permission denied'));
    setClipboard({ writeText });
    render(<UserIdRow userId={USER_ID} variant="desktop" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy User ID' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Could not copy User ID',
          variant: 'destructive',
        }),
      );
    });
    expect(mockToast).not.toHaveBeenCalledWith({ title: 'User ID copied' });
  });

  it('toasts the same destructive failure when navigator.clipboard is unavailable', async () => {
    setClipboard(undefined);
    render(<UserIdRow userId={USER_ID} variant="phone" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy User ID' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Could not copy User ID',
          variant: 'destructive',
        }),
      );
    });
    expect(mockToast).not.toHaveBeenCalledWith({ title: 'User ID copied' });
  });

  it('exposes the copy control as an enabled, focusable native button', () => {
    render(<UserIdRow userId={USER_ID} variant="desktop" />);

    const button = screen.getByRole('button', { name: 'Copy User ID' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('tabindex', '-1');

    button.focus();
    expect(button).toHaveFocus();
  });

  // Known gap: @testing-library/user-event is not installed and jsdom does not
  // synthesise a click from an Enter keydown. Enter activation is therefore
  // left to the browser's native button behaviour; this asserts the click path
  // that Enter triggers.
});
