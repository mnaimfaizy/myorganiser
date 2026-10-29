/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('@myorganiser/auth', () => ({
  ...jest.requireActual('@myorganiser/auth'),
  resendVerificationEmail: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
}));

import { resendVerificationEmail } from '@myorganiser/auth';
import { useToast } from '@myorganiser/web-ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';

import {
  expectResendErrorToast,
  SERVER_RESEND_MESSAGE,
} from '../../../_test-support/resendErrorToast';
import VerifyEmailSentClient from './VerifyEmailSentClient';

const mockToast = jest.fn();
const mockGet = jest.fn();

describe('VerifyEmailSentClient resend verification error message', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    mockGet.mockImplementation((key: string) =>
      key === 'email' ? 'jane.doe@example.com' : null,
    );
    (useSearchParams as jest.Mock).mockReturnValue({ get: mockGet });
  });

  it('shows the server resend error message in the destructive toast', async () => {
    (resendVerificationEmail as jest.Mock).mockRejectedValue(
      new Error(SERVER_RESEND_MESSAGE),
    );

    render(<VerifyEmailSentClient />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Resend verification email' }),
    );

    expect(resendVerificationEmail).toHaveBeenCalledWith(
      'jane.doe@example.com',
    );

    await expectResendErrorToast(mockToast, SERVER_RESEND_MESSAGE);
  });
});
