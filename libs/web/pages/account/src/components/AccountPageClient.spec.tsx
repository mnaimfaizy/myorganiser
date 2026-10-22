/* eslint-disable import/first -- jest.mock must precede application imports */

// Page-level layout: which variant renders, and whether the YouTube digest
// card is present. Hooks, the user lookup, the breakpoint, and the feedback
// API are mocked at the module boundary; the sections render for real.

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(),
}));

jest.mock('@myorganiser/auth', () => ({
  ...jest.requireActual('@myorganiser/auth'),
  getCurrentUser: jest.fn(),
}));

jest.mock('../hooks/use-account-preferences', () => ({
  useAccountPreferences: jest.fn(),
}));

jest.mock('../hooks/use-youtube-digest-settings', () => ({
  useYouTubeDigestSettings: jest.fn(),
}));

jest.mock('../hooks/useLatestBackup', () => ({
  useLatestBackup: jest.fn(),
}));

jest.mock('../lib/apiClient', () => ({
  createFeedbackApi: jest.fn(),
}));

import { getCurrentUser } from '@myorganiser/auth';
import { useIsMobileState } from '@myorganiser/web-ui';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { useAccountPreferences } from '../hooks/use-account-preferences';
import { useYouTubeDigestSettings } from '../hooks/use-youtube-digest-settings';
import { useLatestBackup } from '../hooks/useLatestBackup';
import { createFeedbackApi } from '../lib/apiClient';

import { AccountPageClient } from './AccountPageClient';

const USER = { name: 'Ada Lovelace', email: 'ada@example.com' };

const PREFERENCES = {
  countryCode: 'AU',
  setCountryCode: jest.fn(),
  preferredCurrency: 'AUD',
  setPreferredCurrency: jest.fn(),
  save: jest.fn(),
};

function digestSettings(connected: boolean) {
  return {
    connected,
    enabled: true,
    setEnabled: jest.fn(),
    weekday: 1,
    setWeekday: jest.fn(),
    saving: false,
    save: jest.fn(),
    timeZone: 'Australia/Sydney',
  };
}

function setBreakpoint(isPhone: boolean | undefined) {
  (useIsMobileState as jest.Mock).mockReturnValue(isPhone);
}

function setDigestConnected(connected: boolean) {
  (useYouTubeDigestSettings as jest.Mock).mockReturnValue(
    digestSettings(connected),
  );
}

describe('AccountPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (getCurrentUser as jest.Mock).mockReturnValue(USER);
    (useAccountPreferences as jest.Mock).mockReturnValue(PREFERENCES);
    (useLatestBackup as jest.Mock).mockReturnValue({
      status: 'empty',
      record: null,
    });
    // The reports summary fetch is not under test here; keep it pending so its
    // state update does not land outside act().
    (createFeedbackApi as jest.Mock).mockReturnValue({
      listReports: jest.fn(() => new Promise(() => {})),
    });
    setDigestConnected(false);
    setBreakpoint(false);
  });

  it('renders nothing until the breakpoint is known', () => {
    setBreakpoint(undefined);

    const { container } = render(<AccountPageClient />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('renders the desktop layout with the verified badge and a single name heading', () => {
    setBreakpoint(false);

    render(<AccountPageClient />);

    expect(screen.getByText('EMAIL VERIFIED')).toBeVisible();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Ada Lovelace');
  });

  it('renders the phone layout without the verified badge and keeps a single name heading', () => {
    setBreakpoint(true);

    render(<AccountPageClient />);

    expect(screen.queryByText('EMAIL VERIFIED')).toBeNull();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Ada Lovelace');
  });

  it('omits the YouTube digest card when the YouTube account is not connected', () => {
    setDigestConnected(false);

    render(<AccountPageClient />);

    expect(
      screen.queryByRole('heading', { name: 'Weekly YouTube digest' }),
    ).toBeNull();
  });

  it('shows the YouTube digest card when the YouTube account is connected', () => {
    setDigestConnected(true);

    render(<AccountPageClient />);

    expect(
      screen.getByRole('heading', { name: 'Weekly YouTube digest' }),
    ).toBeInTheDocument();
  });

  it('renders the desktop layout for a signed-out user with an empty name heading and the verified badge', () => {
    (getCurrentUser as jest.Mock).mockReturnValue(undefined);
    setBreakpoint(false);

    render(<AccountPageClient />);

    expect(screen.getByText('EMAIL VERIFIED')).toBeVisible();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('');
  });
});
