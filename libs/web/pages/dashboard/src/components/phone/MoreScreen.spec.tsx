/* eslint-disable import/first */
jest.mock('@myorganiser/auth', () => ({
  ...jest.requireActual('@myorganiser/auth'),
  getCurrentUser: jest.fn(),
}));

jest.mock('../../lib/apiClient', () => ({
  createFeedbackApi: jest.fn(),
}));

jest.mock('../../hooks/use-feedback-dialog', () => ({
  openFeedbackDialog: jest.fn(),
}));

jest.mock('../../hooks/use-log-out', () => ({
  useLogOut: jest.fn(),
}));

jest.mock('../../hooks/useYouTubeNavVisible', () => ({
  useYouTubeNavVisible: jest.fn(),
}));

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { getCurrentUser } from '@myorganiser/auth';
import { createFeedbackApi } from '../../lib/apiClient';
import { openFeedbackDialog } from '../../hooks/use-feedback-dialog';
import { useLogOut } from '../../hooks/use-log-out';
import { useYouTubeNavVisible } from '../../hooks/useYouTubeNavVisible';
import { MoreScreen } from './MoreScreen';

type Role = 'platform_admin' | 'user';

function stubUser({
  name = 'Ada Lovelace',
  email = 'ada@example.com',
  role = 'user',
}: { name?: string; email?: string; role?: Role } = {}) {
  (getCurrentUser as jest.Mock).mockReturnValue({ name, email, role });
}

/**
 * The reports effect runs during render's act(). Its promise resolves in a
 * microtask, so flush it inside act() before asserting or unmounting.
 */
const listReports = jest.fn();
const logOut = jest.fn();

async function settleReports() {
  expect(listReports).toHaveBeenCalledTimes(1);
  await act(async () => {});
}

describe('MoreScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useLogOut as jest.Mock).mockReturnValue(logOut);
    (createFeedbackApi as jest.Mock).mockReturnValue({ listReports });
    listReports.mockResolvedValue({ data: { hasChangedSinceLastSeen: false } });
    (useYouTubeNavVisible as jest.Mock).mockReturnValue(true);
    stubUser();
  });

  it('renders the More title and the ORGANISE and YOU section headings', async () => {
    render(<MoreScreen />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'More' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'ORGANISE' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'YOU' }),
    ).toBeInTheDocument();
    await settleReports();
  });

  it('keeps the More h1 visible on the phone, hidden only from md up', async () => {
    render(<MoreScreen />);

    const title = screen.getByRole('heading', { level: 1, name: 'More' });
    expect(title.classList).not.toContain('sr-only');
    expect(title).toHaveClass('md:sr-only');
    await settleReports();
  });

  it('links the Subscriptions, Addresses, Mobile numbers and YouTube sections when YouTube is visible', async () => {
    render(<MoreScreen />);

    expect(screen.getByRole('link', { name: 'Subscriptions' })).toHaveAttribute(
      'href',
      '/dashboard/subscriptions',
    );
    expect(screen.getByRole('link', { name: 'Addresses' })).toHaveAttribute(
      'href',
      '/dashboard/addresses',
    );
    expect(
      screen.getByRole('link', { name: 'Mobile numbers' }),
    ).toHaveAttribute('href', '/dashboard/mobile-numbers');
    expect(screen.getByRole('link', { name: 'YouTube' })).toHaveAttribute(
      'href',
      '/dashboard/youtube',
    );
    await settleReports();
  });

  it('omits the YouTube link when YouTube is not visible', async () => {
    (useYouTubeNavVisible as jest.Mock).mockReturnValue(false);
    render(<MoreScreen />);

    expect(
      screen.queryByRole('link', { name: 'YouTube' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Subscriptions' }),
    ).toBeInTheDocument();
    await settleReports();
  });

  it('links the Account and Your reports rows', async () => {
    render(<MoreScreen />);

    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute(
      'href',
      '/dashboard/account',
    );
    expect(screen.getByRole('link', { name: /Your reports/ })).toHaveAttribute(
      'href',
      '/dashboard/account/reports',
    );
    await settleReports();
  });

  it('shows the Admin portal link for a platform admin', async () => {
    stubUser({ role: 'platform_admin' });
    render(<MoreScreen />);

    expect(screen.getByRole('link', { name: 'Admin portal' })).toHaveAttribute(
      'href',
      '/admin',
    );
    await settleReports();
  });

  it('omits the Admin portal link for a non-admin user', async () => {
    stubUser({ role: 'user' });
    render(<MoreScreen />);

    expect(
      screen.queryByRole('link', { name: 'Admin portal' }),
    ).not.toBeInTheDocument();
    await settleReports();
  });

  it('shows the Updated badge when reports changed since last seen', async () => {
    listReports.mockResolvedValue({ data: { hasChangedSinceLastSeen: true } });
    render(<MoreScreen />);

    expect(await screen.findByText('Updated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Your reports/ })).toContainElement(
      screen.getByText('Updated'),
    );
  });

  it('hides the Updated badge when reports have not changed', async () => {
    render(<MoreScreen />);

    await settleReports();
    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
  });

  it('hides the Updated badge and keeps the screen when loading reports fails', async () => {
    listReports.mockRejectedValue(new Error('network down'));
    render(<MoreScreen />);

    await settleReports();
    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Send feedback' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('opens the feedback dialog once when Send feedback is pressed', async () => {
    render(<MoreScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(openFeedbackDialog).toHaveBeenCalledTimes(1);
    await settleReports();
  });

  it('calls the shared log-out handler once when Log out is pressed', async () => {
    render(<MoreScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(logOut).toHaveBeenCalledTimes(1);
    await settleReports();
  });

  it('shows two initials from the name in the Account row', async () => {
    render(<MoreScreen />);

    expect(screen.getByText('AL')).toBeInTheDocument();
    await settleReports();
  });

  it('falls back to the first letter of the email when the name is empty', async () => {
    stubUser({ name: '' });
    render(<MoreScreen />);

    expect(screen.getByText('A')).toBeInTheDocument();
    await settleReports();
  });

  it('shows the User icon and no letters in the Account avatar when there is no user', async () => {
    (getCurrentUser as jest.Mock).mockReturnValue(undefined);
    render(<MoreScreen />);

    const account = screen.getByRole('link', { name: 'Account' });
    expect(account.textContent).toBe('Account');
    const avatar = account.querySelector('[aria-hidden="true"]');
    expect(avatar?.textContent).toBe('');
    expect(avatar?.querySelector('svg')).toBeInTheDocument();
    await settleReports();
  });
});
