import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { YouTubeSubscription } from '../types';
import { SubscriptionManager } from './SubscriptionManager';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Real web-ui components (Switch, ChoiceChip, Input, Button) render in jsdom.
// Only Skeleton is stubbed so the loading state can be found by test id.
jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  Skeleton: ({ className }: any) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

const mockSubs: YouTubeSubscription[] = [
  {
    id: 'sub-1',
    channelId: 'ch-1',
    channelTitle: 'Alpha Channel',
    channelThumbnail: 'https://example.com/thumb1.jpg',
    uploadsPlaylistId: 'UU123',
    enabled: true,
    lastSyncedAt: null,
  },
  {
    id: 'sub-2',
    channelId: 'ch-2',
    channelTitle: 'Beta Channel',
    channelThumbnail: null,
    uploadsPlaylistId: 'UU456',
    enabled: false,
    lastSyncedAt: null,
  },
];

describe('SubscriptionManager', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  const defaultProps = {
    subscriptions: mockSubs,
    loading: false,
    onSync: jest.fn(),
    onToggle: jest.fn(),
    onRequestDisconnect: jest.fn(),
  };

  it('should render subscription channel titles', () => {
    render(<SubscriptionManager {...defaultProps} />);
    expect(screen.getByText('Alpha Channel')).toBeTruthy();
    expect(screen.getByText('Beta Channel')).toBeTruthy();
  });

  it('should render refresh channels button', () => {
    render(<SubscriptionManager {...defaultProps} />);
    expect(screen.getByText('Refresh channels')).toBeTruthy();
  });

  it('should render disconnect button', () => {
    render(<SubscriptionManager {...defaultProps} />);
    const disconnectBtn = screen.getByRole('button', {
      name: 'Disconnect YouTube account',
    });
    expect(disconnectBtn).toBeEnabled();
    expect(disconnectBtn).toHaveTextContent('Disconnect…');
  });

  it('should call onSync when refresh channels button is clicked', () => {
    const onSync = jest.fn();
    render(<SubscriptionManager {...defaultProps} onSync={onSync} />);
    fireEvent.click(screen.getByText('Refresh channels'));
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('disables refresh channels and does not call onSync when syncBusy', () => {
    const onSync = jest.fn();
    render(
      <SubscriptionManager {...defaultProps} onSync={onSync} syncBusy={true} />,
    );

    const refreshBtn = screen.getByRole('button', { name: 'Refresh channels' });
    expect(refreshBtn).toBeDisabled();
    fireEvent.click(refreshBtn);
    expect(onSync).not.toHaveBeenCalled();
  });

  it('shows cooldown label on refresh channels when syncRetryAt is in the future', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    render(<SubscriptionManager {...defaultProps} syncRetryAt={future} />);

    expect(
      screen.getByRole('button', {
        name: /Refresh channels disabled until/i,
      }),
    ).toBeDisabled();
  });

  it('shows Refreshing… while loading', () => {
    render(<SubscriptionManager {...defaultProps} loading={true} />);
    expect(screen.getByText('Refreshing…')).toBeInTheDocument();
  });

  it('should call onRequestDisconnect when disconnect button is clicked', () => {
    const onRequestDisconnect = jest.fn();
    render(
      <SubscriptionManager
        {...defaultProps}
        onRequestDisconnect={onRequestDisconnect}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Disconnect YouTube account' }),
    );
    expect(onRequestDisconnect).toHaveBeenCalledTimes(1);
  });

  it('should call onToggle when a sync switch is clicked', () => {
    const onToggle = jest.fn();
    render(<SubscriptionManager {...defaultProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Sync Alpha Channel' }));
    expect(onToggle).toHaveBeenCalledWith('sub-1', false);
  });

  it('should show loading skeletons when loading with no data', () => {
    render(
      <SubscriptionManager
        {...defaultProps}
        subscriptions={[]}
        loading={true}
      />,
    );
    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should show empty message when no subscriptions', () => {
    render(<SubscriptionManager {...defaultProps} subscriptions={[]} />);
    expect(screen.getByText(/No subscriptions found/)).toBeTruthy();
  });

  it('should render channel thumbnail for first sub and fallback for second', () => {
    const { container } = render(<SubscriptionManager {...defaultProps} />);
    // The thumbnail is decorative (alt="" beside the name), so it has no img role.
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('https://example.com/thumb1.jpg');
    // Second sub should have a letter fallback
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('keeps disconnect disabled and does not call onRequestDisconnect when disconnectDisabled', () => {
    const onRequestDisconnect = jest.fn();
    render(
      <SubscriptionManager
        {...defaultProps}
        onRequestDisconnect={onRequestDisconnect}
        disconnectDisabled={true}
        disconnectDisabledReason="Disconnect unavailable while a sync is running"
      />,
    );

    const disconnectBtn = screen.getByRole('button', {
      name: 'Disconnect unavailable while a sync is running',
    });
    expect(disconnectBtn).toBeDisabled();
    fireEvent.click(disconnectBtn);
    expect(onRequestDisconnect).not.toHaveBeenCalled();
  });

  it('should render privacy statement and link to data privacy page', () => {
    render(<SubscriptionManager {...defaultProps} />);
    expect(
      screen.getByText(/Metadata only — never video files/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Watched is yes\/no, not analytics/),
    ).toBeInTheDocument();
    const privacyLink = screen.getByRole('link', {
      name: 'Read the details',
    });
    expect(privacyLink).toHaveAttribute('href', '/youtube/data-privacy');
  });

  it('lists Watched marks among what Disconnect deletes', () => {
    render(<SubscriptionManager {...defaultProps} />);
    expect(
      screen.getByText(/Disconnect deletes .*Watched marks/),
    ).toBeInTheDocument();
  });

  it('does not show 30-day retention or opt-in deletion copy', () => {
    render(<SubscriptionManager {...defaultProps} />);
    expect(screen.queryByText(/kept for 30 days/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/unless you choose to delete/),
    ).not.toBeInTheDocument();
  });

  describe('channel filtering', () => {
    const syncFilter = () =>
      screen.getByRole('group', { name: 'Filter channels by sync state' });

    it('filters channel titles case-insensitively and ignores surrounding whitespace', () => {
      render(<SubscriptionManager {...defaultProps} />);

      fireEvent.change(
        screen.getByRole('searchbox', { name: 'Filter channels' }),
        {
          target: { value: '  BETA  ' },
        },
      );

      expect(
        screen.getByRole('button', { name: 'Beta Channel' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Alpha Channel' }),
      ).not.toBeInTheDocument();
    });

    it('shows only enabled channels under the On chip and marks it pressed', () => {
      render(<SubscriptionManager {...defaultProps} />);

      fireEvent.click(
        within(syncFilter()).getByRole('button', { name: 'On · 1' }),
      );

      expect(
        within(syncFilter()).getByRole('button', { name: 'On · 1' }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByRole('button', { name: 'Alpha Channel' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Beta Channel' }),
      ).not.toBeInTheDocument();
    });

    it('shows only disabled channels under the Off chip', () => {
      render(<SubscriptionManager {...defaultProps} />);

      fireEvent.click(
        within(syncFilter()).getByRole('button', { name: 'Off · 1' }),
      );

      expect(
        screen.getByRole('button', { name: 'Beta Channel' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Alpha Channel' }),
      ).not.toBeInTheDocument();
    });

    it('keeps the chip counts at the full totals while a text filter is applied', () => {
      render(<SubscriptionManager {...defaultProps} />);

      fireEvent.change(
        screen.getByRole('searchbox', { name: 'Filter channels' }),
        {
          target: { value: 'alpha' },
        },
      );

      expect(
        within(syncFilter()).getByRole('button', { name: 'All · 2' }),
      ).toBeInTheDocument();
      expect(
        within(syncFilter()).getByRole('button', { name: 'On · 1' }),
      ).toBeInTheDocument();
      expect(
        within(syncFilter()).getByRole('button', { name: 'Off · 1' }),
      ).toBeInTheDocument();
    });

    it('shows "No channels match." when the filter excludes every channel', () => {
      render(<SubscriptionManager {...defaultProps} />);

      fireEvent.change(
        screen.getByRole('searchbox', { name: 'Filter channels' }),
        {
          target: { value: 'zzz' },
        },
      );

      expect(screen.getByText('No channels match.')).toBeInTheDocument();
      expect(
        screen.queryByText(/No subscriptions found/),
      ).not.toBeInTheDocument();
    });

    it('shows "Not synced yet" for an enabled channel with no sync and "Off" for a disabled one', () => {
      render(<SubscriptionManager {...defaultProps} />);

      expect(screen.getByText('Not synced yet')).toBeInTheDocument();
      expect(screen.getByText('Off')).toBeInTheDocument();
    });

    it('shows a "Synced" label for an enabled channel with a last sync', () => {
      const synced: YouTubeSubscription[] = [
        { ...mockSubs[0], lastSyncedAt: new Date().toISOString() },
        mockSubs[1],
      ];
      render(<SubscriptionManager {...defaultProps} subscriptions={synced} />);

      expect(screen.getByText(/^Synced /)).toBeInTheDocument();
      expect(screen.queryByText('Not synced yet')).not.toBeInTheDocument();
    });

    it('shows a Synced date (not a time) for a last sync from an earlier day', () => {
      const earlier = '2020-01-15T12:00:00.000Z';
      const expectedDate = new Date(earlier).toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
      });
      render(
        <SubscriptionManager
          {...defaultProps}
          subscriptions={[{ ...mockSubs[0], lastSyncedAt: earlier }]}
        />,
      );

      expect(screen.getByText(`Synced ${expectedDate}`)).toBeInTheDocument();
    });

    it('shows "Not synced yet" when lastSyncedAt is not a valid date', () => {
      render(
        <SubscriptionManager
          {...defaultProps}
          subscriptions={[{ ...mockSubs[0], lastSyncedAt: 'not-a-date' }]}
        />,
      );

      expect(screen.getByText('Not synced yet')).toBeInTheDocument();
    });

    it('navigates to the channel videos when a channel name is clicked', () => {
      render(<SubscriptionManager {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Alpha Channel' }));

      expect(mockPush).toHaveBeenCalledWith('/dashboard/youtube?channel=ch-1');
    });

    it('links the weekly digest to the account page', () => {
      render(<SubscriptionManager {...defaultProps} />);

      expect(
        screen.getByRole('link', { name: 'Change in Account' }),
      ).toHaveAttribute('href', '/dashboard/account');
    });
  });
});
