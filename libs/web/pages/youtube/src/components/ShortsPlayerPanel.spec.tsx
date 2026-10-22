/* eslint-disable import/first */
import '@testing-library/jest-dom';

jest.mock('@myorganiser/web-ui', () => ({
  Button: ({ children, asChild, ...props }: any) => {
    if (asChild) return children;
    return <button {...props}>{children}</button>;
  },
  cn: (...classes: Array<string | undefined>) =>
    classes.filter(Boolean).join(' '),
}));

jest.mock('lucide-react', () => ({
  ChevronLeft: ({ className }: { className?: string }) => (
    <span className={className} data-testid="chevron-left" />
  ),
  ChevronRight: ({ className }: { className?: string }) => (
    <span className={className} data-testid="chevron-right" />
  ),
  ChevronUp: ({ className }: { className?: string }) => (
    <span className={className} data-testid="chevron-up" />
  ),
  ChevronDown: ({ className }: { className?: string }) => (
    <span className={className} data-testid="chevron-down" />
  ),
}));

jest.mock('./YouTubeVideoPlayer', () => ({
  YouTubeVideoPlayer: ({
    video,
    watched,
    onNearEnd,
    onPlay,
    onPlayingChange,
    onPlaybackUnavailable,
  }: {
    video: any;
    watched: boolean;
    onNearEnd?: () => void;
    onPlay?: () => void;
    onPlayingChange?: (playing: boolean) => void;
    onPlaybackUnavailable?: () => void;
  }) => (
    <div
      data-testid={`player-${video.videoId}`}
      data-watched={watched}
      onClick={() => onPlayingChange?.(true)}
    >
      Player: {video.title}
      <button
        data-testid="mock-near-end"
        onClick={(e: any) => {
          e.stopPropagation();
          onNearEnd?.();
        }}
      >
        near end
      </button>
      {/* Clicking the surrounding div stands in for an embed state report, so
          each inner control has to stop the click from reaching it. */}
      <button
        data-testid="mock-press-play"
        onClick={(e: any) => {
          e.stopPropagation();
          onPlay?.();
        }}
      >
        press play
      </button>
      <button
        data-testid="mock-report-paused"
        onClick={(e: any) => {
          e.stopPropagation();
          onPlayingChange?.(false);
        }}
      >
        report paused
      </button>
      <button
        data-testid="mock-report-unavailable"
        onClick={(e: any) => {
          e.stopPropagation();
          onPlaybackUnavailable?.();
        }}
      >
        report unavailable
      </button>
    </div>
  ),
}));

import { render, screen, fireEvent, within } from '@testing-library/react';
import type { YouTubeVideo } from '../types';
import { ShortsPlayerPanel } from './ShortsPlayerPanel';

describe('ShortsPlayerPanel', () => {
  const baseShort: YouTubeVideo = {
    id: 'short-1',
    videoId: 'dQw4w9WgXcQ',
    channelId: 'ch-1',
    title: 'Test Short',
    thumbnail: 'https://example.com/thumb.jpg',
    publishedAt: '2025-12-01T00:00:00Z',
    channelTitle: 'Test Channel',
    watched: false,
    durationSeconds: 30,
  };

  describe('render condition', () => {
    it('returns null when activeShort is null', () => {
      const { container } = render(
        <ShortsPlayerPanel
          activeShort={null}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders the player when activeShort is present', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByTestId('player-dQw4w9WgXcQ')).toBeInTheDocument();
    });
  });

  describe('budget warning', () => {
    it('shows warning when Short runtime exceeds remaining time', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: 120 }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(
        screen.getByText(
          'This Short is longer than the time you have left today',
        ),
      ).toBeInTheDocument();
    });

    it('does not show warning when remaining time exceeds Short runtime', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: 30 }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={120000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(
        screen.queryByText(
          'This Short is longer than the time you have left today',
        ),
      ).not.toBeInTheDocument();
    });

    it('does not show warning when runtime equals remaining time (boundary)', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: 60 }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(
        screen.queryByText(
          'This Short is longer than the time you have left today',
        ),
      ).not.toBeInTheDocument();
    });

    it('does not show warning when durationSeconds is null', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: null }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(
        screen.queryByText(
          'This Short is longer than the time you have left today',
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe('runtime display', () => {
    it('displays runtime in M:SS format when durationSeconds is set', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: 125 }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={300000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('2:05')).toBeInTheDocument();
    });

    it('displays runtime for exactly 1 minute', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: 60 }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={300000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('1:00')).toBeInTheDocument();
    });

    it('displays runtime for less than 1 minute', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: 45 }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={300000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('0:45')).toBeInTheDocument();
    });

    it('does not display runtime when durationSeconds is null', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: null }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={300000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByTestId('player-dQw4w9WgXcQ')).toBeInTheDocument();
      expect(screen.queryByText(/^\d+:\d{2}$/)).not.toBeInTheDocument();
    });

    it('does not display runtime when durationSeconds is undefined', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: undefined }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={300000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByTestId('player-dQw4w9WgXcQ')).toBeInTheDocument();
      expect(screen.queryByText(/^\d+:\d{2}$/)).not.toBeInTheDocument();
    });
  });

  describe('title and channel display', () => {
    it('displays the Short title', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('Test Short')).toBeInTheDocument();
    });

    it('displays the channel title', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('Test Channel')).toBeInTheDocument();
    });
  });

  describe('previous button', () => {
    it('calls onPrevious when clicked', () => {
      const onPrevious = jest.fn();
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={onPrevious}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByLabelText('Previous Short'));
      expect(onPrevious).toHaveBeenCalledTimes(1);
    });

    it('has aria-label "Previous Short"', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByLabelText('Previous Short')).toBeInTheDocument();
    });
  });

  describe('next button', () => {
    it('calls onNext when clicked', () => {
      const onNext = jest.fn();
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={onNext}
          onWatchedToggle={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByLabelText('Next Short'));
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('has aria-label "Next Short"', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByLabelText('Next Short')).toBeInTheDocument();
    });
  });

  describe('watched toggle', () => {
    it('shows "Mark watched" when watched is false', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, watched: false }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          watched={false}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('Mark watched')).toBeInTheDocument();
    });

    it('shows "Mark as New" when watched is true', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, watched: true }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          watched={true}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('Mark as New')).toBeInTheDocument();
    });

    it('calls onWatchedToggle when clicked', () => {
      const onWatchedToggle = jest.fn();
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={onWatchedToggle}
        />,
      );

      fireEvent.click(screen.getByText('Mark watched'));
      expect(onWatchedToggle).toHaveBeenCalledTimes(1);
    });

    it('defaults to false when watched prop is not provided', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('Mark watched')).toBeInTheDocument();
    });
  });

  describe('position indicator', () => {
    it('displays current index + 1 and total shorts', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={2}
          shortsLength={5}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('3 of 5')).toBeInTheDocument();
    });

    it('displays "1 of X" for first Short', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={10}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('1 of 10')).toBeInTheDocument();
    });

    it('displays "X of X" for last Short', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={9}
          shortsLength={10}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('10 of 10')).toBeInTheDocument();
    });

    it('displays "0 of X" when activeIndex is -1 (invalid)', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={-1}
          shortsLength={5}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByText('0 of 5')).toBeInTheDocument();
    });

    it('has aria-live="polite" for live region announcements', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={2}
          shortsLength={5}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      const indicator = screen.getByText('3 of 5');
      expect(indicator).toHaveAttribute('aria-live', 'polite');
    });

    it('has aria-atomic="true" for atomic live region updates', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={2}
          shortsLength={5}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      const indicator = screen.getByText('3 of 5');
      expect(indicator).toHaveAttribute('aria-atomic', 'true');
    });
  });

  describe('YouTubeVideoPlayer props', () => {
    it('passes video to YouTubeVideoPlayer', () => {
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByTestId('player-dQw4w9WgXcQ')).toBeInTheDocument();
    });

    it('passes watched prop to YouTubeVideoPlayer', () => {
      const { rerender } = render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          watched={false}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByTestId('player-dQw4w9WgXcQ')).toHaveAttribute(
        'data-watched',
        'false',
      );

      rerender(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          watched={true}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(screen.getByTestId('player-dQw4w9WgXcQ')).toHaveAttribute(
        'data-watched',
        'true',
      );
    });

    it('passes onNearEnd callback to YouTubeVideoPlayer', () => {
      const onNearEnd = jest.fn();
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onNearEnd={onNearEnd}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('mock-near-end'));
      expect(onNearEnd).toHaveBeenCalledTimes(1);
    });

    it('forwards the embed reported playing state to onPlayingChange', () => {
      const onPlayingChange = jest.fn();
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPlayingChange={onPlayingChange}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('player-dQw4w9WgXcQ'));
      expect(onPlayingChange).toHaveBeenCalledWith(true);
    });

    it('forwards the Play press to onPlaybackStart, independent of the embed', () => {
      const onPlaybackStart = jest.fn();
      const onPlayingChange = jest.fn();
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPlaybackStart={onPlaybackStart}
          onPlayingChange={onPlayingChange}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('mock-press-play'));
      expect(onPlaybackStart).toHaveBeenCalledTimes(1);
      // The click alone must not be reported as an embed state transition.
      expect(onPlayingChange).not.toHaveBeenCalled();
    });

    it('forwards an unavailable embed to onPlaybackUnavailable', () => {
      const onPlaybackUnavailable = jest.fn();
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPlaybackUnavailable={onPlaybackUnavailable}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('mock-report-unavailable'));
      expect(onPlaybackUnavailable).toHaveBeenCalledTimes(1);
    });
  });

  describe('desktop meta line', () => {
    it('shows the channel, then how long ago the Short was published', () => {
      const publishedAt = new Date(
        Date.now() - 3 * 60 * 60 * 1000,
      ).toISOString();
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, publishedAt }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      // Same locale and formatter as the component, so the expectation holds in any locale.
      const expected = new Intl.RelativeTimeFormat(undefined, {
        numeric: 'auto',
      }).format(-3, 'hour');
      const meta = screen.getByText('Test Channel').closest('p');
      expect(meta?.textContent).toBe(`Test Channel·${expected}`);
    });

    it('omits the time segment when the publish date cannot be parsed', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, publishedAt: 'not-a-date' }}
          activeIndex={0}
          shortsLength={1}
          remainingMs={60000}
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      const meta = screen.getByText('Test Channel').closest('p');
      expect(meta?.textContent).toBe('Test Channel');
    });
  });

  describe('phone variant', () => {
    const renderPhone = (
      onPrevious = jest.fn(),
      onWatchedToggle = jest.fn(),
      onNext = jest.fn(),
    ) =>
      render(
        <ShortsPlayerPanel
          activeShort={baseShort}
          activeIndex={2}
          shortsLength={5}
          remainingMs={60000}
          variant="phone"
          onPrevious={onPrevious}
          onNext={onNext}
          onWatchedToggle={onWatchedToggle}
        />,
      );

    it('calls onPrevious and onNext from the phone row', () => {
      const onPrevious = jest.fn();
      const onNext = jest.fn();
      renderPhone(onPrevious, jest.fn(), onNext);

      fireEvent.click(screen.getByRole('button', { name: 'Previous Short' }));
      fireEvent.click(screen.getByRole('button', { name: 'Next Short' }));

      expect(onPrevious).toHaveBeenCalledTimes(1);
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('renders the Short on a navy stage', () => {
      const { container } = renderPhone();

      expect(container.firstChild).toHaveClass('bg-navy');
    });

    it('shows runtime and position once each, on the meta line, with no swipe hint', () => {
      renderPhone();

      const meta = screen.getByText('Test Channel').closest('p');
      expect(meta?.textContent).toBe('Test Channel·0:30·3 of 5');
      expect(screen.getAllByText('0:30')).toHaveLength(1);
      expect(screen.getAllByText('3 of 5')).toHaveLength(1);
      expect(screen.queryByText(/swipe/i)).not.toBeInTheDocument();
    });

    it('omits the runtime segment when the Short has no duration', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: null }}
          activeIndex={2}
          shortsLength={5}
          remainingMs={60000}
          variant="phone"
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      const meta = screen.getByText('Test Channel').closest('p');
      expect(meta?.textContent).toBe('Test Channel·3 of 5');
    });

    it('shows the budget warning when the Short is longer than the time left', () => {
      render(
        <ShortsPlayerPanel
          activeShort={{ ...baseShort, durationSeconds: 120 }}
          activeIndex={2}
          shortsLength={5}
          remainingMs={60000}
          variant="phone"
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          onWatchedToggle={jest.fn()}
        />,
      );

      expect(
        screen.getByText(
          'This Short is longer than the time you have left today',
        ),
      ).toBeInTheDocument();
    });

    it('lays Previous, the watched toggle and Next out in one row with up and down chevrons', () => {
      renderPhone();

      const previous = screen.getByRole('button', { name: 'Previous Short' });
      const row = previous.parentElement as HTMLElement;
      expect(
        within(row)
          .getAllByRole('button')
          .map((b) => b.getAttribute('aria-label') ?? b.textContent),
      ).toEqual(['Previous Short', 'Mark watched', 'Next Short']);
      expect(within(previous).getByTestId('chevron-up')).toBeInTheDocument();
      expect(
        within(screen.getByRole('button', { name: 'Next Short' })).getByTestId(
          'chevron-down',
        ),
      ).toBeInTheDocument();
    });

    it('calls onWatchedToggle from the phone row', () => {
      const onWatchedToggle = jest.fn();
      renderPhone(jest.fn(), onWatchedToggle);

      fireEvent.click(screen.getByRole('button', { name: 'Mark watched' }));
      expect(onWatchedToggle).toHaveBeenCalledTimes(1);
    });
  });
});
