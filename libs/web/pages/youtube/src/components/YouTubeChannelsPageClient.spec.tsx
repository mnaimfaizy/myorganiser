import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const mockUseIsMobileState = jest.fn();

jest.mock('@myorganiser/web-ui', () => ({
  // Real Switch and ChoiceChip render in jsdom; the rest of web-ui is stubbed below.
  ...jest.requireActual('@myorganiser/web-ui'),
  cn: (...classes: Array<string | undefined>) =>
    classes.filter(Boolean).join(' '),
  useIsMobileState: () => mockUseIsMobileState(),
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Card: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  CardContent: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
  ConfirmDeleteDialog: ({
    open,
    title,
    description,
    children,
    onConfirm,
    confirmLabel,
  }: any) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <div>{description}</div>
        {children}
        <button
          type="button"
          onClick={() => {
            void Promise.resolve(onConfirm()).catch(() => {
              // Real dialog keeps open on failure; avoid unhandled rejection in tests.
            });
          }}
        >
          {confirmLabel ?? 'Delete'}
        </button>
      </div>
    ) : null,
  Input: (props: any) => <input {...props} />,
  Label: ({ children, htmlFor }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Skeleton: ({ className }: any) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

const mockUseYouTubeAvailability = jest.fn();
const mockUseYouTubeStatus = jest.fn();
const mockUseYouTubeConnect = jest.fn();
const mockUseYouTubeSubscriptions = jest.fn();
const mockUseYouTubeSyncStatus = jest.fn();

jest.mock('../hooks', () => {
  class YouTubeRequestError extends Error {
    readonly status: number;
    readonly code?: string;

    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'YouTubeRequestError';
      this.status = status;
      this.code = code;
    }
  }

  return {
    useYouTubeAvailability: () => mockUseYouTubeAvailability(),
    useYouTubeStatus: () => mockUseYouTubeStatus(),
    useYouTubeConnect: () => mockUseYouTubeConnect(),
    useYouTubeSubscriptions: () => mockUseYouTubeSubscriptions(),
    useYouTubeSyncStatus: () => mockUseYouTubeSyncStatus(),
    useYouTubeAcknowledgement: () => ({
      acknowledged: true,
      loading: false,
      error: null,
      accept: jest.fn(),
    }),
    YouTubeRequestError,
    isRetryCooldownActive: (retryAt?: string | null) =>
      Boolean(retryAt && Date.parse(retryAt) > Date.now()),
    formatRetryAt: (retryAt?: string | null) =>
      retryAt ? new Date(retryAt).toLocaleString() : null,
  };
});

const { YouTubeChannelsPageClient } =
  require('./YouTubeChannelsPageClient') as typeof import('./YouTubeChannelsPageClient');

describe('YouTubeChannelsPageClient', () => {
  const defaultConnect = {
    connect: jest.fn(),
    disconnect: jest.fn(),
  };

  const defaultSubs = {
    subscriptions: [],
    loading: false,
    sync: jest.fn(),
    toggle: jest.fn(),
    refresh: jest.fn(),
  };

  const statusOf = (
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> => ({
    status: 'success' as const,
    lastSyncedAt: null,
    lastSyncAttemptAt: null,
    lastSyncError: null,
    retryAt: null,
    channelStatus: 'never' as const,
    channelLastAttemptAt: null,
    channelLastError: null,
    channelRetryAt: null,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseYouTubeAvailability.mockReturnValue({
      available: true,
      loading: false,
      error: null,
    });
    mockUseIsMobileState.mockReturnValue(false);
    mockUseYouTubeConnect.mockReturnValue(defaultConnect);
    mockUseYouTubeSubscriptions.mockReturnValue(defaultSubs);
    mockUseYouTubeSyncStatus.mockReturnValue({
      status: null,
      loading: false,
      triggerChannelSync: jest.fn().mockResolvedValue(undefined),
      isChannelCooldownActive: false,
      refresh: jest.fn(),
    });
    mockUseYouTubeStatus.mockReturnValue({
      connected: true,
      status: 'connected',
      refresh: jest.fn(),
    });
  });

  const renderConnected = (
    disconnect = jest.fn().mockResolvedValue({ revokeFailed: false }),
    syncStatusOverrides: Record<string, unknown> = {},
  ) => {
    const refreshStatus = jest.fn();
    mockUseYouTubeStatus.mockReturnValue({
      connected: true,
      status: 'connected',
      refresh: refreshStatus,
    });
    mockUseYouTubeConnect.mockReturnValue({
      connect: jest.fn(),
      disconnect,
    });
    mockUseYouTubeSyncStatus.mockReturnValue({
      status: null,
      loading: false,
      triggerChannelSync: jest.fn().mockResolvedValue(undefined),
      isChannelCooldownActive: false,
      refresh: jest.fn(),
      ...syncStatusOverrides,
    });
    render(<YouTubeChannelsPageClient />);
    return { disconnect, refreshStatus };
  };

  const openDisconnectDialog = () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Disconnect YouTube account' }),
    );
    return screen.getByRole('dialog', { name: 'Disconnect YouTube?' });
  };

  it('calls triggerChannelSync when Refresh channels is clicked', async () => {
    const triggerChannelSync = jest.fn().mockResolvedValue(undefined);
    mockUseYouTubeSyncStatus.mockReturnValue({
      status: statusOf({ status: 'never' }),
      loading: false,
      triggerChannelSync,
      isChannelCooldownActive: false,
      refresh: jest.fn(),
    });

    render(<YouTubeChannelsPageClient />);

    // The resolved request now ends the claim wait (#753), so let it settle.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh channels' }));
    });

    expect(triggerChannelSync).toHaveBeenCalledTimes(1);
  });

  describe('channel sync request completion (#753)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const setupChannelSyncTest = (triggerResult: boolean | Error) => {
      const refreshSync = jest
        .fn()
        .mockResolvedValue(statusOf({ status: 'never' }));

      const subs = {
        ...defaultSubs,
        refresh: jest.fn(),
      };
      mockUseYouTubeSubscriptions.mockReturnValue(subs);

      const triggerChannelSync =
        triggerResult instanceof Error
          ? jest.fn().mockRejectedValue(triggerResult)
          : jest.fn().mockResolvedValue(triggerResult);

      renderConnected(jest.fn().mockResolvedValue({ revokeFailed: false }), {
        status: statusOf({ status: 'never' }),
        loading: false,
        triggerChannelSync,
        isChannelCooldownActive: false,
        refresh: refreshSync,
      });

      return { subs };
    };

    it.each([
      {
        label: 'request that ran (success)',
        triggerResult: true,
        shouldRefresh: true,
      },
      {
        label: 'request that did not run (cooldown)',
        triggerResult: false,
        shouldRefresh: false,
      },
      {
        label: 'request rejects',
        triggerResult: new Error('request failed'),
        shouldRefresh: false,
      },
    ])(
      '$label → refreshes subscriptions: $shouldRefresh',
      async ({ triggerResult, shouldRefresh }) => {
        const { subs } = setupChannelSyncTest(triggerResult);

        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: 'Refresh channels' }),
          );
        });

        await act(async () => {
          jest.advanceTimersByTime(0);
        });

        if (shouldRefresh) {
          expect(subs.refresh).toHaveBeenCalledTimes(1);
        } else {
          expect(subs.refresh).not.toHaveBeenCalled();
        }
      },
    );

    it('after a request that ran, the claim-wait poll is not repeated on the 5s interval', async () => {
      const refreshSync = jest
        .fn()
        .mockResolvedValue(statusOf({ status: 'never' }));
      const triggerChannelSync = jest.fn().mockResolvedValue(true);

      const subs = {
        ...defaultSubs,
        refresh: jest.fn(),
      };
      mockUseYouTubeSubscriptions.mockReturnValue(subs);

      renderConnected(jest.fn().mockResolvedValue({ revokeFailed: false }), {
        status: statusOf({ status: 'never' }),
        loading: false,
        triggerChannelSync,
        isChannelCooldownActive: false,
        refresh: refreshSync,
      });

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Refresh channels' }),
        );
      });

      // Initial claim-wait poll from request resolution
      expect(refreshSync).toHaveBeenCalledTimes(1);

      // Advance several seconds — claim-wait loop should not call refreshSync again
      // because the request resolved with ran=true
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      // Still only the initial call (the request stopped the loop)
      expect(refreshSync).toHaveBeenCalledTimes(1);
    });

    it('does not refresh again when the request resolves after the terminal poll already refreshed', async () => {
      const refreshSync = jest
        .fn()
        .mockResolvedValue(statusOf({ status: 'never' }));

      let resolveRequest: ((val: any) => void) | null = null;
      const requestPromise = new Promise((resolve) => {
        resolveRequest = resolve;
      });

      const triggerChannelSync = jest.fn().mockReturnValue(requestPromise);

      const subs = {
        ...defaultSubs,
        refresh: jest.fn(),
      };
      mockUseYouTubeSubscriptions.mockReturnValue(subs);

      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      mockUseYouTubeSyncStatus.mockReturnValue({
        status: statusOf({ status: 'success', channelStatus: 'never' }),
        loading: false,
        triggerChannelSync,
        isChannelCooldownActive: false,
        refresh: refreshSync,
      });

      const { rerender } = render(<YouTubeChannelsPageClient />);

      // Click to start sync request
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Refresh channels' }),
        );
      });

      // Transition channelStatus to discovering
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: statusOf({
          status: 'success',
          channelStatus: 'discovering',
        }),
        loading: false,
        triggerChannelSync,
        isChannelCooldownActive: false,
        refresh: refreshSync,
      });

      act(() => {
        rerender(<YouTubeChannelsPageClient />);
      });

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      // Transition to terminal
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: statusOf({
          status: 'success',
          channelStatus: 'success',
        }),
        loading: false,
        triggerChannelSync,
        isChannelCooldownActive: false,
        refresh: refreshSync,
      });

      act(() => {
        rerender(<YouTubeChannelsPageClient />);
      });

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      // Poll path should have fired once
      expect(subs.refresh).toHaveBeenCalledTimes(1);

      // Now resolve the request — should be deduplicated
      subs.refresh.mockClear();

      await act(async () => {
        resolveRequest?.(true);
        jest.advanceTimersByTime(0);
      });

      // No additional refresh from the request path
      expect(subs.refresh).not.toHaveBeenCalled();
    });
  });

  describe('disconnect confirm', () => {
    it('opens confirm dialog without calling disconnect until confirmed', () => {
      const { disconnect } = renderConnected();
      const dialog = openDisconnectDialog();

      expect(dialog).toBeInTheDocument();
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('offers no Watched marks checkbox and says Watched marks are deleted and will not return on reconnect', () => {
      renderConnected();
      const dialog = openDisconnectDialog();

      expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText('Also delete my Watched marks'),
      ).not.toBeInTheDocument();
      expect(dialog).toHaveTextContent(
        /Watched marks are deleted and will not return if you reconnect/,
      );
    });

    it('calls disconnect with no arguments when confirmed', async () => {
      const disconnect = jest.fn().mockResolvedValue({ revokeFailed: false });
      renderConnected(disconnect);
      const dialog = openDisconnectDialog();

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Disconnect' }),
        );
      });

      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledWith();
    });

    it('describes destroyed stores in the disconnect dialog', () => {
      renderConnected();
      const dialog = openDisconnectDialog();

      expect(dialog).toHaveTextContent(/Followed Channels/);
      expect(dialog).toHaveTextContent(/Cached Uploads/);
      expect(dialog).toHaveTextContent(/notification/);
      expect(dialog).toHaveTextContent(/digest/);
      expect(dialog).toHaveTextContent(/OAuth/);
    });

    it.each(['discovering', 'running'] as const)(
      'disables disconnect while upload sync status is %s and does not open confirm',
      (liveStatus) => {
        const disconnect = jest.fn();
        renderConnected(disconnect, {
          status: statusOf({ status: liveStatus }),
        });

        const disconnectBtn = screen.getByRole('button', {
          name: 'Disconnect unavailable while a sync is running',
        });
        expect(disconnectBtn).toBeDisabled();

        fireEvent.click(disconnectBtn);

        expect(
          screen.queryByRole('dialog', { name: 'Disconnect YouTube?' }),
        ).not.toBeInTheDocument();
        expect(disconnect).not.toHaveBeenCalled();
      },
    );

    it('disables disconnect while channel sync is discovering and does not open confirm', () => {
      const disconnect = jest.fn();
      renderConnected(disconnect, {
        status: statusOf({
          status: 'success',
          channelStatus: 'discovering',
        }),
      });

      const disconnectBtn = screen.getByRole('button', {
        name: 'Disconnect unavailable while a sync is running',
      });
      expect(disconnectBtn).toBeDisabled();

      fireEvent.click(disconnectBtn);

      expect(
        screen.queryByRole('dialog', { name: 'Disconnect YouTube?' }),
      ).not.toBeInTheDocument();
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('shows disconnect error alert inside the dialog when disconnect rejects', async () => {
      const disconnect = jest
        .fn()
        .mockRejectedValue(new Error('Server unavailable'));
      renderConnected(disconnect);
      const dialog = openDisconnectDialog();

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Disconnect' }),
      );

      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toHaveTextContent(
          'Server unavailable',
        );
      });
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('surfaces sync_run_live YouTubeRequestError message inside the dialog', async () => {
      const { YouTubeRequestError } = jest.requireMock('../hooks') as {
        YouTubeRequestError: new (
          message: string,
          status: number,
          code?: string,
        ) => Error;
      };
      const disconnect = jest
        .fn()
        .mockRejectedValue(
          new YouTubeRequestError(
            'Disconnect is not available while a sync is in progress.',
            409,
            'sync_run_live',
          ),
        );
      renderConnected(disconnect);
      const dialog = openDisconnectDialog();

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Disconnect' }),
      );

      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toHaveTextContent(
          'Disconnect is not available while a sync is in progress.',
        );
      });
    });
  });

  describe('YouTube availability gate', () => {
    it.each([
      ['explicitly false', { available: false, loading: false, error: null }],
      ['still loading', { available: null, loading: true, error: null }],
    ])(
      'shows the unavailable notice and makes no connection or data hook call when availability is %s',
      (_label, availability) => {
        mockUseYouTubeAvailability.mockReturnValue(availability);

        render(<YouTubeChannelsPageClient />);

        expect(
          screen.getByRole('heading', {
            name: /YouTube is not available right now/i,
          }),
        ).toBeInTheDocument();
        [
          mockUseYouTubeStatus,
          mockUseYouTubeConnect,
          mockUseYouTubeSubscriptions,
          mockUseYouTubeSyncStatus,
        ].forEach((hook) => expect(hook).not.toHaveBeenCalled());
      },
    );
  });
  describe('heading and section navigation', () => {
    const twoSubs = [
      {
        id: 'sub-1',
        channelId: 'ch-1',
        channelTitle: 'Alpha Channel',
        channelThumbnail: null,
        uploadsPlaylistId: 'UU1',
        enabled: true,
        lastSyncedAt: null,
      },
      {
        id: 'sub-2',
        channelId: 'ch-2',
        channelTitle: 'Beta Channel',
        channelThumbnail: null,
        uploadsPlaylistId: 'UU2',
        enabled: false,
        lastSyncedAt: null,
      },
    ];

    it('renders a Channels h1 and a YouTube section nav with Channels marked as the current page', () => {
      renderConnected();

      expect(
        screen.getByRole('heading', { level: 1, name: 'Channels' }),
      ).toBeInTheDocument();
      const nav = screen.getByRole('navigation', { name: 'YouTube' });
      expect(within(nav).getByRole('link', { name: 'Videos' })).toHaveAttribute(
        'href',
        '/dashboard/youtube',
      );
      expect(within(nav).getByRole('link', { name: 'Shorts' })).toHaveAttribute(
        'href',
        '/dashboard/youtube/shorts',
      );
      expect(
        within(nav).getByRole('link', { name: /^Channels/ }),
      ).toHaveAttribute('aria-current', 'page');
    });

    it('shows the channel count on the Channels nav link once subscriptions have loaded', () => {
      mockUseYouTubeSubscriptions.mockReturnValue({
        ...defaultSubs,
        subscriptions: twoSubs,
        loading: false,
      });
      renderConnected();

      const nav = screen.getByRole('navigation', { name: 'YouTube' });
      expect(
        within(nav).getByRole('link', { name: 'Channels · 2' }),
      ).toBeInTheDocument();
    });

    it('omits the channel count from the Channels nav link while subscriptions are loading', () => {
      mockUseYouTubeSubscriptions.mockReturnValue({
        ...defaultSubs,
        subscriptions: twoSubs,
        loading: true,
      });
      renderConnected();

      const nav = screen.getByRole('navigation', { name: 'YouTube' });
      expect(
        within(nav).getByRole('link', { name: 'Channels' }),
      ).toBeInTheDocument();
      expect(within(nav).queryByText(/Channels ·/)).not.toBeInTheDocument();
    });

    it('omits the channel count from the Channels nav link on a phone-width layout', () => {
      mockUseIsMobileState.mockReturnValue(true);
      mockUseYouTubeSubscriptions.mockReturnValue({
        ...defaultSubs,
        subscriptions: twoSubs,
        loading: false,
      });
      renderConnected();

      const nav = screen.getByRole('navigation', { name: 'YouTube' });
      expect(
        within(nav).getByRole('link', { name: 'Channels' }),
      ).toHaveAttribute('aria-current', 'page');
      expect(within(nav).queryByText(/Channels ·/)).not.toBeInTheDocument();
    });
  });

  describe('availability gate reason', () => {
    it('shows the unreachable notice and makes no YouTube hook call when the availability check errors', () => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: null,
        loading: false,
        error: new Error('Network down'),
      });

      render(<YouTubeChannelsPageClient />);

      expect(
        screen.getByRole('heading', {
          name: "YouTube can't be reached right now",
        }),
      ).toBeInTheDocument();
      [
        mockUseYouTubeStatus,
        mockUseYouTubeConnect,
        mockUseYouTubeSubscriptions,
        mockUseYouTubeSyncStatus,
      ].forEach((hook) => expect(hook).not.toHaveBeenCalled());
    });
  });

  describe('disconnect outcome', () => {
    it('shows the revoke-failed notice with a Google permissions link when revoke failed', async () => {
      const disconnect = jest.fn().mockResolvedValue({
        revokeFailed: true,
        googlePermissionsUrl: 'https://myaccount.google.com/permissions',
        message:
          'Your data was removed but Google access could not be revoked.',
      });
      renderConnected(disconnect);
      const dialog = openDisconnectDialog();

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Disconnect' }),
        );
      });

      const notice = await screen.findByRole('status');
      expect(notice).toHaveTextContent(
        'Your data was removed but Google access could not be revoked.',
      );
      expect(
        within(notice).getByRole('link', { name: 'Manage Google permissions' }),
      ).toHaveAttribute('href', 'https://myaccount.google.com/permissions');
    });

    it('closes the dialog, refreshes status, and shows no notice after a clean disconnect', async () => {
      const disconnect = jest.fn().mockResolvedValue({ revokeFailed: false });
      const { refreshStatus } = renderConnected(disconnect);
      const dialog = openDisconnectDialog();

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Disconnect' }),
        );
      });

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Disconnect YouTube?' }),
        ).not.toBeInTheDocument();
      });
      expect(refreshStatus).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
  describe('channel sync cooldown guard', () => {
    it('keeps Refresh enabled but starts no sync when the client cooldown is active without a retry time', () => {
      const triggerChannelSync = jest.fn().mockResolvedValue(true);
      renderConnected(undefined, {
        status: statusOf({
          status: 'success',
          channelStatus: 'never',
          channelRetryAt: null,
        }),
        triggerChannelSync,
        isChannelCooldownActive: true,
      });

      const refresh = screen.getByRole('button', { name: 'Refresh channels' });
      expect(refresh).toBeEnabled();
      fireEvent.click(refresh);

      expect(triggerChannelSync).not.toHaveBeenCalled();
    });
  });

  describe('connection states', () => {
    it('shows Loading… and no dashboard while the connection status is loading', () => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: false,
        status: 'loading',
        refresh: jest.fn(),
      });

      render(<YouTubeChannelsPageClient />);

      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(mockUseYouTubeSubscriptions).not.toHaveBeenCalled();
    });

    it('shows the connect prompt with the revoked message when the previous connection was revoked', () => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: false,
        status: 'revoked',
        refresh: jest.fn(),
      });

      render(<YouTubeChannelsPageClient />);

      expect(
        screen.getByText(
          'Your previous connection was revoked. Please reconnect.',
        ),
      ).toBeInTheDocument();
      expect(mockUseYouTubeSubscriptions).not.toHaveBeenCalled();
    });
  });

  describe('disconnect failure and notice edges', () => {
    it('shows no revoke-failed notice when revoke failed without a Google permissions URL', async () => {
      const disconnect = jest.fn().mockResolvedValue({
        revokeFailed: true,
        googlePermissionsUrl: null,
        message: 'Google access could not be revoked.',
      });
      renderConnected(disconnect);
      const dialog = openDisconnectDialog();

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Disconnect' }),
        );
      });

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Disconnect YouTube?' }),
        ).not.toBeInTheDocument();
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('shows "Disconnect failed" inside the dialog when the rejection is not an Error', async () => {
      const disconnect = jest.fn().mockRejectedValue('network-down');
      renderConnected(disconnect);
      const dialog = openDisconnectDialog();

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Disconnect' }),
      );

      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toHaveTextContent(
          'Disconnect failed',
        );
      });
    });
  });
});
