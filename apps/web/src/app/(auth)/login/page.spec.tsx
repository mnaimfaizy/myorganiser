/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('@myorganiser/auth', () => ({
  ...jest.requireActual('@myorganiser/auth'),
  login: jest.fn(),
  resendVerificationEmail: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

import { login, resendVerificationEmail } from '@myorganiser/auth';
import { useToast } from '@myorganiser/web-ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRouter } from 'next/navigation';

import {
  expectResendErrorToast,
  SERVER_RESEND_MESSAGE,
} from '../_test-support/resendErrorToast';
import LoginPage from './page';

// jsdom has no ResizeObserver, which the real Radix Checkbox on this form observes.
class ResizeObserverStub {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}
window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const mockToast = jest.fn();
const mockPush = jest.fn();

describe('LoginPage resend verification error message', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  });

  it('shows the server resend error message in the destructive toast', async () => {
    (login as jest.Mock).mockRejectedValue(new Error('Email not verified'));
    (resendVerificationEmail as jest.Mock).mockRejectedValue(
      new Error(SERVER_RESEND_MESSAGE),
    );

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'jane.doe@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'Sample-Pass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    const resendButton = await screen.findByRole('button', {
      name: 'Resend verification email',
    });
    fireEvent.click(resendButton);

    expect(resendVerificationEmail).toHaveBeenCalledWith(
      'jane.doe@example.com',
    );

    await expectResendErrorToast(mockToast, SERVER_RESEND_MESSAGE);
  });
});
