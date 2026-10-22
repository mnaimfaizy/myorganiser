/* eslint-disable import/first */
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../hooks', () => ({
  useShortsBudget: jest.fn(),
  useYouTubeAvailability: jest.fn(),
  useYouTubeShorts: jest.fn(),
  useYouTubeStatus: jest.fn(),
  updateVideoWatched: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  Illustration: () => null,
  useIsMobileState: jest.fn(),
  Button: ({ children, asChild, ...props }: any) => {
    if (asChild) return children;
    return <button {...props}>{children}</button>;
  },
  Skeleton: ({ className }: any) => (
    <div className={className} data-testid="skeleton" />
  ),
  cn: (...classes: Array<string | undefined>) =>
    classes.filter(Boolean).join(' '),
}));

// The section nav is real, and it needs aria-current to reach the DOM.
jest.mock('next/link', () => {
  return ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
});

// The availability notice imports the recheck action; the page never calls it.
jest.mock('@myorganiser/web-youtube', () => ({
  requestYouTubeAvailabilityRecheck: jest.fn(),
}));

// The connect prompt calls its own acknowledgement hook, which is outside this
// page's contract. The page only decides whether to render the prompt.
jest.mock('./YouTubeConnectPrompt', () => ({
  YouTubeConnectPrompt: () => <p>Connect Your YouTube Account</p>,
}));

// Mock ShortsPlayerPanel with a simple div so we can confirm it renders in the
// unlocked branch, plus buttons standing in for each playback signal the real
// panel forwards: the Play press, an embed state report, and an embed refusal.
jest.mock('./ShortsPlayerPanel', () => ({
  ShortsPlayerPanel: ({
    activeShort,
    variant,
    usedPercent,
    onNearEnd,
    onWatchedToggle,
    onPlaybackStart,
    onPlayingChange,
    onPlaybackUnavailable,
  }: any) => (
    <div
      data-testid="player-panel"
      data-variant={variant}
      data-active-id={activeShort?.videoId}
      data-used-percent={usedPercent}
    >
      {activeShort ? activeShort.title : 'No short'}
      <button data-testid="mock-near-end" onClick={() => onNearEnd?.()}>
        near end
      </button>
      <button data-testid="mock-toggle" onClick={() => onWatchedToggle?.()}>
        toggle watched
      </button>
      <button data-testid="press-play" onClick={() => onPlaybackStart?.()}>
        press play
      </button>
      <button
        data-testid="report-playing"
        onClick={() => onPlayingChange?.(true)}
      >
        report playing
      </button>
      <button
        data-testid="report-paused"
        onClick={() => onPlayingChange?.(false)}
      >
        report paused
      </button>
      <button
        data-testid="report-unavailable"
        onClick={() => onPlaybackUnavailable?.()}
      >
        report unavailable
      </button>
    </div>
  ),
}));

// Mock ShortsList so we can confirm it renders in unlocked branch
jest.mock('./ShortsList', () => ({
  ShortsList: ({ shorts, onSelectShort }: any) => (
    <div data-testid="shorts-list">
      <p>All Shorts</p>
      {shorts.map((s: any) => (
        <button
          key={s.videoId}
          data-testid={`short-${s.videoId}`}
          onClick={() => onSelectShort?.(s.videoId)}
        >
          {s.title}
        </button>
      ))}
    </div>
  ),
}));

// Mock ShortsEntryWarning with a clickable button so the gate can open
jest.mock('./ShortsEntryWarning', () => ({
  ShortsEntryWarning: ({ onContinue }: any) => (
    <button data-testid="entry-continue" onClick={onContinue}>
      Continue to Shorts
    </button>
  ),
}));

jest.mock('./ShortsBudgetMeter', () => ({
  ShortsBudgetMeter: ({ onLimitMinutesChange, showProgressBar }: any) => (
    <div data-testid="meter" data-show-progress-bar={String(showProgressBar)}>
      Meter
      <button
        data-testid="set-limit"
        onClick={() => onLimitMinutesChange?.(15)}
      >
        set limit
      </button>
    </div>
  ),
}));

// Do NOT mock ShortsHardStop — render the real component so link-scan assertions
// catch any youtube.com hrefs in the actual implementation
// jest.mock('./ShortsHardStop', ...);

import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { useIsMobileState } from '@myorganiser/web-ui';
import {
  updateVideoWatched,
  useShortsBudget,
  useYouTubeAvailability,
  useYouTubeShorts,
  useYouTubeStatus,
} from '../hooks';
import { ShortsPageClient } from './ShortsPageClient';

describe('ShortsPageClient — locked and unlocked branches', () => {
  const mockShort = {
    id: 'short-1',
    videoId: 'dQw4w9WgXcQ',
    channelId: 'ch-1',
    title: 'Test Short',
    thumbnail: 'https://example.com/thumb.jpg',
    publishedAt: '2025-12-01T00:00:00Z',
    channelTitle: 'Test Channel',
    watched: false,
  };

  const mockShort2 = {
    id: 'short-2',
    videoId: 'video2',
    channelId: 'ch-2',
    title: 'Another Short',
    thumbnail: 'https://example.com/thumb2.jpg',
    publishedAt: '2025-12-02T00:00:00Z',
    channelTitle: 'Another Channel',
    watched: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    (useYouTubeAvailability as jest.Mock).mockReturnValue({
      available: true,
      loading: false,
      error: null,
    });
    (useYouTubeStatus as jest.Mock).mockReturnValue({
      connected: true,
      status: 'ready',
    });
  });

  describe('locked branch — Hard Stop blocks player and list', () => {
    it('renders the Hard Stop surface, with no player and no Shorts list, when locked after acknowledging', () => {
      (useShortsBudget as jest.Mock).mockReturnValue({
        spentMs: 3600000,
        limitMs: 3600000,
        remainingMs: 0,
        usedPercent: 100,
        locked: true,
        dayKey: '2026-08-10',
        metering: false,
        setLimitMinutes: jest.fn(),
      });

      (useYouTubeShorts as jest.Mock).mockReturnValue({
        shorts: [mockShort, mockShort2],
        loading: false,
        error: null,
        updateWatched: jest.fn(),
        refresh: jest.fn(),
      });

      const { container } = render(<ShortsPageClient />);

      // Acknowledge the entry warning
      expect(screen.getByTestId('entry-continue')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('entry-continue'));

      // Hard Stop should render
      expect(
        screen.getByRole('status', { name: /exhausted/i }),
      ).toBeInTheDocument();

      // Player panel and shorts list mocks should NOT render
      expect(screen.queryByTestId('player-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('shorts-list')).not.toBeInTheDocument();

      // Verify no youtube.com links in the actual Hard Stop component
      const allLinks = container.querySelectorAll('a[href]');
      allLinks.forEach((link) => {
        const href = link.getAttribute('href') || '';
        expect(href).not.toContain('youtube.com');
        expect(href).not.toContain('www.youtube');
      });
    });
  });

  describe('unlocked branch — player and list render after acknowledging', () => {
    it('renders the player and the Shorts list when unlocked after acknowledging', () => {
      (useShortsBudget as jest.Mock).mockReturnValue({
        spentMs: 0,
        limitMs: 3600000,
        remainingMs: 3600000,
        usedPercent: 0,
        locked: false,
        dayKey: '2026-08-10',
        metering: false,
        setLimitMinutes: jest.fn(),
      });

      (useYouTubeShorts as jest.Mock).mockReturnValue({
        shorts: [mockShort, mockShort2],
        loading: false,
        error: null,
        updateWatched: jest.fn(),
        refresh: jest.fn(),
      });

      render(<ShortsPageClient />);

      // Acknowledge the entry warning
      expect(screen.getByTestId('entry-continue')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('entry-continue'));

      // Player panel mock should render
      expect(screen.getByTestId('player-panel')).toBeInTheDocument();

      // Shorts list mock should render with all shorts
      expect(screen.getByTestId('shorts-list')).toBeInTheDocument();
      expect(screen.getByTestId('short-dQw4w9WgXcQ')).toBeInTheDocument();
      expect(screen.getByTestId('short-video2')).toBeInTheDocument();

      // Hard Stop should NOT render
      expect(
        screen.queryByRole('status', { name: /exhausted/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('YouTube availability gate', () => {
    beforeEach(() => {
      (useShortsBudget as jest.Mock).mockReturnValue({
        spentMs: 0,
        limitMs: 3600000,
        remainingMs: 3600000,
        usedPercent: 0,
        locked: false,
        dayKey: '2026-08-10',
        metering: false,
        setLimitMinutes: jest.fn(),
      });
      (useYouTubeShorts as jest.Mock).mockReturnValue({
        shorts: [],
        loading: false,
        error: null,
        updateWatched: jest.fn(),
        refresh: jest.fn(),
      });
    });

    it('shows unavailable notice and no Shorts UI when availability is false', () => {
      (useYouTubeAvailability as jest.Mock).mockReturnValue({
        available: false,
        loading: false,
        error: null,
      });

      render(<ShortsPageClient />);

      expect(
        screen.getByRole('heading', {
          name: /YouTube is not available right now/i,
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Connect Your YouTube Account/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId('entry-continue')).not.toBeInTheDocument();
      expect(screen.queryByTestId('player-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('shorts-list')).not.toBeInTheDocument();
    });

    it('shows unavailable notice and no Shorts UI while availability is loading', () => {
      (useYouTubeAvailability as jest.Mock).mockReturnValue({
        available: null,
        loading: true,
        error: null,
      });

      render(<ShortsPageClient />);

      expect(
        screen.getByRole('heading', {
          name: /YouTube is not available right now/i,
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Connect Your YouTube Account/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId('entry-continue')).not.toBeInTheDocument();
      expect(screen.queryByTestId('player-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('shorts-list')).not.toBeInTheDocument();
    });

    it('shows unavailable notice and no Shorts UI when availability is null', () => {
      (useYouTubeAvailability as jest.Mock).mockReturnValue({
        available: null,
        loading: false,
        error: null,
      });

      render(<ShortsPageClient />);

      expect(
        screen.getByRole('heading', {
          name: /YouTube is not available right now/i,
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Connect Your YouTube Account/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId('entry-continue')).not.toBeInTheDocument();
      expect(screen.queryByTestId('player-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('shorts-list')).not.toBeInTheDocument();
    });

    it.each([
      ['explicitly false', { available: false, loading: false, error: null }],
      ['still loading', { available: null, loading: true, error: null }],
    ])(
      'makes no connection, Shorts or budget hook call when availability is %s',
      (_label, availability) => {
        (useYouTubeAvailability as jest.Mock).mockReturnValue(availability);

        render(<ShortsPageClient />);

        expect(
          screen.getByRole('heading', {
            name: /YouTube is not available right now/i,
          }),
        ).toBeInTheDocument();
        expect(useYouTubeStatus).not.toHaveBeenCalled();
        expect(useYouTubeShorts).not.toHaveBeenCalled();
        expect(useShortsBudget).not.toHaveBeenCalled();
      },
    );
  });

  describe('gates — entry warning and connection', () => {
    it('shows entry warning gate on initial render before acknowledgement', () => {
      (useShortsBudget as jest.Mock).mockReturnValue({
        spentMs: 0,
        limitMs: 3600000,
        remainingMs: 3600000,
        usedPercent: 0,
        locked: false,
        dayKey: '2026-08-10',
        metering: false,
        setLimitMinutes: jest.fn(),
      });

      (useYouTubeShorts as jest.Mock).mockReturnValue({
        shorts: [mockShort],
        loading: false,
        error: null,
        updateWatched: jest.fn(),
        refresh: jest.fn(),
      });

      render(<ShortsPageClient />);

      expect(screen.getByTestId('entry-continue')).toBeInTheDocument();
      expect(screen.queryByTestId('player-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('shorts-list')).not.toBeInTheDocument();
    });

    it('shows connection gate when not connected', () => {
      (useYouTubeStatus as jest.Mock).mockReturnValue({
        connected: false,
        status: 'ready',
      });

      (useShortsBudget as jest.Mock).mockReturnValue({
        spentMs: 0,
        limitMs: 3600000,
        remainingMs: 3600000,
        usedPercent: 0,
        locked: false,
        dayKey: '2026-08-10',
        metering: false,
        setLimitMinutes: jest.fn(),
      });

      (useYouTubeShorts as jest.Mock).mockReturnValue({
        shorts: [mockShort],
        loading: false,
        error: null,
        updateWatched: jest.fn(),
        refresh: jest.fn(),
      });

      render(<ShortsPageClient />);

      expect(
        screen.getByText(/Connect Your YouTube Account/i),
      ).toBeInTheDocument();
    });
  });
  describe('metering fails closed when the embed never reports state', () => {
    const unlockedBudget = {
      spentMs: 0,
      limitMs: 3600000,
      remainingMs: 3600000,
      usedPercent: 0,
      locked: false,
      dayKey: '2026-08-10',
      metering: false,
      setLimitMinutes: jest.fn(),
    };

    /** The `active` argument the page last handed `useShortsBudget`. */
    const lastMeteringArg = () => {
      const calls = (useShortsBudget as jest.Mock).mock.calls;
      return calls[calls.length - 1][0];
    };

    const renderAcknowledged = () => {
      (useShortsBudget as jest.Mock).mockReturnValue(unlockedBudget);
      (useYouTubeShorts as jest.Mock).mockReturnValue({
        shorts: [mockShort, mockShort2],
        loading: false,
        error: null,
        updateWatched: jest.fn(),
        refresh: jest.fn(),
      });

      render(<ShortsPageClient />);
      fireEvent.click(screen.getByTestId('entry-continue'));
    };

    it('does not meter before the User presses Play', () => {
      renderAcknowledged();

      expect(lastMeteringArg()).toBe(false);
    });

    it('meters from the Play press alone when no state ever arrives', () => {
      renderAcknowledged();

      fireEvent.click(screen.getByTestId('press-play'));

      // The embed has reported nothing. Metering must still be running, or the
      // Shorts Hard Stop would never fire for a User whose embed is silent.
      expect(lastMeteringArg()).toBe(true);
    });

    it('stops metering when the embed reports a pause and resumes on play', () => {
      renderAcknowledged();

      fireEvent.click(screen.getByTestId('press-play'));
      fireEvent.click(screen.getByTestId('report-paused'));
      expect(lastMeteringArg()).toBe(false);

      fireEvent.click(screen.getByTestId('report-playing'));
      expect(lastMeteringArg()).toBe(true);
    });

    it('keeps metering across Shorts, because the embed autoplays the next one', () => {
      renderAcknowledged();

      fireEvent.click(screen.getByTestId('press-play'));
      fireEvent.click(screen.getByTestId('short-video2'));

      expect(lastMeteringArg()).toBe(true);
    });

    it('re-arms after a pause when the User moves to another Short', () => {
      renderAcknowledged();

      fireEvent.click(screen.getByTestId('press-play'));
      fireEvent.click(screen.getByTestId('report-paused'));
      expect(lastMeteringArg()).toBe(false);

      // The stale pause belongs to the previous Short; the new one autoplays.
      fireEvent.click(screen.getByTestId('short-video2'));
      expect(lastMeteringArg()).toBe(true);
    });

    it('stops metering when the embed refuses to play the Short', () => {
      renderAcknowledged();

      fireEvent.click(screen.getByTestId('press-play'));
      fireEvent.click(screen.getByTestId('report-unavailable'));

      expect(lastMeteringArg()).toBe(false);
    });

    it('does not meter while the entry warning is still up', () => {
      (useShortsBudget as jest.Mock).mockReturnValue(unlockedBudget);
      (useYouTubeShorts as jest.Mock).mockReturnValue({
        shorts: [mockShort],
        loading: false,
        error: null,
        updateWatched: jest.fn(),
        refresh: jest.fn(),
      });

      render(<ShortsPageClient />);

      expect(lastMeteringArg()).toBe(false);
    });

    it('stops metering and shows the Hard Stop when the budget locks after Play was pressed', () => {
      (useShortsBudget as jest.Mock).mockReturnValue(unlockedBudget);
      (useYouTubeShorts as jest.Mock).mockReturnValue({
        shorts: [mockShort],
        loading: false,
        error: null,
        updateWatched: jest.fn(),
        refresh: jest.fn(),
      });

      const { rerender } = render(<ShortsPageClient />);
      fireEvent.click(screen.getByTestId('entry-continue'));
      fireEvent.click(screen.getByTestId('press-play'));
      expect(lastMeteringArg()).toBe(true);

      (useShortsBudget as jest.Mock).mockReturnValue({
        ...unlockedBudget,
        spentMs: 3600000,
        remainingMs: 0,
        usedPercent: 100,
        locked: true,
      });
      rerender(<ShortsPageClient />);

      expect(lastMeteringArg()).toBe(false);
      expect(
        screen.getByRole('status', { name: /exhausted/i }),
      ).toBeInTheDocument();
    });
  });

  describe('availability check error', () => {
    it('shows the unreachable notice, with Try again, and makes no Shorts or budget call', () => {
      (useYouTubeAvailability as jest.Mock).mockReturnValue({
        available: null,
        loading: false,
        error: new Error('network down'),
      });

      render(<ShortsPageClient />);

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
      expect(useYouTubeStatus).not.toHaveBeenCalled();
      expect(useShortsBudget).not.toHaveBeenCalled();
      expect(useYouTubeShorts).not.toHaveBeenCalled();
    });
  });

  describe('page states, navigation and wiring', () => {
    /**
     * Renders the page on the given state; acknowledges the entry gate unless
     * told not to. `budget` and `shortsState` override the defaults per test.
     */
    const renderShorts = ({
      locked = false,
      phone = false,
      acknowledge = true,
      budget = {},
      shortsState = {},
    }: {
      locked?: boolean;
      phone?: boolean;
      acknowledge?: boolean;
      budget?: Record<string, unknown>;
      shortsState?: Record<string, unknown>;
    } = {}) => {
      (useIsMobileState as jest.Mock).mockReturnValue(phone);
      (useShortsBudget as jest.Mock).mockReturnValue({
        spentMs: locked ? 3600000 : 0,
        limitMs: 3600000,
        remainingMs: locked ? 0 : 3600000,
        usedPercent: locked ? 100 : 0,
        locked,
        dayKey: '2026-08-10',
        metering: false,
        setLimitMinutes: jest.fn(),
        ...budget,
      });
      (useYouTubeShorts as jest.Mock).mockReturnValue({
        shorts: [mockShort, mockShort2],
        loading: false,
        error: null,
        updateWatched: jest.fn(),
        refresh: jest.fn(),
        ...shortsState,
      });

      render(<ShortsPageClient />);
      if (acknowledge) {
        fireEvent.click(screen.getByTestId('entry-continue'));
      }
    };

    it.each([
      ['entry gate', { acknowledge: false }],
      ['desktop active', {}],
      ['phone active', { phone: true }],
      ['Hard Stop', { locked: true }],
    ])(
      'keeps the Shorts h1 visually hidden on the %s state',
      (_state, options) => {
        renderShorts(options);

        expect(
          screen.getByRole('heading', { level: 1, name: 'Shorts' }),
        ).toHaveClass('sr-only');
      },
    );

    it('shows the section nav with Shorts current and Videos and Channels as links, without the old Videos button or subtitle', () => {
      renderShorts();

      const nav = screen.getByRole('navigation', { name: 'YouTube' });
      expect(within(nav).getByRole('link', { name: 'Shorts' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(
        within(nav).getByRole('link', { name: 'Channels' }),
      ).toHaveAttribute('href', '/dashboard/youtube/channels');
      expect(within(nav).getByRole('link', { name: 'Videos' })).toHaveAttribute(
        'href',
        '/dashboard/youtube',
      );
      expect(
        screen.queryByRole('button', { name: 'Videos' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Time-capped daily budget/i),
      ).not.toBeInTheDocument();
    });

    it.each([
      ['desktop', false],
      ['phone', true],
    ])(
      'renders the player in the %s variant when the phone breakpoint is %s',
      (variant, phone) => {
        renderShorts({ phone });

        expect(screen.getByTestId('player-panel')).toHaveAttribute(
          'data-variant',
          variant,
        );
      },
    );

    it('shows Loading… while the connection status is loading', () => {
      (useYouTubeStatus as jest.Mock).mockReturnValue({
        connected: false,
        status: 'loading',
      });
      renderShorts({ acknowledge: false });

      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByTestId('entry-continue')).not.toBeInTheDocument();
    });

    it('shows skeletons while the first Shorts load is in flight', () => {
      renderShorts({ shortsState: { shorts: [], loading: true } });

      expect(screen.getAllByTestId('skeleton')).toHaveLength(2);
      expect(screen.queryByTestId('player-panel')).not.toBeInTheDocument();
    });

    it('shows the error message with Retry, which refreshes the Shorts', () => {
      const refresh = jest.fn();
      renderShorts({
        shortsState: { shorts: [], error: 'Feed unavailable', refresh },
      });

      expect(screen.getByText('Failed to load Shorts')).toBeInTheDocument();
      expect(screen.getByText('Feed unavailable')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('shows the empty state when the Shorts list is empty', () => {
      renderShorts({ shortsState: { shorts: [] } });

      expect(screen.getByText('No Shorts to Watch')).toBeInTheDocument();
      expect(screen.queryByTestId('player-panel')).not.toBeInTheDocument();
    });

    it('moves between Shorts with arrow keys, wrapping from the first to the last', () => {
      renderShorts();
      const activeId = () =>
        screen.getByTestId('player-panel').getAttribute('data-active-id');

      expect(activeId()).toBe('dQw4w9WgXcQ');
      fireEvent.keyDown(document.body, { key: 'ArrowDown' });
      expect(activeId()).toBe('video2');
      fireEvent.keyDown(document.body, { key: 'ArrowDown' });
      expect(activeId()).toBe('dQw4w9WgXcQ');
      fireEvent.keyDown(document.body, { key: 'ArrowUp' });
      expect(activeId()).toBe('video2');
    });

    it('ignores arrow keys pressed inside an editable field', () => {
      renderShorts();
      const input = document.createElement('input');
      document.body.appendChild(input);

      try {
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(
          screen.getByTestId('player-panel').getAttribute('data-active-id'),
        ).toBe('dQw4w9WgXcQ');
      } finally {
        input.remove();
      }
    });

    it('keeps the player and the local watched mark when the near-end API call fails', async () => {
      const updateWatched = jest.fn();
      (updateVideoWatched as jest.Mock).mockRejectedValueOnce(
        new Error('network down'),
      );
      renderShorts({ shortsState: { updateWatched } });

      fireEvent.click(screen.getByTestId('mock-near-end'));
      await act(async () => {
        await Promise.resolve();
      });

      expect(updateWatched).toHaveBeenCalledWith('dQw4w9WgXcQ', true);
      expect(screen.getByTestId('player-panel')).toBeInTheDocument();
    });

    it('keeps the player and the local toggle when the toggle API call fails', async () => {
      const updateWatched = jest.fn();
      (updateVideoWatched as jest.Mock).mockRejectedValueOnce(
        new Error('network down'),
      );
      renderShorts({ shortsState: { updateWatched } });

      fireEvent.click(screen.getByTestId('mock-toggle'));
      await act(async () => {
        await Promise.resolve();
      });

      expect(updateWatched).toHaveBeenCalledWith('dQw4w9WgXcQ', true);
      expect(screen.getByTestId('player-panel')).toBeInTheDocument();
    });

    it('keeps the Shorts list and hides the load error when a refresh fails with Shorts already loaded', () => {
      renderShorts({ shortsState: { error: 'Refresh failed' } });

      expect(screen.getByTestId('shorts-list')).toBeInTheDocument();
      expect(
        screen.queryByText('Failed to load Shorts'),
      ).not.toBeInTheDocument();
    });

    it('reports a near-end Short as watched, locally and to the API', () => {
      const updateWatched = jest.fn();
      (updateVideoWatched as jest.Mock).mockResolvedValue({
        ok: true,
        watched: true,
      });
      renderShorts({ shortsState: { updateWatched } });

      fireEvent.click(screen.getByTestId('mock-near-end'));

      expect(updateWatched).toHaveBeenCalledWith('dQw4w9WgXcQ', true);
      expect(updateVideoWatched).toHaveBeenCalledWith('dQw4w9WgXcQ', true);
    });

    it('toggles the active Short to the opposite of its current watched state', () => {
      const updateWatched = jest.fn();
      (updateVideoWatched as jest.Mock).mockResolvedValue({
        ok: true,
        watched: true,
      });
      renderShorts({ shortsState: { updateWatched } });

      // First Short is unwatched, so the toggle marks it watched.
      fireEvent.click(screen.getByTestId('mock-toggle'));
      expect(updateWatched).toHaveBeenLastCalledWith('dQw4w9WgXcQ', true);

      // The second Short is watched, so the toggle marks it new again.
      fireEvent.click(screen.getByTestId('short-video2'));
      fireEvent.click(screen.getByTestId('mock-toggle'));
      expect(updateWatched).toHaveBeenLastCalledWith('video2', false);
      expect(updateVideoWatched).toHaveBeenLastCalledWith('video2', false);
    });

    it('wires the meter limit change to budget.setLimitMinutes', () => {
      const setLimitMinutes = jest.fn();
      renderShorts({ budget: { setLimitMinutes } });

      fireEvent.click(screen.getByTestId('set-limit'));

      expect(setLimitMinutes).toHaveBeenCalledWith(15);
    });

    describe('meter placement and progress bar ownership', () => {
      /** True when `second` comes after `first` in document order. */
      const followsInDom = (first: HTMLElement, second: HTMLElement) =>
        (first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0;

      it('keeps the meter before the player on desktop, and passes showProgressBar=true to it', () => {
        renderShorts();

        const meter = screen.getByTestId('meter');
        expect(followsInDom(meter, screen.getByTestId('player-panel'))).toBe(
          true,
        );
        expect(meter).toHaveAttribute('data-show-progress-bar', 'true');
      });

      it('moves the meter after the player and Up next on phone, and passes showProgressBar=false while the stage shows', () => {
        renderShorts({ phone: true });

        const meter = screen.getByTestId('meter');
        expect(followsInDom(screen.getByTestId('player-panel'), meter)).toBe(
          true,
        );
        expect(followsInDom(screen.getByTestId('shorts-list'), meter)).toBe(
          true,
        );
        expect(meter).toHaveAttribute('data-show-progress-bar', 'false');
      });

      it('keeps the meter after the Hard Stop on phone when locked, and passes showProgressBar=true to it', () => {
        renderShorts({ phone: true, locked: true });

        const meter = screen.getByTestId('meter');
        expect(
          followsInDom(
            screen.getByRole('status', { name: /exhausted/i }),
            meter,
          ),
        ).toBe(true);
        expect(meter).toHaveAttribute('data-show-progress-bar', 'true');
      });

      it('passes the budget usedPercent to the phone player panel', () => {
        renderShorts({ phone: true, budget: { usedPercent: 42 } });

        expect(screen.getByTestId('player-panel')).toHaveAttribute(
          'data-used-percent',
          '42',
        );
      });
    });
  });
});
