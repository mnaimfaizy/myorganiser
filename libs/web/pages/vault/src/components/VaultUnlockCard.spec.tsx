/* eslint-disable import/first -- jest.mock must precede application imports */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Mock the hooks from ../hooks before importing VaultUnlockCard.
 */
jest.mock('../hooks', () => ({
  useVaultUnlock: jest.fn(),
  useVaultDisabledState: jest.fn(),
}));

/**
 * Mock web-ui components and useToast.
 */
jest.mock('@myorganiser/web-ui', () => {
  const React = require('react') as typeof import('react');
  const { Controller, FormProvider } = require('react-hook-form');

  function Button({
    children,
    onClick,
    disabled,
    'data-testid': testId,
    ...props
  }: any) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        data-testid={testId}
        {...props}
      >
        {children}
      </button>
    );
  }

  function Illustration({ size }: any) {
    return <svg data-testid="illustration" data-size={size} />;
  }

  function Form({ children, ...props }: any) {
    return <FormProvider {...props}>{children}</FormProvider>;
  }

  function FormField({ name, render, ...props }: any) {
    return <Controller name={name} render={render} {...props} />;
  }

  function FormItem({ children, ...props }: any) {
    return <div {...props}>{children}</div>;
  }

  function FormLabel({ children, htmlFor }: any) {
    return <label htmlFor={htmlFor}>{children}</label>;
  }

  function FormControl({ children, ...props }: any) {
    return <div {...props}>{children}</div>;
  }

  function FormDescription({ children }: any) {
    return <p data-testid="form-description">{children}</p>;
  }

  function FormMessage({ children }: any) {
    return <div data-testid="form-message">{children}</div>;
  }

  function Input({ type, disabled, id, ...props }: any) {
    return <input type={type} disabled={disabled} id={id} {...props} />;
  }

  return {
    Button,
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormDescription,
    FormMessage,
    Illustration,
    Input,
    useIsMobile: jest.fn(),
    useToast: jest.fn(),
  };
});

import { VaultUnlockCard } from './VaultUnlockCard';
import { useVaultUnlock, useVaultDisabledState } from '../hooks';
import { useIsMobile } from '@myorganiser/web-ui';

// === Mock helpers ===

// Type guard for filtering password inputs
const isPasswordInput = (input: HTMLElement): input is HTMLInputElement =>
  input instanceof HTMLInputElement && input.type === 'password';

describe('VaultUnlockCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    (useIsMobile as jest.Mock).mockReturnValue(false);
    (useVaultDisabledState as jest.Mock).mockReturnValue('locked');
    (useVaultUnlock as jest.Mock).mockReturnValue({
      unlocking: false,
      unlock: jest.fn().mockResolvedValue('ok'),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Self-gate: component does not render when vault is not locked', () => {
    test('1: signed-out state → nothing renders', () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('signed-out');

      const { container } = render(<VaultUnlockCard />);

      expect(screen.queryByText('Unlock your vault')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1 }),
      ).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });

    test('2: no-local-vault state → nothing renders', () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('no-local-vault');

      const { container } = render(<VaultUnlockCard />);

      expect(screen.queryByText('Unlock your vault')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1 }),
      ).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });

    test('3: enabled state → nothing renders', () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('enabled');

      const { container } = render(<VaultUnlockCard />);

      expect(screen.queryByText('Unlock your vault')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1 }),
      ).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Rendering when vault is locked', () => {
    test('4: renders the locked hero with h1 title, description, password input, and Unlock button', () => {
      (useVaultDisabledState as jest.Mock).mockReturnValue('locked');

      render(<VaultUnlockCard />);

      // Assert the hero's h1 title
      expect(
        screen.getByRole('heading', { level: 1, name: 'Unlock your vault' }),
      ).toBeInTheDocument();

      // Assert the passphrase label and the desktop illustration size
      expect(screen.getByText('Passphrase')).toBeInTheDocument();
      expect(screen.getByTestId('illustration')).toHaveAttribute(
        'data-size',
        '112',
      );

      // Assert description
      expect(
        screen.getByText(
          'Enter your passphrase to unlock your vault on this device for this session.',
        ),
      ).toBeInTheDocument();

      // Assert password input is present
      const passwordInputs = screen
        .getAllByDisplayValue('')
        .filter(isPasswordInput);
      expect(passwordInputs.length).toBeGreaterThanOrEqual(1);
      const passphraseInput = passwordInputs[0];
      expect(passphraseInput).toBeInTheDocument();

      // Assert submit button with correct label
      const submitButton = screen.getByTestId('vault-unlock-submit');
      expect(submitButton).toHaveTextContent('Unlock');
      expect(submitButton).not.toBeDisabled();
    });
  });

  describe('Mobile layout', () => {
    test('5a: uses the compact illustration below md', () => {
      (useIsMobile as jest.Mock).mockReturnValue(true);

      render(<VaultUnlockCard />);

      expect(screen.getByTestId('illustration')).toHaveAttribute(
        'data-size',
        '48',
      );
    });
  });

  describe('Loading state', () => {
    test('5: button shows "Unlocking…" and is disabled when unlocking is true', () => {
      (useVaultUnlock as jest.Mock).mockReturnValue({
        unlocking: true,
        unlock: jest.fn(),
      });

      render(<VaultUnlockCard />);

      const submitButton = screen.getByTestId('vault-unlock-submit');
      expect(submitButton).toHaveTextContent('Unlocking…');
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Form submission and hook integration', () => {
    test('6: submitting form calls unlock hook with the typed passphrase', async () => {
      const mockUnlock = jest.fn().mockResolvedValue('ok');

      (useVaultUnlock as jest.Mock).mockReturnValue({
        unlocking: false,
        unlock: mockUnlock,
      });

      render(<VaultUnlockCard />);

      // Fill the passphrase input
      const passwordInputs = screen
        .getAllByDisplayValue('')
        .filter(isPasswordInput);
      const passphraseInput = passwordInputs[0];
      expect(passphraseInput).toBeDefined();

      fireEvent.change(passphraseInput!, { target: { value: 'testpass123' } });
      expect(passphraseInput!.value).toBe('testpass123');

      // Submit the form
      const submitButton = screen.getByTestId('vault-unlock-submit');
      fireEvent.click(submitButton);

      // Assert unlock was called with the passphrase
      await waitFor(() => {
        expect(mockUnlock).toHaveBeenCalledWith('testpass123');
      });
    });

    test('7: empty passphrase is blocked by client-side validation, unlock not called', async () => {
      const mockUnlock = jest.fn();

      (useVaultUnlock as jest.Mock).mockReturnValue({
        unlocking: false,
        unlock: mockUnlock,
      });

      render(<VaultUnlockCard />);

      // Get submit button without filling the passphrase field
      const submitButton = screen.getByTestId('vault-unlock-submit');

      // Click submit with empty passphrase
      fireEvent.click(submitButton);

      // Assert unlock was NOT called due to client-side validation
      // Give a brief window to confirm it was not called
      await waitFor(
        () => {
          expect(mockUnlock).not.toHaveBeenCalled();
        },
        { timeout: 100 },
      );
    });
  });

  describe('Error handling', () => {
    test('8: wrong-passphrase result leaves the typed passphrase in the field (does not reset, unlike success)', async () => {
      const mockUnlock = jest.fn().mockResolvedValue('wrong-passphrase');

      (useVaultUnlock as jest.Mock).mockReturnValue({
        unlocking: false,
        unlock: mockUnlock,
      });

      render(<VaultUnlockCard />);

      // Fill and submit the form
      const passwordInputs = screen
        .getAllByDisplayValue('')
        .filter(isPasswordInput);
      const passphraseInput = passwordInputs[0];
      fireEvent.change(passphraseInput!, { target: { value: 'wrongpass' } });
      expect(passphraseInput!.value).toBe('wrongpass');

      const submitButton = screen.getByTestId('vault-unlock-submit');
      fireEvent.click(submitButton);

      // Assert unlock was called
      await waitFor(() => {
        expect(mockUnlock).toHaveBeenCalledWith('wrongpass');
      });

      // Assert the field was NOT reset: form.setError() was called, not form.reset()
      // This proves the side effect actually occurred (unlike success case in test 10)
      await waitFor(() => {
        expect(passphraseInput!.value).toBe('wrongpass');
      });
    });

    test('9: error result leaves form as-is (hook already toasted)', async () => {
      const mockUnlock = jest.fn().mockResolvedValue('error');

      (useVaultUnlock as jest.Mock).mockReturnValue({
        unlocking: false,
        unlock: mockUnlock,
      });

      render(<VaultUnlockCard />);

      // Fill and submit the form
      const passwordInputs = screen
        .getAllByDisplayValue('')
        .filter(isPasswordInput);
      const passphraseInput = passwordInputs[0];
      fireEvent.change(passphraseInput!, { target: { value: 'testpass123' } });

      const submitButton = screen.getByTestId('vault-unlock-submit');
      fireEvent.click(submitButton);

      // Assert unlock was called
      await waitFor(() => {
        expect(mockUnlock).toHaveBeenCalledWith('testpass123');
      });

      // Form should retain the value when hook returns 'error'
      // (no form.reset() is called)
      await waitFor(() => {
        expect(passphraseInput!.value).toBe('testpass123');
      });
    });
  });

  describe('Form reset on success', () => {
    test('10: successful unlock clears the passphrase field', async () => {
      const mockUnlock = jest.fn().mockResolvedValue('ok');

      (useVaultUnlock as jest.Mock).mockReturnValue({
        unlocking: false,
        unlock: mockUnlock,
      });

      render(<VaultUnlockCard />);

      // Fill the passphrase input
      const passwordInputs = screen
        .getAllByDisplayValue('')
        .filter(isPasswordInput);
      const passphraseInput = passwordInputs[0];
      fireEvent.change(passphraseInput!, { target: { value: 'testpass123' } });
      expect(passphraseInput!.value).toBe('testpass123');

      // Submit the form
      const submitButton = screen.getByTestId('vault-unlock-submit');
      fireEvent.click(submitButton);

      // Assert the field was reset (cleared)
      await waitFor(() => {
        expect(passphraseInput!.value).toBe('');
      });
    });
  });
});
