/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

jest.mock('next/link', () => {
  const React = require('react');

  return {
    __esModule: true,
    default: ({
      children,
      href,
      ...props
    }: {
      children: React.ReactNode;
      href: string;
    }) => React.createElement('a', { href, ...props }, children),
  };
});

import type { AdminOverviewResponse } from '@myorganiser/app-api-client';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../../lib/apiClient';
import { AdminOverviewProvider } from '../../hooks/use-admin-overview';

import { OverviewPageClient } from './OverviewPageClient';

const mockGetAdminOverview = jest.fn();
const mockListAuditLogs = jest.fn();

const overviewFixture: AdminOverviewResponse = {
  users: 148,
  usersJoinedLast7Days: 6,
  platformAdmins: 3,
  unverified: 12,
  unverifiedOverAWeek: 5,
  disabled: 4,
  youtubeAccessPlacesUsed: 20,
  youtubeAccessPlacesLeft: 5,
  youtubeAccessCeiling: 25,
  feedbackReportsReceived: 0,
};

const zeroOverviewFixture: AdminOverviewResponse = {
  users: 0,
  usersJoinedLast7Days: 0,
  platformAdmins: 1,
  unverified: 0,
  unverifiedOverAWeek: 0,
  disabled: 0,
  youtubeAccessPlacesUsed: 0,
  youtubeAccessPlacesLeft: 25,
  youtubeAccessCeiling: 25,
  feedbackReportsReceived: 0,
};

async function renderPage() {
  await act(async () => {
    render(
      <AdminOverviewProvider>
        <OverviewPageClient />
      </AdminOverviewProvider>,
    );
  });
}

describe('OverviewPageClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      getAdminOverview: mockGetAdminOverview,
      listAuditLogs: mockListAuditLogs,
    });
    mockGetAdminOverview.mockResolvedValue({ data: overviewFixture });
    mockListAuditLogs.mockResolvedValue({
      data: { entries: [], total: 0, page: 1, pageSize: 5 },
    });
  });

  it('shows the loading status before the overview resolves', async () => {
    mockGetAdminOverview.mockReturnValue(new Promise(() => undefined));

    await renderPage();

    const statuses = screen.getAllByRole('status');
    expect(statuses.some((el) => el.textContent === 'Loading…')).toBe(true);
  });

  it('renders both h1 headings once loaded', async () => {
    await renderPage();

    await screen.findByRole('region', { name: 'Key numbers' });

    const headingTexts = screen
      .getAllByRole('heading', { level: 1 })
      .map((heading) => heading.textContent);
    expect(headingTexts).toEqual(
      expect.arrayContaining(['Platform overview', 'Overview']),
    );
  });

  it('shows the user count and the joined-this-week note in Key numbers', async () => {
    await renderPage();

    const keyNumbers = await screen.findByRole('region', {
      name: 'Key numbers',
    });

    expect(within(keyNumbers).getByText('148')).toBeInTheDocument();
    expect(within(keyNumbers).getByText('+6 this week')).toBeInTheDocument();
  });

  it('sets the YouTube Access places progressbar from used and ceiling', async () => {
    await renderPage();

    const progressbar = await screen.findByRole('progressbar', {
      name: 'YouTube Access places used',
    });

    expect(progressbar).toHaveAttribute('aria-valuenow', '20');
    expect(progressbar).toHaveAttribute('aria-valuemax', '25');
  });

  it('lists the three Needs attention rows when all three conditions hold', async () => {
    await renderPage();

    const needsAttention = await screen.findByRole('region', {
      name: 'Needs attention',
    });
    const rows = within(needsAttention).getAllByRole('listitem');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('5 accounts unverified for over a week');
    expect(rows[1]).toHaveTextContent('YouTube Access places running low');
    expect(rows[2]).toHaveTextContent('4 accounts disabled');
  });

  it('does not render the Withdraw unused access sentence anywhere on the page', async () => {
    await renderPage();

    await screen.findByRole('region', { name: 'Needs attention' });

    expect(
      screen.queryByText(/Withdraw unused access/i),
    ).not.toBeInTheDocument();
  });

  it('omits the Needs attention section when no condition holds', async () => {
    mockGetAdminOverview.mockResolvedValue({ data: zeroOverviewFixture });

    await renderPage();

    await screen.findByRole('region', { name: 'Key numbers' });

    // Both breakpoints: the desktop region and the phone heading "NEEDS ATTENTION · 0".
    expect(
      screen.queryByRole('region', { name: /needs attention/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /needs attention/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the error alert and re-fetches when Try again is clicked', async () => {
    mockGetAdminOverview.mockRejectedValue(new Error('network down'));

    await renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Unable to load overview. Please try again.',
    );
    expect(mockGetAdminOverview).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(mockGetAdminOverview).toHaveBeenCalledTimes(2);
    });
    await screen.findByRole('alert');
  });
});
