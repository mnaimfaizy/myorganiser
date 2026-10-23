/* eslint-disable import/first -- jest.mock must precede application imports */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

/**
 * The lock state and the session are the hero's only collaborators. The lock
 * state is stubbed directly, so the hero's own branch is what is under test.
 */
jest.mock('@myorganiser/web-vault-ui', () => ({
  useOptionalVaultSession: jest.fn(),
  useVaultLockState: jest.fn(),
}));

/**
 * The illustration is stubbed so its size prop is observable. useIsMobile is
 * stubbed so the hero's compact and desktop sizes can be driven.
 */
jest.mock('@myorganiser/web-ui', () => {
  const actual = jest.requireActual('@myorganiser/web-ui');
  return {
    ...actual,
    Illustration: ({ size }: { size: number }) => (
      <svg data-testid="illustration" data-size={size} />
    ),
    useIsMobile: jest.fn(() => false),
  };
});

import {
  useOptionalVaultSession,
  useVaultLockState,
} from '@myorganiser/web-vault-ui';
import { useIsMobile } from '@myorganiser/web-ui';
import { VaultStatusHero } from './VaultStatusHero';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('VaultStatusHero', () => {
  let mockLock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLock = jest.fn();
    (useVaultLockState as jest.Mock).mockReturnValue('unlocked');
    (useOptionalVaultSession as jest.Mock).mockReturnValue({ lock: mockLock });
    (useIsMobile as jest.Mock).mockReturnValue(false);
  });

  test('renders the unlocked h1 and the on-device line, with no chips when no escape copy is given', () => {
    render(<VaultStatusHero />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Your vault is unlocked' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Unlocked on this device for this session'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Linked to Google Drive'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Newest copy:/)).not.toBeInTheDocument();
  });

  test('Lock vault calls session.lock', () => {
    render(<VaultStatusHero />);

    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }));

    expect(mockLock).toHaveBeenCalledTimes(1);
  });

  test('shows the linked chip and the newest copy age when the escape copy is linked and dated', () => {
    render(
      <VaultStatusHero
        escapeCopy={{
          linked: true,
          newestCopyCreatedAt: new Date(Date.now() - 3 * DAY_MS).toISOString(),
        }}
      />,
    );

    expect(screen.getByText('Linked to Google Drive')).toBeInTheDocument();
    expect(screen.getByText('Newest copy: 3 days old')).toBeInTheDocument();
  });

  test('shows no newest-copy chip for a null or unknown newest copy, but keeps the linked chip', () => {
    const { rerender } = render(
      <VaultStatusHero
        escapeCopy={{ linked: true, newestCopyCreatedAt: null }}
      />,
    );

    expect(screen.getByText('Linked to Google Drive')).toBeInTheDocument();
    expect(screen.queryByText(/Newest copy:/)).not.toBeInTheDocument();

    rerender(
      <VaultStatusHero
        escapeCopy={{ linked: true, newestCopyCreatedAt: undefined }}
      />,
    );

    expect(screen.getByText('Linked to Google Drive')).toBeInTheDocument();
    expect(screen.queryByText(/Newest copy:/)).not.toBeInTheDocument();
  });

  test('shows the newest-copy chip but not the linked chip when the connection is not linked', () => {
    render(
      <VaultStatusHero
        escapeCopy={{
          linked: false,
          newestCopyCreatedAt: new Date(Date.now() - 3 * DAY_MS).toISOString(),
        }}
      />,
    );

    expect(
      screen.queryByText('Linked to Google Drive'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Newest copy: 3 days old')).toBeInTheDocument();
  });

  test('uses the compact illustration below md and the desktop size at md and up', () => {
    const { unmount } = render(<VaultStatusHero />);
    expect(screen.getByTestId('illustration')).toHaveAttribute(
      'data-size',
      '112',
    );
    unmount();

    (useIsMobile as jest.Mock).mockReturnValue(true);
    render(<VaultStatusHero />);
    expect(screen.getByTestId('illustration')).toHaveAttribute(
      'data-size',
      '64',
    );
  });

  test('renders nothing unless the vault is unlocked', () => {
    for (const lockState of ['locked', 'no-session']) {
      (useVaultLockState as jest.Mock).mockReturnValue(lockState);

      const { container, unmount } = render(<VaultStatusHero />);

      expect(container.firstChild).toBeNull();
      expect(
        screen.queryByRole('heading', { level: 1 }),
      ).not.toBeInTheDocument();

      unmount();
    }
  });
});
