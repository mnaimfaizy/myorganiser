import { act, fireEvent, render, screen, within } from '@testing-library/react';

import '@testing-library/jest-dom';

const mockSearchParams = { value: new URLSearchParams() };
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => mockSearchParams.value,
}));

jest.mock('lucide-react', () => ({
  RefreshCw: (props: Record<string, unknown>) => (
    <svg data-testid="refresh-icon" {...props} />
  ),
  // Tone icons rendered by SyncFreshnessIndicator.
  AlertTriangle: (props: Record<string, unknown>) => (
    <svg data-testid="warning-icon" {...props} />
  ),
  CircleAlert: (props: Record<string, unknown>) => (
    <svg data-testid="error-icon" {...props} />
  ),
  Clock: (props: Record<string, unknown>) => (
    <svg data-testid="pending-icon" {...props} />
  ),
  // Icons rendered by ChannelDirectory once the carousel has channels.
  CheckCircle: (props: Record<string, unknown>) => <svg {...props} />,
  Circle: (props: Record<string, unknown>) => <svg {...props} />,
  ExternalLink: (props: Record<string, unknown>) => <svg {...props} />,
  ListPlus: (props: Record<string, unknown>) => <svg {...props} />,
  X: (props: Record<string, unknown>) => <svg {...props} />,
  // Icons rendered by the Videos page header, Queue rail and first look.
  AlertCircle: (props: Record<string, unknown>) => <svg {...props} />,
  Check: (props: Record<string, unknown>) => <svg {...props} />,
  ChevronDown: (props: Record<string, unknown>) => <svg {...props} />,
  ChevronUp: (props: Record<string, unknown>) => <svg {...props} />,
  Play: (props: Record<string, unknown>) => <svg {...props} />,
  Plus: (props: Record<string, unknown>) => <svg {...props} />,
  Trash2: (props: Record<string, unknown>) => <svg {...props} />,
}));

// Mock UI components
jest.mock('@myorganiser/web-ui', () => ({
  cn: (...classes: Array<string | undefined>) =>
    classes.filter(Boolean).join(' '),
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
  Checkbox: ({ id, checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
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
  Illustration: ({ kind }: any) => (
    <svg data-testid="illustration" data-kind={kind} />
  ),
  Input: (props: any) => <input {...props} />,
  Label: ({ children, htmlFor }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Skeleton: ({ className }: any) => (
    <div className={className} data-testid="skeleton" />
  ),
  useIsMobileState: () => mockUseIsMobileState(),
}));

// Mock hooks
const mockUseYouTubeAvailability = jest.fn();
const mockUseYouTubeStatus = jest.fn();
const mockUseYouTubeConnect = jest.fn();
const mockUseYouTubeSubscriptions = jest.fn();
const mockUseYouTubeCarousel = jest.fn();
const mockUseYouTubeSyncStatus = jest.fn();
const mockUseVideoQueue = jest.fn();
const mockUseChannelUploads = jest.fn();
const mockUseIsMobileState = jest.fn();

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
    useYouTubeCarousel: () => mockUseYouTubeCarousel(),
    useYouTubeSyncStatus: () => mockUseYouTubeSyncStatus(),
    useVideoQueue: () => mockUseVideoQueue(),
    useChannelUploads: () => mockUseChannelUploads(),
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

const { YouTubePageClient } =
  require('./YouTubePageClient') as typeof import('./YouTubePageClient');

describe('YouTubePageClient', () => {
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

  const defaultCarousel = {
    channels: [],
    loading: false,
    error: null,
    updateWatched: jest.fn(),
    refresh: jest.fn(),
  };

  const defaultChannelUploads = {
    uploadsByChannel: {},
    loadingChannelIds: new Set<string>(),
    fullyLoadedChannelIds: new Set<string>(),
    error: null,
    loadChannel: jest.fn(),
    updateWatched: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams.value = new URLSearchParams();
    mockUseIsMobileState.mockReturnValue(false);
    mockUseYouTubeAvailability.mockReturnValue({
      available: true,
      loading: false,
      error: null,
    });
    mockUseChannelUploads.mockReturnValue(defaultChannelUploads);
    mockUseYouTubeConnect.mockReturnValue(defaultConnect);
    mockUseYouTubeSubscriptions.mockReturnValue(defaultSubs);
    mockUseYouTubeCarousel.mockReturnValue(defaultCarousel);
    mockUseYouTubeSyncStatus.mockReturnValue({
      status: null,
      loading: false,
      triggerUploadSync: jest.fn(),
      isCooldownActive: false,
      refresh: jest.fn(),
    });
    mockUseVideoQueue.mockReturnValue({
      items: [],
      ids: [],
      activeId: null,
      current: null,
      activeIndex: -1,
      focusSignal: 0,
      isFull: false,
      remainingSlots: 4,
      add: jest.fn(),
      remove: jest.fn(),
      moveUp: jest.fn(),
      moveDown: jest.fn(),
      playId: jest.fn(),
      playNext: jest.fn(),
      completeAndNext: jest.fn(),
      clear: jest.fn(),
      isQueued: jest.fn(),
    });
  });

  it('should show loading state', () => {
    mockUseYouTubeStatus.mockReturnValue({
      connected: false,
      status: 'loading',
      refresh: jest.fn(),
    });
    render(<YouTubePageClient />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('should show connect prompt when disconnected', () => {
    mockUseYouTubeStatus.mockReturnValue({
      connected: false,
      status: 'disconnected',
      refresh: jest.fn(),
    });
    render(<YouTubePageClient />);
    expect(
      screen.getByText('Connect Your YouTube Account'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Connect YouTube' }),
    ).toBeInTheDocument();
  });

  it('should show revoked warning when status is revoked', () => {
    mockUseYouTubeStatus.mockReturnValue({
      connected: false,
      status: 'revoked',
      refresh: jest.fn(),
    });
    render(<YouTubePageClient />);
    expect(
      screen.getByText(/Your previous connection was revoked/),
    ).toBeInTheDocument();
  });

  it('should call connect when Connect YouTube button clicked', () => {
    const connect = jest.fn();
    mockUseYouTubeStatus.mockReturnValue({
      connected: false,
      status: 'disconnected',
      refresh: jest.fn(),
    });
    mockUseYouTubeConnect.mockReturnValue({
      connect,
      disconnect: jest.fn(),
    });
    render(<YouTubePageClient />);
    fireEvent.click(screen.getByText('Connect YouTube'));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('should show connected dashboard when connected', () => {
    mockUseYouTubeStatus.mockReturnValue({
      connected: true,
      status: 'connected',
      refresh: jest.fn(),
    });
    render(<YouTubePageClient />);
    expect(screen.getByText('Videos')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Channels' })).toHaveAttribute(
      'href',
      '/dashboard/youtube/channels',
    );
  });

  it('shows last synced when status is available', () => {
    mockUseYouTubeStatus.mockReturnValue({
      connected: true,
      status: 'connected',
      refresh: jest.fn(),
    });

    mockUseYouTubeSyncStatus.mockReturnValue({
      status: {
        lastSyncedAt: '2026-08-06T12:00:00.000Z',
        channelStatus: 'never',
        channelLastAttemptAt: null,
        channelLastError: null,
        channelRetryAt: null,
      },
      loading: false,
      triggerUploadSync: jest.fn(),
      isCooldownActive: false,
      refresh: jest.fn(),
    });

    render(<YouTubePageClient />);
    expect(screen.getByText(/Last synced/)).toHaveTextContent(/Last synced/);
  });

  // Helper to create a sync status with test data
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

  it('triggers sync without blocking on the response', async () => {
    mockUseYouTubeStatus.mockReturnValue({
      connected: true,
      status: 'connected',
      refresh: jest.fn(),
    });

    // triggerUploadSync never resolves, simulating a stuck connection
    const triggerUploadSync = jest.fn(() => new Promise(() => {}));
    const refresh = jest.fn();

    mockUseYouTubeSyncStatus.mockReturnValue({
      status: null,
      loading: false,
      triggerUploadSync,
      isCooldownActive: false,
      refresh,
    });

    render(<YouTubePageClient />);

    // Click the sync button
    const syncBtn = screen.getByRole('button', { name: 'Sync uploads' });
    fireEvent.click(syncBtn);

    // Verify triggerUploadSync was called
    expect(triggerUploadSync).toHaveBeenCalled();

    // Verify refresh was called to start polling
    expect(refresh).toHaveBeenCalled();

    // UI should be rendered and responsive (no hang waiting for triggerUploadSync)
    expect(screen.getByText('Videos')).toBeInTheDocument();
  });

  it('shows refresh failed alert when run completes and refresh fails', async () => {
    jest.useFakeTimers();

    mockUseYouTubeStatus.mockReturnValue({
      connected: true,
      status: 'connected',
      refresh: jest.fn(),
    });

    const syncStatusState: {
      current: Record<string, unknown> | null;
    } = { current: null };
    const syncStatusRefresh = jest.fn();
    const triggerUploadSync = jest.fn();

    mockUseYouTubeSyncStatus.mockImplementation(() => ({
      status: syncStatusState.current,
      loading: false,
      triggerUploadSync,
      isCooldownActive: false,
      refresh: syncStatusRefresh,
    }));

    const subs = {
      ...defaultSubs,
      refresh: jest.fn().mockRejectedValue(new Error('refresh failed')),
    };
    mockUseYouTubeSubscriptions.mockReturnValue(subs);

    const { rerender } = render(<YouTubePageClient />);

    // Transition to running
    syncStatusState.current = statusOf({ status: 'running' });
    act(() => {
      rerender(<YouTubePageClient />);
    });

    // Allow effects to settle and polling to start
    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    // Transition to terminal (success)
    syncStatusState.current = statusOf({ status: 'success' });
    act(() => {
      rerender(<YouTubePageClient />);
    });

    // Allow effects to settle and onRunComplete to fire
    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    // Wait for the alert to appear (subs.refresh rejection triggers alert)
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Refresh failed');

    jest.useRealTimers();
  });

  it('does not surface error when triggerUploadSync rejects', async () => {
    mockUseYouTubeStatus.mockReturnValue({
      connected: true,
      status: 'connected',
      refresh: jest.fn(),
    });

    // triggerUploadSync rejects (504 timeout from long-running connection)
    const triggerUploadSync = jest
      .fn()
      .mockRejectedValue(new Error('504 timeout'));
    const refresh = jest.fn();

    mockUseYouTubeSyncStatus.mockReturnValue({
      status: null,
      loading: false,
      triggerUploadSync,
      isCooldownActive: false,
      refresh,
    });

    render(<YouTubePageClient />);

    // Click sync button
    const syncBtn = screen.getByRole('button', { name: 'Sync uploads' });
    await act(async () => {
      fireEvent.click(syncBtn);
      // Let the promise rejection settle
      await Promise.resolve();
    });

    // Verify triggerUploadSync was called
    expect(triggerUploadSync).toHaveBeenCalled();

    // No error alert should appear (rejection is swallowed)
    const alert = screen.queryByRole('alert');
    expect(alert).not.toBeInTheDocument();
  });

  it('disables sync uploads when upload cooldown is active', () => {
    mockUseYouTubeStatus.mockReturnValue({
      connected: true,
      status: 'connected',
      refresh: jest.fn(),
    });

    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    mockUseYouTubeSyncStatus.mockReturnValue({
      status: { retryAt: future, channelStatus: 'never' },
      loading: false,
      triggerUploadSync: jest.fn(),
      isCooldownActive: true,
      refresh: jest.fn(),
    });

    render(<YouTubePageClient />);

    const syncBtn = screen.getByRole('button', {
      name: /Sync uploads disabled until/i,
    });
    expect(syncBtn).toBeDisabled();
    expect(syncBtn).toHaveAttribute(
      'title',
      expect.stringMatching(/Sync uploads disabled until/i),
    );
  });

  it('shows empty-channels note with link to channels page', () => {
    mockUseYouTubeStatus.mockReturnValue({
      connected: true,
      status: 'connected',
      refresh: jest.fn(),
    });
    mockUseYouTubeSubscriptions.mockReturnValue({
      ...defaultSubs,
      subscriptions: [],
      loading: false,
    });

    render(<YouTubePageClient />);

    expect(screen.getByText('No channels yet.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Refresh channels' }),
    ).toHaveAttribute('href', '/dashboard/youtube/channels');
  });

  it('shows never-synced uploads note when channels exist but uploads never synced', () => {
    mockUseYouTubeStatus.mockReturnValue({
      connected: true,
      status: 'connected',
      refresh: jest.fn(),
    });
    mockUseYouTubeSubscriptions.mockReturnValue({
      ...defaultSubs,
      subscriptions: [
        {
          id: 'sub-1',
          channelId: 'ch-1',
          channelTitle: 'Alpha Channel',
          channelThumbnail: null,
          uploadsPlaylistId: 'UU123',
          enabled: true,
          lastSyncedAt: null,
        },
      ],
      loading: false,
    });
    mockUseYouTubeSyncStatus.mockReturnValue({
      status: statusOf({ status: 'never' }),
      loading: false,
      triggerUploadSync: jest.fn(),
      isCooldownActive: false,
      refresh: jest.fn(),
    });

    render(<YouTubePageClient />);

    expect(
      screen.getByText(/Uploads have not been synced yet\./),
    ).toBeInTheDocument();
  });

  describe('channel deep link', () => {
    const video = (id: string, title: string) => ({
      id: `row-${id}`,
      videoId: id,
      channelId: 'ch-1',
      title,
      thumbnail: null,
      publishedAt: '2026-01-01T00:00:00Z',
      channelTitle: 'Channel 1',
      watched: false,
    });

    const twoChannels = [
      {
        channelId: 'ch-1',
        channelTitle: 'Channel 1',
        channelThumbnail: null,
        videos: [video('a', 'Upload A')],
      },
      {
        channelId: 'ch-2',
        channelTitle: 'Channel 2',
        channelThumbnail: null,
        videos: [{ ...video('b', 'Upload B'), channelId: 'ch-2' }],
      },
    ];

    beforeEach(() => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });
    });

    it('opens the channel named by ?channel=, so digest mail lands on it', () => {
      mockSearchParams.value = new URLSearchParams('channel=ch-2');
      mockUseYouTubeCarousel.mockReturnValue({
        ...defaultCarousel,
        channels: twoChannels,
      });

      render(<YouTubePageClient />);

      expect(screen.getByText('Upload B')).toBeInTheDocument();
      expect(screen.queryByText('Upload A')).not.toBeInTheDocument();
    });

    it('opens the first channel when no channel is named', () => {
      mockUseYouTubeCarousel.mockReturnValue({
        ...defaultCarousel,
        channels: twoChannels,
      });

      render(<YouTubePageClient />);

      expect(screen.getByText('Upload A')).toBeInTheDocument();
    });

    it('shows an expanded channel its full snapshot rather than the capped slice', () => {
      mockUseYouTubeCarousel.mockReturnValue({
        ...defaultCarousel,
        channels: [twoChannels[0]],
      });
      mockUseChannelUploads.mockReturnValue({
        ...defaultChannelUploads,
        uploadsByChannel: {
          'ch-1': [video('a', 'Upload A'), video('c', 'Older upload C')],
        },
      });

      render(<YouTubePageClient />);

      expect(screen.getByText('Older upload C')).toBeInTheDocument();
    });
  });

  describe('claim-wait polling loop (sync run claim detection)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('polls refreshSync() at 1s intervals until a live status is found', async () => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      let callCount = 0;
      const refreshSync = jest.fn(async () => {
        callCount++;
        // First call returns non-live, second returns live
        return callCount === 1
          ? { status: 'never' }
          : { status: 'discovering' };
      });

      // The loop only waits while the user's request is outstanding — #753
      const triggerUploadSync = jest.fn(() => new Promise(() => {}));
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: { status: 'never' },
        loading: false,
        triggerUploadSync,
        isCooldownActive: false,
        refresh: refreshSync,
      });

      render(<YouTubePageClient />);

      // Click sync to start the claim-wait loop
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Sync uploads' }));
      });

      // Claim-wait loop calls refreshSync immediately via doPoll()
      expect(refreshSync).toHaveBeenCalledTimes(1);

      // Advance to trigger the second poll at ~1s
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      // Should have called refreshSync at least twice (initial + second after 1s interval)
      expect(refreshSync).toHaveBeenCalledTimes(2);
    });

    it('stops polling claim-wait loop once a live status is received from refreshSync()', async () => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      let callCount = 0;
      const refreshSync = jest.fn(async () => {
        callCount++;
        // Returns live on second call
        return callCount < 2 ? { status: 'never' } : { status: 'discovering' };
      });

      // The loop only waits while the user's request is outstanding — #753
      const triggerUploadSync = jest.fn(() => new Promise(() => {}));
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: { status: 'never' },
        loading: false,
        triggerUploadSync,
        isCooldownActive: false,
        refresh: refreshSync,
      });

      render(<YouTubePageClient />);

      // Click sync to start the claim-wait loop
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Sync uploads' }));
      });

      // Advance to trigger polling (using 1s increments to ensure timers fire properly)
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      // Should have called twice (initial call + one at 1s, then finds live status and stops)
      expect(refreshSync.mock.calls.length).toBe(2);

      // After finding live status, the claim-wait loop stops scheduling new polls
      // Verify by advancing further and checking call growth
      const callsAfterPolling = refreshSync.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(3000); // Advance another 3s
      });

      // With the claim-wait loop stopped, no more 1s-interval calls should be added
      const newCalls = refreshSync.mock.calls.length - callsAfterPolling;
      expect(newCalls).toBe(0);
    });

    it('stops polling after 30 second deadline without finding a live status', async () => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      // Always return non-live
      const refreshSync = jest.fn(async () => ({ status: 'never' }));

      // The loop only waits while the user's request is outstanding — #753
      const triggerUploadSync = jest.fn(() => new Promise(() => {}));
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: { status: 'never' },
        loading: false,
        triggerUploadSync,
        isCooldownActive: false,
        refresh: refreshSync,
      });

      render(<YouTubePageClient />);

      // Click sync to start the claim-wait loop
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Sync uploads' }));
      });

      // Advance through the 30s deadline using smaller increments to ensure all timers fire
      for (let i = 0; i < 31; i++) {
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });
      }

      const callsAt31s = refreshSync.mock.calls.length;
      // The claim-wait loop calls refreshSync immediately, then at 1s intervals.
      // With 1s intervals, after 31000ms the loop has executed at t=0, 1, 2, ..., 30
      // That's 31 calls total (then it checks elapsedMs=31000 > 30000 and stops).
      expect(callsAt31s).toBe(31);

      // The claim-wait loop's 1s polling should stop at 30s.
      // After 31s, no more 1s-interval calls should be added from the claim-wait loop.
      await act(async () => {
        jest.advanceTimersByTime(2000); // Advance 2 more seconds
      });

      // In the 2s window after the deadline, we expect no calls from the claim-wait loop
      const newCallsInWindow = refreshSync.mock.calls.length - callsAt31s;
      expect(newCallsInWindow).toBe(0);
    });

    it('does not restart the polling loop when sync is clicked while already waiting', async () => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      const refreshSync = jest.fn(async () => ({ status: 'never' }));

      // The loop only waits while the user's request is outstanding — #753
      const triggerUploadSync = jest.fn(() => new Promise(() => {}));
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: { status: 'never' },
        loading: false,
        triggerUploadSync,
        isCooldownActive: false,
        refresh: refreshSync,
      });

      render(<YouTubePageClient />);

      // Click sync the first time
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Sync uploads' }));
      });

      // Advance 1.5s in small increments to ensure timers fire properly
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      const callsAfterFirstClick = refreshSync.mock.calls.length;

      // Click again (setWaitingForClaim(true) when already true is a no-op)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Sync uploads' }));
      });

      // Advance another 1.5s
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      // After 1.5s: calls at t=0 (initial) and t=1000ms (first scheduled poll) = 2 calls.
      // After another 1.5s (total 3s): call at t=2000ms adds 1 more call.
      // New calls in second 1.5s window: 1 (the t=2000ms call).
      const newCalls = refreshSync.mock.calls.length - callsAfterFirstClick;
      expect(newCalls).toBe(1);

      // At t=3000ms with 1s intervals starting from t=0:
      // calls execute at t=0, t=1000, t=2000 = 3 calls total (not doubled)
      expect(refreshSync.mock.calls.length).toBe(3);
    });
  });

  describe('request-path completion (#753)', () => {
    const setupRequestTest = (triggerResult: boolean | Error) => {
      jest.useFakeTimers();

      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      const refreshSync = jest
        .fn()
        .mockResolvedValue(statusOf({ status: 'never' }));

      const subs = {
        ...defaultSubs,
        refresh: jest.fn(),
      };
      mockUseYouTubeSubscriptions.mockReturnValue(subs);

      const carousel = {
        ...defaultCarousel,
        refresh: jest.fn(),
      };
      mockUseYouTubeCarousel.mockReturnValue(carousel);

      const triggerUploadSync =
        triggerResult instanceof Error
          ? jest.fn().mockRejectedValue(triggerResult)
          : jest.fn().mockResolvedValue(triggerResult);

      mockUseYouTubeSyncStatus.mockReturnValue({
        status: statusOf({ status: 'never' }),
        loading: false,
        triggerUploadSync,
        isCooldownActive: false,
        refresh: refreshSync,
      });

      return { subs, carousel };
    };

    // The trigger resolves whether the run did work; which statuses count is
    // pinned by didSyncRequestRun's own tests and the trigger tests in
    // hooks/index.spec.ts, so the page only sees the two outcomes.
    it.each([
      {
        label: 'request that ran',
        triggerResult: true,
        expectedRefreshCalls: 1,
      },
      {
        label: 'request that did not run',
        triggerResult: false,
        expectedRefreshCalls: 0,
      },
    ])(
      '$label → refreshes $expectedRefreshCalls time(s)',
      async ({ triggerResult, expectedRefreshCalls }) => {
        const { subs, carousel } = setupRequestTest(triggerResult);

        render(<YouTubePageClient />);

        // Click sync
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Sync uploads' }));
        });

        // Let the request settle
        await act(async () => {
          jest.advanceTimersByTime(0);
        });

        // Verify refreshes called as expected
        if (expectedRefreshCalls > 0) {
          expect(subs.refresh).toHaveBeenCalledTimes(expectedRefreshCalls);
          expect(carousel.refresh).toHaveBeenCalledTimes(expectedRefreshCalls);
        } else {
          expect(subs.refresh).not.toHaveBeenCalled();
          expect(carousel.refresh).not.toHaveBeenCalled();
        }

        jest.useRealTimers();
      },
    );

    it('request that ran → claim-wait loop stops (no further refreshSync calls)', async () => {
      jest.useFakeTimers();

      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      const refreshSync = jest
        .fn()
        .mockResolvedValue(statusOf({ status: 'never' }));

      mockUseYouTubeSyncStatus.mockReturnValue({
        status: statusOf({ status: 'never' }),
        loading: false,
        triggerUploadSync: jest.fn().mockResolvedValue(true),
        isCooldownActive: false,
        refresh: refreshSync,
      });

      render(<YouTubePageClient />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Sync uploads' }));
      });

      // Initial doPoll() call
      expect(refreshSync).toHaveBeenCalledTimes(1);

      // Advance several seconds — claim-wait loop should not call refreshSync again
      // because the request resolved with ran=true
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      // Still only the initial call (the request stopped the loop)
      expect(refreshSync).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('dedupe: status null → live → terminal via rerenders, then request resolves → once', async () => {
      jest.useFakeTimers();

      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      const refreshSync = jest
        .fn()
        .mockResolvedValue(statusOf({ status: 'never' }));

      const subs = {
        ...defaultSubs,
        refresh: jest.fn(),
      };
      mockUseYouTubeSubscriptions.mockReturnValue(subs);

      const carousel = {
        ...defaultCarousel,
        refresh: jest.fn(),
      };
      mockUseYouTubeCarousel.mockReturnValue(carousel);

      // Deferred so we control when it resolves
      let resolveRequest: ((val: any) => void) | null = null;
      const requestPromise = new Promise((resolve) => {
        resolveRequest = resolve;
      });

      mockUseYouTubeSyncStatus.mockReturnValue({
        status: null,
        loading: false,
        triggerUploadSync: jest.fn().mockReturnValue(requestPromise),
        isCooldownActive: false,
        refresh: refreshSync,
      });

      const { rerender } = render(<YouTubePageClient />);

      // Click sync
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Sync uploads' }));
      });

      // Simulate status goes live
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: statusOf({ status: 'running' }),
        loading: false,
        triggerUploadSync: jest.fn().mockReturnValue(requestPromise),
        isCooldownActive: false,
        refresh: refreshSync,
      });

      act(() => {
        rerender(<YouTubePageClient />);
      });

      // Poll path should have fired and called onRunComplete
      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      // Rerender to terminal
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: statusOf({ status: 'success' }),
        loading: false,
        triggerUploadSync: jest.fn().mockReturnValue(requestPromise),
        isCooldownActive: false,
        refresh: refreshSync,
      });

      act(() => {
        rerender(<YouTubePageClient />);
      });

      // Poll path fires again (live → terminal transition)
      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      // Now resolve the request — should be deduplicated (no additional refresh)
      await act(async () => {
        resolveRequest?.({ status: 'success' });
        jest.advanceTimersByTime(0);
      });

      // Should have been called exactly once (from the poll path, not twice)
      expect(subs.refresh).toHaveBeenCalledTimes(1);
      expect(carousel.refresh).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('run started elsewhere: status null → live → terminal via rerenders → refreshes once', async () => {
      jest.useFakeTimers();

      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      const refreshSync = jest
        .fn()
        .mockResolvedValue(statusOf({ status: 'never' }));

      const subs = {
        ...defaultSubs,
        refresh: jest.fn(),
      };
      mockUseYouTubeSubscriptions.mockReturnValue(subs);

      const carousel = {
        ...defaultCarousel,
        refresh: jest.fn(),
      };
      mockUseYouTubeCarousel.mockReturnValue(carousel);

      mockUseYouTubeSyncStatus.mockReturnValue({
        status: null,
        loading: false,
        triggerUploadSync: jest.fn(),
        isCooldownActive: false,
        refresh: refreshSync,
      });

      const { rerender } = render(<YouTubePageClient />);

      // Status goes live without clicking (run started elsewhere)
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: statusOf({ status: 'running' }),
        loading: false,
        triggerUploadSync: jest.fn(),
        isCooldownActive: false,
        refresh: refreshSync,
      });

      act(() => {
        rerender(<YouTubePageClient />);
      });

      // Poll path should start, and onRunComplete should not be called yet
      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      // Transition to terminal
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: statusOf({ status: 'success' }),
        loading: false,
        triggerUploadSync: jest.fn(),
        isCooldownActive: false,
        refresh: refreshSync,
      });

      act(() => {
        rerender(<YouTubePageClient />);
      });

      // Poll path fires onRunComplete on live → terminal transition
      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      expect(subs.refresh).toHaveBeenCalledTimes(1);
      expect(carousel.refresh).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  describe('YouTube availability gate', () => {
    it('should show unavailable when explicitly false', () => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: false,
        loading: false,
        error: null,
      });

      render(<YouTubePageClient />);

      expect(
        screen.getByRole('heading', {
          name: /YouTube is not available right now/i,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /Back to Dashboard/i }),
      ).toBeInTheDocument();
    });

    it('should show unavailable while loading availability', () => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: null,
        loading: true,
        error: null,
      });

      render(<YouTubePageClient />);

      expect(
        screen.getByRole('heading', {
          name: /YouTube is not available right now/i,
        }),
      ).toBeInTheDocument();
    });

    it('shows the unreachable notice with Try again when the availability check errored', () => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: null,
        loading: false,
        error: new Error('Service unavailable'),
      });

      render(<YouTubePageClient />);

      expect(
        screen.getByRole('heading', {
          name: "YouTube can't be reached right now",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Try again' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', {
          name: /YouTube is not available right now/i,
        }),
      ).not.toBeInTheDocument();
    });

    it('should show unavailable when available is null and not loading', () => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: null,
        loading: false,
        error: null,
      });

      render(<YouTubePageClient />);

      expect(
        screen.getByRole('heading', {
          name: /YouTube is not available right now/i,
        }),
      ).toBeInTheDocument();
    });

    it('should show dashboard when available and connected', () => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: true,
        loading: false,
        error: null,
      });
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      render(<YouTubePageClient />);

      expect(screen.getByText('Videos')).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', {
          name: /YouTube is not available/i,
        }),
      ).not.toBeInTheDocument();
    });

    it('should show unavailable even when user is connected', () => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: false,
        loading: false,
        error: null,
      });
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      render(<YouTubePageClient />);

      expect(
        screen.getByRole('heading', {
          name: /YouTube is not available right now/i,
        }),
      ).toBeInTheDocument();
      expect(screen.queryByText('Videos')).not.toBeInTheDocument();
    });

    it('should link back to /dashboard in unavailable state', () => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: false,
        loading: false,
        error: null,
      });

      render(<YouTubePageClient />);

      const backLink = screen.getByRole('link', {
        name: /Back to Dashboard/i,
      });
      expect(backLink).toHaveAttribute('href', '/dashboard');
    });

    it.each([
      ['explicitly false', { available: false, loading: false, error: null }],
      ['still loading', { available: null, loading: true, error: null }],
    ])(
      'makes no connection or data hook call when availability is %s',
      (_label, availability) => {
        mockUseYouTubeAvailability.mockReturnValue(availability);

        render(<YouTubePageClient />);

        expect(
          screen.getByRole('heading', {
            name: /YouTube is not available right now/i,
          }),
        ).toBeInTheDocument();
        [
          mockUseYouTubeStatus,
          mockUseYouTubeConnect,
          mockUseYouTubeSubscriptions,
          mockUseYouTubeCarousel,
          mockUseYouTubeSyncStatus,
          mockUseVideoQueue,
          mockUseChannelUploads,
        ].forEach((hook) => expect(hook).not.toHaveBeenCalled());
      },
    );
  });

  describe('page header and subtitle', () => {
    const oneChannel = (videos: Array<{ watched: boolean }>) => [
      {
        channelId: 'ch-1',
        channelTitle: 'Channel 1',
        channelThumbnail: null,
        videos: videos.map((v, i) => ({
          id: `row-${i}`,
          videoId: `v-${i}`,
          channelId: 'ch-1',
          title: `Upload ${i}`,
          thumbnail: null,
          publishedAt: '2026-01-01T00:00:00Z',
          channelTitle: 'Channel 1',
          watched: v.watched,
        })),
      },
    ];

    beforeEach(() => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });
    });

    it('names the page with one h1 "YouTube"', () => {
      render(<YouTubePageClient />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'YouTube' }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('states the sync line, channel count and new upload count in the subtitle', () => {
      mockUseYouTubeCarousel.mockReturnValue({
        ...defaultCarousel,
        channels: oneChannel([{ watched: false }, { watched: false }]),
      });

      render(<YouTubePageClient />);

      expect(
        screen.getByText('Checking sync status… · 1 channel · 2 new uploads'),
      ).toBeInTheDocument();
    });

    it('uses the singular forms for one channel and one new upload', () => {
      mockUseYouTubeCarousel.mockReturnValue({
        ...defaultCarousel,
        channels: oneChannel([{ watched: false }]),
      });

      render(<YouTubePageClient />);

      expect(
        screen.getByText('Checking sync status… · 1 channel · 1 new upload'),
      ).toBeInTheDocument();
    });

    it('omits the new-uploads part of the subtitle when nothing is new', () => {
      mockUseYouTubeCarousel.mockReturnValue({
        ...defaultCarousel,
        channels: oneChannel([{ watched: true }]),
      });

      render(<YouTubePageClient />);

      expect(
        screen.getByText('Checking sync status… · 1 channel'),
      ).toBeInTheDocument();
    });

    it('shows the failed sync state and announces it politely', () => {
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: statusOf({ status: 'failed', lastSyncError: null }),
        loading: false,
        triggerUploadSync: jest.fn(),
        isCooldownActive: false,
        refresh: jest.fn(),
      });

      render(<YouTubePageClient />);

      expect(screen.getByText('Last sync failed')).toBeInTheDocument();
      // The detail is drawn once visibly and once inside the polite region.
      const visibleDetail = screen
        .getAllByText(/No channel synced on the last attempt/)
        .filter((el) => el.getAttribute('aria-live') === null);
      expect(visibleDetail).toHaveLength(1);

      const politeRegions = screen
        .getAllByRole('status')
        .filter((el) => el.getAttribute('aria-live') === 'polite');
      expect(
        politeRegions.some((el) =>
          el.textContent?.startsWith('Last sync failed.'),
        ),
      ).toBe(true);
    });

    it('keeps the h1 visually hidden on phone and still shows the subtitle', () => {
      mockUseIsMobileState.mockReturnValue(true);
      mockUseYouTubeCarousel.mockReturnValue({
        ...defaultCarousel,
        channels: oneChannel([{ watched: false }]),
      });

      render(<YouTubePageClient />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'YouTube' }),
      ).toHaveClass('sr-only');
      expect(
        screen.getByText('Checking sync status… · 1 channel · 1 new upload'),
      ).toBeInTheDocument();
    });

    it('renders the desktop header while useIsMobileState is undefined', () => {
      mockUseIsMobileState.mockReturnValue(undefined);

      render(<YouTubePageClient />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'YouTube' }),
      ).not.toHaveClass('sr-only');
      expect(
        screen.getByRole('button', { name: 'Sync uploads' }),
      ).toHaveTextContent('Sync uploads');
    });
  });

  describe('section navigation', () => {
    const twoSubscriptions = [
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

    beforeEach(() => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });
      mockUseYouTubeSubscriptions.mockReturnValue({
        ...defaultSubs,
        subscriptions: twoSubscriptions,
        loading: false,
      });
    });

    it('marks Videos as the current section and counts all subscriptions on Channels (desktop)', () => {
      render(<YouTubePageClient />);

      const nav = screen.getByRole('navigation', { name: 'YouTube' });
      expect(within(nav).getByRole('link', { name: 'Videos' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(
        within(nav).getByRole('link', { name: 'Channels · 2' }),
      ).toHaveAttribute('href', '/dashboard/youtube/channels');
    });

    it('carries no count on the phone section navigation', () => {
      mockUseIsMobileState.mockReturnValue(true);

      render(<YouTubePageClient />);

      const nav = screen.getByRole('navigation', { name: 'YouTube' });
      expect(
        within(nav).getByRole('link', { name: 'Channels' }),
      ).toBeInTheDocument();
      expect(
        within(nav).queryByRole('link', { name: /Channels · / }),
      ).not.toBeInTheDocument();
    });

    it('shows Channels without a count while subscriptions are loading', () => {
      mockUseYouTubeSubscriptions.mockReturnValue({
        ...defaultSubs,
        subscriptions: [],
        loading: true,
      });

      render(<YouTubePageClient />);

      const nav = screen.getByRole('navigation', { name: 'YouTube' });
      expect(
        within(nav).getByRole('link', { name: 'Channels' }),
      ).toBeInTheDocument();
    });
  });

  describe('sync button', () => {
    it('shows the text on desktop with its name and title', () => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      render(<YouTubePageClient />);

      const button = screen.getByRole('button', { name: 'Sync uploads' });
      expect(button).toHaveTextContent('Sync uploads');
      expect(button).toHaveAttribute('title', 'Sync uploads');
    });

    it('is icon-only on phone and keeps its name and title', () => {
      mockUseIsMobileState.mockReturnValue(true);
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });

      render(<YouTubePageClient />);

      const button = screen.getByRole('button', { name: 'Sync uploads' });
      expect(button.textContent).toBe('');
      expect(button).toHaveAttribute('title', 'Sync uploads');
    });

    it('stays disabled under the cooldown label on phone', () => {
      mockUseIsMobileState.mockReturnValue(true);
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });
      const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
      mockUseYouTubeSyncStatus.mockReturnValue({
        status: { retryAt: future, channelStatus: 'never' },
        loading: false,
        triggerUploadSync: jest.fn(),
        isCooldownActive: true,
        refresh: jest.fn(),
      });

      render(<YouTubePageClient />);

      const button = screen.getByRole('button', {
        name: /Sync uploads disabled until/i,
      });
      expect(button).toBeDisabled();
    });
  });

  describe('queue rail placement', () => {
    beforeEach(() => {
      mockUseYouTubeStatus.mockReturnValue({
        connected: true,
        status: 'connected',
        refresh: jest.fn(),
      });
    });

    it('puts the Queue disclosure in the mobile-only column and the rail in the desktop-only column', () => {
      const { container } = render(<YouTubePageClient />);

      const disclosure = screen.getByText('Queue · 0 of 4').closest('details');
      expect(disclosure?.parentElement).toHaveClass('md:hidden');

      const desktopRail = container.querySelector(
        '[aria-labelledby="queue-rail-heading-desktop"]',
      );
      expect(desktopRail).toBeInTheDocument();
      expect(desktopRail?.parentElement).toHaveClass('hidden', 'md:block');
    });
  });
});
