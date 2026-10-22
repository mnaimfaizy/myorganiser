/* eslint-disable import/first */

import '@testing-library/jest-dom';

jest.mock('@myorganiser/web-ui', () => ({
  cn: (...classes: Array<string | undefined>) =>
    classes.filter(Boolean).join(' '),
  Button: ({
    children,
    asChild,
    ...props
  }: import('react').ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    size?: string;
    variant?: string;
    ref?: React.Ref<HTMLButtonElement>;
  }) => (asChild ? children : <button {...props}>{children}</button>),
}));

jest.mock('lucide-react', () => ({
  ExternalLink: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  Play: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  Trash2: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  ChevronUp: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  ChevronDown: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
}));

jest.mock('../hooks', () => ({
  updateVideoWatched: jest.fn(),
}));

let mockCapturedOnNearEnd: (() => Promise<void>) | undefined;

jest.mock('./YouTubeVideoPlayer', () => ({
  YouTubeVideoPlayer: ({
    video,
    onNearEnd,
  }: {
    video: { videoId: string; title: string };
    onNearEnd?: () => Promise<void>;
  }) => {
    mockCapturedOnNearEnd = onNearEnd;
    return (
      <div data-testid={`player-${video.videoId}`}>
        Video Player: {video.title}
      </div>
    );
  },
}));

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  renderHook,
  act,
  within,
} from '@testing-library/react';
import type { YouTubeVideo } from '../types';
import { useVideoQueue } from '../hooks/useVideoQueue';
import type { VideoQueue } from '../hooks/useVideoQueue';
import { updateVideoWatched } from '../hooks';
import { QueueRail } from './QueueRail';
import type { QueueRailSlots } from './QueueRail';

type SlotName = keyof QueueRailSlots;
const ALL_SLOTS: SlotName[] = ['player', 'rail', 'disclosure'];
const RAIL_ONLY: SlotName[] = ['rail'];

/**
 * Places the requested slots in a plain container, the way a page would.
 * Defaults to all three so the desktop rail and the mobile disclosure are
 * both in the DOM, as they are in production.
 */
function railUi(
  queue: VideoQueue,
  options: {
    onWatchedToggle?: (videoId: string, watched: boolean) => void;
    onPlaybackClaim?: () => void;
    slots?: SlotName[];
  } = {},
) {
  const { slots = ALL_SLOTS, ...props } = options;
  return (
    <QueueRail queue={queue} {...props}>
      {(placed) => (
        <>
          {slots.map((slot) => (
            <React.Fragment key={slot}>{placed[slot]}</React.Fragment>
          ))}
        </>
      )}
    </QueueRail>
  );
}

describe('QueueRail', () => {
  beforeEach(() => {
    mockCapturedOnNearEnd = undefined;
    jest.clearAllMocks();
  });

  const baseVideo = (id: string, watched = false): YouTubeVideo => ({
    id: `vid-${id}`,
    videoId: id,
    channelId: 'ch-1',
    title: `Test Video ${id}`,
    thumbnail: null,
    publishedAt: '2025-12-01T00:00:00Z',
    channelTitle: 'Test Channel',
    watched,
  });

  describe('empty state', () => {
    it('should render empty message when queue is empty', () => {
      const library: YouTubeVideo[] = [];
      const { result } = renderHook(() => useVideoQueue(library));
      render(railUi(result.current));
      expect(screen.getAllByText('Your queue is empty.')).toHaveLength(2); // Desktop and mobile
      expect(
        screen.getAllByText(
          'Add a Cached Upload from a channel row to line up what you want to watch.',
        ),
      ).toHaveLength(2); // Desktop and mobile
    });

    it('should not render Clear button when queue is empty', () => {
      const library: YouTubeVideo[] = [];
      const { result } = renderHook(() => useVideoQueue(library));
      render(railUi(result.current));
      expect(
        screen.queryByRole('button', { name: 'Clear queue' }),
      ).not.toBeInTheDocument();
    });

    it('should not render aria-current when empty', () => {
      const library: YouTubeVideo[] = [];
      const { result } = renderHook(() => useVideoQueue(library));
      const { container } = render(railUi(result.current));
      expect(
        container.querySelector('li[aria-current]'),
      ).not.toBeInTheDocument();
    });

    it('should not render the Now playing region when nothing is playing', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
      });
      rerender(railUi(result.current));

      expect(
        screen.queryByRole('region', { name: 'Now playing' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('summary and state', () => {
    it('should show "N of 4" summary in the rail header', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      const rail = screen.getByRole('complementary', { name: 'Queue' });
      expect(within(rail).getByText('2 of 4')).toBeInTheDocument();
    });

    it('should show "N of 4" summary in the mobile disclosure', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(
        railUi(result.current, { slots: ['disclosure'] }),
      );

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current, { slots: ['disclosure'] }));

      expect(screen.getByText('Queue · 2 of 4')).toBeInTheDocument();
    });

    it('should render the status live regions as polite and atomic', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
      });
      rerender(railUi(result.current));

      const liveRegions = screen.getAllByRole('status');
      // Should have multiple live regions (desktop and mobile)
      liveRegions.forEach((region) => {
        expect(region).toHaveAttribute('aria-live', 'polite');
        expect(region).toHaveAttribute('aria-atomic', 'true');
      });
    });

    it('should announce queue count in aria-live region', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      const liveRegions = screen.getAllByRole('status');
      liveRegions.forEach((region) => {
        expect(region).toHaveTextContent('2 Cached Uploads queued');
      });
    });

    it('should announce the singular and zero-count copy in the live region', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      expect(screen.getByRole('status').textContent).toBe(
        '0 Cached Uploads queued',
      );

      act(() => {
        result.current.add('1');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      expect(screen.getByRole('status').textContent).toBe(
        '1 Cached Upload queued',
      );
    });
    it('should show queue full message when at cap', () => {
      const library = Array.from({ length: 4 }, (_, i) =>
        baseVideo(String(i + 1)),
      );
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        for (let i = 1; i <= 4; i++) {
          result.current.add(String(i));
        }
      });
      rerender(railUi(result.current));

      expect(
        screen.getAllByText('Queue is full — 4 is the point.'),
      ).toHaveLength(2); // Desktop and mobile
    });

    it('should show "~N min" when every queued item has a known duration', () => {
      const videosWithDuration = [
        { ...baseVideo('1'), durationSeconds: 300 }, // 5 minutes
        { ...baseVideo('2'), durationSeconds: 420 }, // 7 minutes
        { ...baseVideo('3'), durationSeconds: 600 }, // 10 minutes
      ];
      const { result } = renderHook(() => useVideoQueue(videosWithDuration));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      // Total: 300 + 420 + 600 = 1320 seconds = 22 minutes
      const rail = screen.getByRole('complementary', { name: 'Queue' });
      expect(within(rail).getByText('3 of 4 · ~22 min')).toBeInTheDocument();
    });

    it('should show "~N min" in the mobile disclosure summary when durations are known', () => {
      const videosWithDuration = [
        { ...baseVideo('1'), durationSeconds: 300 },
        { ...baseVideo('2'), durationSeconds: 420 },
      ];
      const { result } = renderHook(() => useVideoQueue(videosWithDuration));
      const { rerender, container } = render(
        railUi(result.current, { slots: ['disclosure'] }),
      );

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current, { slots: ['disclosure'] }));

      // 300 + 420 = 720 seconds = 12 minutes
      const summary = container.querySelector('summary');
      expect(summary).toHaveTextContent('Queue · 2 of 4');
      expect(summary).toHaveTextContent('~12 min');
    });

    it('should omit "~N min" when any queued item lacks duration', () => {
      // Mix of videos: one has duration, one doesn't
      const mixedVideos = [
        { ...baseVideo('1'), durationSeconds: 300 }, // Has duration
        { ...baseVideo('2'), durationSeconds: undefined }, // No duration
        { ...baseVideo('3'), durationSeconds: 600 }, // Has duration
      ];
      const { result } = renderHook(() => useVideoQueue(mixedVideos));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      // When any item lacks duration, the minutes suffix is dropped entirely
      const rail = screen.getByRole('complementary', { name: 'Queue' });
      expect(within(rail).getByText('3 of 4')).toBeInTheDocument();
      expect(within(rail).queryByText(/min/)).not.toBeInTheDocument();
    });

    it('should omit "~N min" from the disclosure summary when any queued item lacks duration', () => {
      const library = [
        { ...baseVideo('1'), durationSeconds: 300 },
        baseVideo('2'),
      ];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender, container } = render(
        railUi(result.current, { slots: ['disclosure'] }),
      );

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current, { slots: ['disclosure'] }));

      const summary = container.querySelector('summary');
      expect(summary).toHaveTextContent('Queue · 2 of 4');
      expect(summary).not.toHaveTextContent('min');
    });
    it('should floor remaining time at 1 minute', () => {
      const videosShortDuration = [
        { ...baseVideo('1'), durationSeconds: 10 }, // 10 seconds, rounds to 0, should floor to 1
      ];
      const { result } = renderHook(() => useVideoQueue(videosShortDuration));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      const rail = screen.getByRole('complementary', { name: 'Queue' });
      expect(within(rail).getByText('1 of 4 · ~1 min')).toBeInTheDocument();
      expect(within(rail).queryByText(/~0 min/)).not.toBeInTheDocument();
    });

    it('should count the runtime from the playing item onward', () => {
      const library = [
        { ...baseVideo('1'), durationSeconds: 300 },
        { ...baseVideo('2'), durationSeconds: 420 },
        { ...baseVideo('3'), durationSeconds: 600 },
      ];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
        result.current.playId('2');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      // Playing item 2 of 3: 420 + 600 = 1020 seconds = 17 minutes
      const rail = screen.getByRole('complementary', { name: 'Queue' });
      expect(within(rail).getByText('3 of 4 · ~17 min')).toBeInTheDocument();
    });
  });

  describe('queue items rendering', () => {
    it('should render all queued videos', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      // Each video is rendered in both desktop and mobile queue rails
      expect(screen.getAllByText('Test Video 1').length).toBeGreaterThanOrEqual(
        1,
      );
      expect(screen.getAllByText('Test Video 2').length).toBeGreaterThanOrEqual(
        1,
      );
    });

    it('should render Play button for each item with correct aria-label', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      expect(
        screen.getAllByRole('button', { name: 'Play Test Video 1' }).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.getAllByRole('button', { name: 'Play Test Video 2' }).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('should render Remove button for each item with correct aria-label', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      expect(
        screen.getAllByRole('button', {
          name: 'Remove Test Video 1 from queue',
        }).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.getAllByRole('button', {
          name: 'Remove Test Video 2 from queue',
        }).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('should render Move up/down buttons with correct aria-labels', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      for (const id of ['1', '2']) {
        expect(
          screen.getAllByRole('button', { name: `Move Test Video ${id} up` }),
        ).not.toHaveLength(0);
        expect(
          screen.getAllByRole('button', { name: `Move Test Video ${id} down` }),
        ).not.toHaveLength(0);
      }
    });

    it('should label queued rows Watched or New when nothing is playing', () => {
      const library = [baseVideo('1', true), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      const rowOne = screen
        .getByRole('button', { name: 'Play Test Video 1' })
        .closest('li') as HTMLElement;
      const rowTwo = screen
        .getByRole('button', { name: 'Play Test Video 2' })
        .closest('li') as HTMLElement;
      expect(within(rowOne).getByText('Watched')).toBeInTheDocument();
      expect(within(rowTwo).getByText('New')).toBeInTheDocument();
    });
  });

  describe('queue operations', () => {
    it('should start playback of the upload whose Play button is clicked', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      act(() => {
        const playBtn = screen.getAllByRole('button', {
          name: 'Play Test Video 2',
        })[0];
        fireEvent.click(playBtn);
      });
      rerender(railUi(result.current));

      expect(result.current.activeId).toBe('2');
      expect(screen.getByTestId('player-2')).toBeInTheDocument();
    });
    it('should remove the upload when its Remove button is clicked', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      act(() => {
        const removeBtn = screen.getAllByRole('button', {
          name: 'Remove Test Video 1 from queue',
        })[0];
        fireEvent.click(removeBtn);
      });
      rerender(railUi(result.current));

      expect(
        screen.queryAllByRole('button', { name: 'Play Test Video 1' }),
      ).toHaveLength(0);
      expect(
        screen.getAllByRole('button', { name: 'Play Test Video 2' }).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('should call queue.moveUp when Move up button clicked', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current));

      // Verify the initial order
      expect(result.current.ids).toEqual(['1', '2', '3']);

      act(() => {
        const moveUpBtn = screen.getAllByRole('button', {
          name: 'Move Test Video 2 up',
        })[0];
        fireEvent.click(moveUpBtn);
      });
      rerender(railUi(result.current));

      // After moving up, video 2 should come before video 1
      expect(result.current.ids).toEqual(['2', '1', '3']);
    });

    it('should call queue.moveDown when Move down button clicked', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current));

      // Verify the initial order
      expect(result.current.ids).toEqual(['1', '2', '3']);

      act(() => {
        const moveDownBtn = screen.getAllByRole('button', {
          name: 'Move Test Video 2 down',
        })[0];
        fireEvent.click(moveDownBtn);
      });
      rerender(railUi(result.current));

      // After moving down, video 2 should come after video 3
      expect(result.current.ids).toEqual(['1', '3', '2']);
    });

    it('should disable Move up button on first row', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      const moveUpButtons = screen.getAllByRole('button', {
        name: 'Move Test Video 1 up',
      });
      expect(moveUpButtons[0]).toBeDisabled();
    });

    it('should disable Move down button on last row', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      const moveDownButtons = screen.getAllByRole('button', {
        name: 'Move Test Video 2 down',
      });
      expect(moveDownButtons[0]).toBeDisabled();
    });

    it('should render Clear button when items exist', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
      });
      rerender(railUi(result.current));

      expect(
        screen.getAllByRole('button', { name: 'Clear queue' }).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('should empty the queue when Clear queue is clicked', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      act(() => {
        const clearBtn = screen.getAllByRole('button', {
          name: 'Clear queue',
        })[0];
        fireEvent.click(clearBtn);
      });
      rerender(railUi(result.current));

      expect(screen.getAllByText('Your queue is empty.')).toHaveLength(2);
    });
  });

  describe('active item display', () => {
    it('should mark current item with aria-current="true"', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { container, rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      // Note: QueueRail renders both desktop and mobile versions, so aria-current appears on one li element
      const items = container.querySelectorAll('li[aria-current="true"]');
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]).toHaveTextContent('Test Video 1');
    });

    it('should show "Now playing" text for current item', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      // Should show "Now playing" text (rendered in both queue rail instances for mobile and desktop)
      expect(screen.getAllByText('Now playing').length).toBeGreaterThanOrEqual(
        1,
      );
    });

    it('should display player for current video', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      expect(screen.getByTestId('player-1')).toBeInTheDocument();
    });

    it('should update player when active changes', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.playId('1');
      });
      rerender(railUi(result.current));
      expect(screen.getByTestId('player-1')).toBeInTheDocument();

      act(() => {
        result.current.playId('2');
      });
      rerender(railUi(result.current));
      expect(screen.getByTestId('player-2')).toBeInTheDocument();
      expect(screen.queryByTestId('player-1')).not.toBeInTheDocument();
    });

    it('should label the player card as the Now playing region with the title as its heading', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      const region = screen.getByRole('region', { name: 'Now playing' });
      expect(
        within(region).getByRole('heading', {
          level: 3,
          name: 'Test Video 1',
        }),
      ).toBeInTheDocument();
    });

    it('should link Open on YouTube to the watch page in a new tab', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      const link = screen.getByRole('link', { name: 'Open on YouTube' });
      expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=1');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should show the channel, relative publish time, and runtime in the Now playing meta line', () => {
      const publishedThreeHoursAgo = new Date(
        Date.now() - 3 * 60 * 60 * 1000,
      ).toISOString();
      const library = [
        {
          ...baseVideo('1'),
          publishedAt: publishedThreeHoursAgo,
          durationSeconds: 125,
        },
      ];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      const region = screen.getByRole('region', { name: 'Now playing' });
      const expectedAgo = new Intl.RelativeTimeFormat(undefined, {
        numeric: 'auto',
      }).format(-3, 'hour');
      expect(region).toHaveTextContent(`Test Channel · ${expectedAgo} · 2:05`);
    });

    it('should omit the Now playing meta line when channel, publish time, and runtime are all missing', () => {
      const library = [
        {
          ...baseVideo('1'),
          channelTitle: undefined,
          publishedAt: 'not-a-date',
          durationSeconds: undefined,
        },
      ];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      const region = screen.getByRole('region', { name: 'Now playing' });
      expect(region.querySelector('p')).toBeNull();
    });
    it('should disable Mark watched & next when the playing upload is already Watched', () => {
      const library = [baseVideo('1', true)];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      expect(
        screen.getByRole('button', { name: 'Mark watched & next' }),
      ).toBeDisabled();
    });

    it('should not start a Watched update from the near-end callback for an already Watched upload', async () => {
      const mockUpdate = updateVideoWatched as jest.Mock;
      const library = [baseVideo('1', true)];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      await act(async () => {
        await mockCapturedOnNearEnd?.();
      });

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('focus management', () => {
    it('should move focus to now-playing title when focusSignal increases', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { container, rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
      });
      rerender(railUi(result.current));

      // Before playId, title is not rendered
      let titleElement = container.querySelector('h3[tabindex="-1"]');
      expect(titleElement).toBeNull();

      // Call playId which sets current and bumps focusSignal
      act(() => {
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      // Now the title is rendered
      titleElement = container.querySelector(
        'h3[tabindex="-1"]',
      ) as HTMLHeadingElement;
      expect(titleElement).toBeInTheDocument();
      expect(titleElement?.textContent).toBe('Test Video 1');

      // Focus should move to the title when focusSignal changed
      expect(document.activeElement).toBe(titleElement);
    });

    it('should not move focus on initial render even when current is set', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));

      // Set up queue with current video BEFORE rendering
      act(() => {
        result.current.add('1');
        result.current.playId('1');
      });

      // Now render the component for the first time with an already-playing queue
      const { container } = render(railUi(result.current));

      const titleElement = container.querySelector(
        'h3[tabindex="-1"]',
      ) as HTMLHeadingElement;
      expect(titleElement).toBeInTheDocument();
      expect(titleElement?.textContent).toBe('Test Video 1');

      // The ref was initialized to the current focusSignal value, so the effect
      // guard prevents focus movement on initial render
      expect(document.activeElement).not.toBe(titleElement);
      expect(document.activeElement).toBe(document.body);
    });

    it('should not move focus on re-render with unchanged focusSignal', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { container, rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
      });
      rerender(railUi(result.current));

      // Trigger initial focus move
      act(() => {
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      const titleElement = container.querySelector(
        'h3[tabindex="-1"]',
      ) as HTMLHeadingElement;
      expect(titleElement).toBeInTheDocument();
      expect(document.activeElement).toBe(titleElement);

      // Move focus away
      const tempButton = document.createElement('button');
      document.body.appendChild(tempButton);
      act(() => {
        tempButton.focus();
      });
      expect(document.activeElement).toBe(tempButton);

      // Simulate background sync: add another video without changing focusSignal
      act(() => {
        result.current.add('2');
      });
      rerender(railUi(result.current));

      // Focus should remain on temp button, not pulled back
      expect(document.activeElement).toBe(tempButton);
      expect(document.activeElement).not.toBe(titleElement);

      document.body.removeChild(tempButton);
    });

    it('should not move focus when a background sync replaces the library', () => {
      // This test ensures the focusSignal guard prevents focus theft during sync.
      // A real background sync replaces the library array with new objects
      // (same videoIds, different object identities), which causes libraryById
      // to recompute and queue.current to become a new object. The focus effect's
      // dependency on queue.current triggers, but the focusSignal guard blocks focus.

      const initialLibrary = [baseVideo('1'), baseVideo('2')];

      const { result, rerender: rerenderHook } = renderHook(
        ({ lib }) => useVideoQueue(lib),
        { initialProps: { lib: initialLibrary } },
      );

      const { container, rerender: rerenderComponent } = render(
        railUi(result.current),
      );

      // Add video and play it
      act(() => {
        result.current.add('1');
        result.current.playId('1');
      });
      rerenderComponent(railUi(result.current));

      // Verify current is set and focused on the title
      const titleElement = container.querySelector(
        'h3[tabindex="-1"]',
      ) as HTMLHeadingElement;
      expect(titleElement).toBeInTheDocument();
      expect(titleElement?.textContent).toBe('Test Video 1');
      expect(document.activeElement).toBe(titleElement);

      // Save the current video object reference for later comparison
      const originalCurrentVideoObject = result.current.current;
      expect(originalCurrentVideoObject).not.toBeNull();
      expect(originalCurrentVideoObject?.videoId).toBe('1');

      // Verify focusSignal was bumped by playId
      const focusSignalBeforeSync = result.current.focusSignal;
      expect(focusSignalBeforeSync).toBe(1);

      // Move focus away to simulate user interaction elsewhere
      const tempButton = document.createElement('button');
      document.body.appendChild(tempButton);
      act(() => {
        tempButton.focus();
      });
      expect(document.activeElement).toBe(tempButton);

      // Simulate a background sync: replace the library with a new array
      // containing new video objects (same IDs, different identities).
      // This is what happens when YouTubePageClient's channels array updates.
      const syncedLibrary = [baseVideo('1'), baseVideo('2')]; // New objects
      act(() => {
        rerenderHook({ lib: syncedLibrary });
      });

      rerenderComponent(railUi(result.current));

      // After sync, verify the library was replaced:
      const currentAfterSync = result.current.current;
      expect(currentAfterSync).not.toBeNull();
      expect(currentAfterSync?.videoId).toBe('1');

      // The video object should be different (new object identity from new libraryById)
      expect(currentAfterSync).not.toBe(originalCurrentVideoObject);

      // focusSignal should be unchanged (sync doesn't bump it, only playId does)
      expect(result.current.focusSignal).toBe(focusSignalBeforeSync);

      // The critical assertion: focus was NOT stolen to the title.
      // Without the focusSignal guard, the effect would re-run (because queue.current
      // changed) and would focus the title. With the guard, it stays on temp button.
      expect(document.activeElement).toBe(tempButton);
      expect(document.activeElement).not.toBe(titleElement);

      document.body.removeChild(tempButton);
    });

    it('should not move focus when reordering', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { container, rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      const titleElement = container.querySelector(
        'h3[tabindex="-1"]',
      ) as HTMLHeadingElement;
      expect(document.activeElement).toBe(titleElement);

      // Move focus away
      const tempButton = document.createElement('button');
      document.body.appendChild(tempButton);
      act(() => {
        tempButton.focus();
      });

      // Reorder (focusSignal doesn't change)
      act(() => {
        result.current.moveUp('2');
      });
      rerender(railUi(result.current));

      // Focus should stay on temp button
      expect(document.activeElement).toBe(tempButton);

      document.body.removeChild(tempButton);
    });

    it('should move focus and roving tabindex to the next row on ArrowDown', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      const first = screen.getByRole('button', { name: 'Play Test Video 1' });
      const second = screen.getByRole('button', { name: 'Play Test Video 2' });

      act(() => {
        first.focus();
      });
      act(() => {
        fireEvent.keyDown(first, { key: 'ArrowDown' });
      });

      expect(document.activeElement).toBe(second);
      expect(second).toHaveAttribute('tabindex', '0');
      expect(first).toHaveAttribute('tabindex', '-1');
    });
    it('should move focus and roving tabindex to the previous row on ArrowUp', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      const first = screen.getByRole('button', { name: 'Play Test Video 1' });
      const second = screen.getByRole('button', { name: 'Play Test Video 2' });

      act(() => {
        second.focus();
      });
      act(() => {
        fireEvent.keyDown(second, { key: 'ArrowUp' });
      });

      expect(document.activeElement).toBe(first);
      expect(first).toHaveAttribute('tabindex', '0');
      expect(second).toHaveAttribute('tabindex', '-1');
    });
    it('should keep focus and tabindex on the first row when ArrowUp is pressed there', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      const first = screen.getByRole('button', { name: 'Play Test Video 1' });
      const second = screen.getByRole('button', { name: 'Play Test Video 2' });

      act(() => {
        first.focus();
      });
      act(() => {
        fireEvent.keyDown(first, { key: 'ArrowUp' });
      });

      expect(document.activeElement).toBe(first);
      expect(first).toHaveAttribute('tabindex', '0');
      expect(second).toHaveAttribute('tabindex', '-1');
    });
    it('should keep focus and tabindex on the last row when ArrowDown is pressed there', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      const third = screen.getByRole('button', { name: 'Play Test Video 3' });

      act(() => {
        third.focus();
      });
      act(() => {
        fireEvent.keyDown(third, { key: 'ArrowDown' });
      });

      expect(document.activeElement).toBe(third);
      expect(third).toHaveAttribute('tabindex', '0');
      expect(
        screen.getByRole('button', { name: 'Play Test Video 1' }),
      ).toHaveAttribute('tabindex', '-1');
    });
    it('should move focus and roving tabindex to the first row on Home key', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      const first = screen.getByRole('button', { name: 'Play Test Video 1' });
      const second = screen.getByRole('button', { name: 'Play Test Video 2' });
      const third = screen.getByRole('button', { name: 'Play Test Video 3' });

      act(() => {
        first.focus();
      });
      // Move off row 0 first so Home has something to return from.
      act(() => {
        fireEvent.keyDown(first, { key: 'ArrowDown' });
      });
      expect(document.activeElement).toBe(second);

      act(() => {
        fireEvent.keyDown(second, { key: 'Home' });
      });

      expect(document.activeElement).toBe(first);
      expect(first).toHaveAttribute('tabindex', '0');
      expect(second).toHaveAttribute('tabindex', '-1');
      expect(third).toHaveAttribute('tabindex', '-1');
    });
    it('should move focus and roving tabindex to the last row on End key', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      const first = screen.getByRole('button', { name: 'Play Test Video 1' });
      const second = screen.getByRole('button', { name: 'Play Test Video 2' });
      const third = screen.getByRole('button', { name: 'Play Test Video 3' });

      act(() => {
        first.focus();
      });
      act(() => {
        fireEvent.keyDown(first, { key: 'End' });
      });

      expect(document.activeElement).toBe(third);
      expect(third).toHaveAttribute('tabindex', '0');
      expect(first).toHaveAttribute('tabindex', '-1');
      expect(second).toHaveAttribute('tabindex', '-1');
    });
    it('moves focus within the phone disclosure, not to the desktop rail copy, on ArrowDown', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender, container } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      const disclosure = container.querySelector('details') as HTMLElement;
      const desktopRail = container.querySelector(
        'aside:not(details aside)',
      ) as HTMLElement;
      const phoneFirst = within(disclosure).getByRole('button', {
        name: 'Play Test Video 1',
      });
      const phoneSecond = within(disclosure).getByRole('button', {
        name: 'Play Test Video 2',
      });
      const desktopSecond = within(desktopRail).getByRole('button', {
        name: 'Play Test Video 2',
      });

      act(() => {
        phoneFirst.focus();
      });
      act(() => {
        fireEvent.keyDown(phoneFirst, { key: 'ArrowDown' });
      });

      expect(document.activeElement).toBe(phoneSecond);
      expect(document.activeElement).not.toBe(desktopSecond);
    });

    it('should move the roving tabindex to the new last row when the focused row is removed', () => {
      const library = [baseVideo('1'), baseVideo('2'), baseVideo('3')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { slots: RAIL_ONLY }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
        result.current.add('3');
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      const first = screen.getByRole('button', { name: 'Play Test Video 1' });

      act(() => {
        first.focus();
      });
      act(() => {
        fireEvent.keyDown(first, { key: 'End' });
      });
      act(() => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'Remove Test Video 3 from queue',
          }),
        );
      });
      rerender(railUi(result.current, { slots: RAIL_ONLY }));

      expect(
        screen.getByRole('button', { name: 'Play Test Video 2' }),
      ).toHaveAttribute('tabindex', '0');
    });
    it('should restore focus to previous Play button when Escape is pressed', async () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender, container } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current));

      // Get the Play button for the first video
      const playButtons = screen
        .getAllByRole('button')
        .filter((btn) => btn.getAttribute('aria-label')?.startsWith('Play'));
      const playButton1 = playButtons[0] as HTMLButtonElement;

      // Focus the Play button manually (simulating user clicking it)
      act(() => {
        playButton1.focus();
      });
      expect(document.activeElement).toBe(playButton1);

      // Play the video (this moves focus to the now-playing title)
      act(() => {
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      // Find the title element and verify focus moved to it
      const titleElement = container.querySelector(
        'h3[tabindex="-1"]',
      ) as HTMLHeadingElement;
      expect(titleElement).toBeInTheDocument();
      expect(document.activeElement).toBe(titleElement);

      // Press Escape on the title element
      fireEvent.keyDown(titleElement, { key: 'Escape' });

      // Focus should be restored to the original Play button
      expect(document.activeElement).toBe(playButton1);

      // Verify the player is still rendered (Escape doesn't remove it)
      expect(screen.getByTestId('player-1')).toBeInTheDocument();
    });
  });

  describe('completion workflow', () => {
    it('should advance to next and persist Watched when completion triggered', async () => {
      const mockUpdate = updateVideoWatched as jest.Mock;
      mockUpdate.mockResolvedValue({ watched: true });
      const onWatchedToggle = jest.fn();

      const library = [baseVideo('A', false), baseVideo('B', false)];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { onWatchedToggle }));

      act(() => {
        result.current.add('A');
        result.current.add('B');
        result.current.playId('A');
      });
      rerender(railUi(result.current, { onWatchedToggle }));

      expect(screen.getByTestId('player-A')).toBeInTheDocument();

      // Trigger near-end for video A
      await act(async () => {
        await mockCapturedOnNearEnd?.();
      });
      rerender(railUi(result.current, { onWatchedToggle }));

      expect(mockUpdate).toHaveBeenNthCalledWith(1, 'A', true);
      expect(screen.getByTestId('player-B')).toBeInTheDocument();
      expect(screen.queryByTestId('player-A')).not.toBeInTheDocument();
      expect(onWatchedToggle).toHaveBeenNthCalledWith(1, 'A', true);

      // Trigger near-end for video B
      await act(async () => {
        await mockCapturedOnNearEnd?.();
      });
      rerender(railUi(result.current, { onWatchedToggle }));

      expect(mockUpdate).toHaveBeenNthCalledWith(2, 'B', true);
      expect(onWatchedToggle).toHaveBeenNthCalledWith(2, 'B', true);
    });

    it('should advance queue and not report a Watched toggle when updateVideoWatched rejects', async () => {
      const mockUpdate = updateVideoWatched as jest.Mock;
      mockUpdate.mockRejectedValue(new Error('Update failed'));
      const onWatchedToggle = jest.fn();

      const library = [baseVideo('A', false), baseVideo('B', false)];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { onWatchedToggle }));

      act(() => {
        result.current.add('A');
        result.current.add('B');
        result.current.playId('A');
      });
      rerender(railUi(result.current, { onWatchedToggle }));

      expect(screen.getByTestId('player-A')).toBeInTheDocument();

      // Trigger near-end (will fail to update)
      await act(async () => {
        await mockCapturedOnNearEnd?.();
      });
      rerender(railUi(result.current, { onWatchedToggle }));

      expect(mockUpdate).toHaveBeenCalledWith('A', true);
      // Queue should still advance despite the error
      expect(screen.getByTestId('player-B')).toBeInTheDocument();
      expect(screen.queryByTestId('player-A')).not.toBeInTheDocument();
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(onWatchedToggle).not.toHaveBeenCalled();
    });
    it('should render Mark watched & next button', () => {
      const library = [baseVideo('1', false)];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
        result.current.playId('1');
      });
      rerender(railUi(result.current));

      expect(
        screen.getByRole('button', { name: 'Mark watched & next' }),
      ).toBeInTheDocument();
    });

    it('should persist Watched and advance when Mark watched & next is clicked', async () => {
      const mockUpdate = updateVideoWatched as jest.Mock;
      mockUpdate.mockResolvedValue({ watched: true });

      const library = [baseVideo('A', false), baseVideo('B', false)];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('A');
        result.current.add('B');
        result.current.playId('A');
      });
      rerender(railUi(result.current));

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Mark watched & next' }),
        );
        // Let the awaited update and the queue advance settle before asserting.
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      rerender(railUi(result.current));

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledWith('A', true);
      expect(screen.getByTestId('player-B')).toBeInTheDocument();
      expect(screen.queryByTestId('player-A')).not.toBeInTheDocument();
    });

    it('should ignore a second completion while the first Watched update is in flight', async () => {
      const mockUpdate = updateVideoWatched as jest.Mock;
      const pendingResolvers: Array<(value: { watched: boolean }) => void> = [];
      mockUpdate.mockImplementation(
        () =>
          new Promise<{ watched: boolean }>((resolve) => {
            pendingResolvers.push(resolve);
          }),
      );

      const library = [baseVideo('A', false), baseVideo('B', false)];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('A');
        result.current.add('B');
        result.current.playId('A');
      });
      rerender(railUi(result.current));

      act(() => {
        void mockCapturedOnNearEnd?.();
      });
      rerender(railUi(result.current));
      await act(async () => {
        await mockCapturedOnNearEnd?.();
      });

      expect(mockUpdate).toHaveBeenCalledTimes(1);

      await act(async () => {
        pendingResolvers.forEach((resolve) => resolve({ watched: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      rerender(railUi(result.current));

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('player-B')).toBeInTheDocument();
    });
  });

  describe('responsive layout', () => {
    it('should render mobile disclosure summary with queue count', () => {
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { container, rerender } = render(
        railUi(result.current, { slots: ['disclosure'] }),
      );

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current, { slots: ['disclosure'] }));

      const summary = container.querySelector('summary');
      expect(summary).toBeInTheDocument();
      expect(summary?.textContent).toContain('Queue · 2 of 4');
    });
  });

  describe('single active player arbitration', () => {
    it('should claim playback when a queued upload is played', () => {
      const onPlaybackClaim = jest.fn();
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { onPlaybackClaim }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current, { onPlaybackClaim }));

      act(() => {
        fireEvent.click(
          screen.getAllByRole('button', { name: 'Play Test Video 2' })[0],
        );
      });
      rerender(railUi(result.current, { onPlaybackClaim }));

      expect(onPlaybackClaim).toHaveBeenCalledTimes(1);
      // The claim does not replace the play — the rail still starts the video.
      expect(screen.getByTestId('player-2')).toBeInTheDocument();
    });

    it('should not claim playback for a move-down edit', () => {
      const onPlaybackClaim = jest.fn();
      const library = [baseVideo('1'), baseVideo('2')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current, { onPlaybackClaim }));

      act(() => {
        result.current.add('1');
        result.current.add('2');
      });
      rerender(railUi(result.current, { onPlaybackClaim }));

      const moveDown = screen.getAllByRole('button', {
        name: 'Move Test Video 1 down',
      })[0];

      act(() => {
        fireEvent.click(moveDown);
      });

      expect(onPlaybackClaim).not.toHaveBeenCalled();
    });
    it('should play normally when no claim handler is supplied', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { rerender } = render(railUi(result.current));

      act(() => {
        result.current.add('1');
      });
      rerender(railUi(result.current));

      act(() => {
        fireEvent.click(
          screen.getAllByRole('button', { name: 'Play Test Video 1' })[0],
        );
      });
      rerender(railUi(result.current));

      expect(screen.getByTestId('player-1')).toBeInTheDocument();
    });
  });

  describe('rail landmark labelling', () => {
    it('gives the desktop and mobile rails distinct heading ids', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { container } = render(railUi(result.current));

      const headings = Array.from(container.querySelectorAll('h2[id]')).map(
        (node) => node.id,
      );

      // Both copies are in the DOM at once — only CSS hides one — so a shared
      // id would be a duplicate that `aria-labelledby` resolves ambiguously.
      expect(headings).toHaveLength(2);
      expect(new Set(headings).size).toBe(2);
    });

    it('labels each rail landmark with its own heading', () => {
      const library = [baseVideo('1')];
      const { result } = renderHook(() => useVideoQueue(library));
      const { container } = render(railUi(result.current));

      const rails = Array.from(container.querySelectorAll('aside'));
      expect(rails).toHaveLength(2);

      rails.forEach((rail) => {
        const headingId = rail.getAttribute('aria-labelledby');
        expect(headingId).toBeTruthy();
        expect(rail.querySelector(`#${headingId}`)?.textContent).toBe('Queue');
      });
    });
  });
});
