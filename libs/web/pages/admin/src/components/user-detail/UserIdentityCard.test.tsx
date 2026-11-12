/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import { useToast } from '@myorganiser/web-ui';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UserIdentityCard } from './UserIdentityCard';

// The disabled day is three calendar days before today, so the card's
// unpinned "now" reads "3 days ago" whatever the time of day.
const today = new Date();
const DISABLED_THREE_DAYS_AGO = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate() - 3,
  12,
).toISOString();

const disabledUser: AdminUserIdentity = {
  id: 'u-2c9f1e7a-4b3d-4e8a-9f10-5d6c7b8a9e01',
  name: 'Grace Hopper',
  email: 'grace@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
  phone: '+1-555-0100',
  role: 'user',
  disabled: true,
  disabledAt: DISABLED_THREE_DAYS_AGO,
  emailVerified: true,
  youtubeAccess: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActiveAt: null,
};

beforeEach(() => {
  (useToast as jest.Mock).mockReset();
  (useToast as jest.Mock).mockReturnValue({ toast: jest.fn() });
});

describe('UserIdentityCard for a Disabled User', () => {
  it.each(['desktop', 'phone'] as const)(
    'shows the Disabled pill and the disabled day in the meta line on %s',
    (variant) => {
      render(<UserIdentityCard user={disabledUser} variant={variant} />);

      const identity = screen.getByRole('region', { name: 'Identity' });
      expect(within(identity).getByText('Disabled')).toBeInTheDocument();
      expect(
        within(identity).getByText(/Disabled 3 days ago$/),
      ).toHaveTextContent(
        /^grace@example\.com · \+1-555-0100 · Joined .+ · Never active · Disabled 3 days ago$/,
      );
    },
  );
});
