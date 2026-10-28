/**
 * Shared fixture for the two auth specs that assert the "could not resend
 * verification email" destructive toast: login's inline resend prompt and
 * the standalone verify-email-sent page. Both components surface the same
 * server message through the same toast contract, so the expectation lives
 * once here instead of being duplicated per spec.
 */

import { waitFor } from '@testing-library/react';

export const SERVER_RESEND_MESSAGE =
  'A verification email was already sent recently. Please check your inbox and try again later.';

export async function expectResendErrorToast(
  mockToast: jest.Mock,
  message: string,
): Promise<void> {
  await waitFor(() => {
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not resend verification email',
        description: message,
        variant: 'destructive',
      }),
    );
  });
}
