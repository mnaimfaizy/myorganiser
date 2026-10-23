/* eslint-disable import/first */

import '@testing-library/jest-dom';

jest.mock('@myorganiser/web-ui', () => ({
  cn: (...classes: Array<string | undefined>) =>
    classes.filter(Boolean).join(' '),
  Button: ({
    children,
    ...props
  }: import('react').ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string;
    variant?: string;
  }) => <button {...props}>{children}</button>,
  Skeleton: ({ className }: { className?: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
  useIsMobileState: () => mockUseIsMobileState(),
}));

jest.mock('lucide-react', () => ({
  CheckCircle: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  Circle: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  ExternalLink: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  ListPlus: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  X: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  Play: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  Check: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
  Plus: ({ className }: { className?: string }) => (
    <span className={className} aria-hidden="true" />
  ),
}));

jest.mock('../hooks', () => ({
  updateVideoWatched: jest.fn(),
}));

const mockUseIsMobileState = jest.fn();

let capturedPlayerOnNearEnd: (() => void) | undefined;
jest.mock('./YouTubeVideoPlayer', () => ({
  YouTubeVideoPlayer: ({
    video,
    onNearEnd,
  }: {
    video: { videoId: string; title: string };
    onNearEnd?: () => void;
  }) => {
    capturedPlayerOnNearEnd = onNearEnd;
    return (
      <div data-testid={`player-${video.videoId}`}>
        Video Player: {video.title}
      </div>
    );
  },
}));

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ChannelCarousel, YouTubeVideo } from '../types';
import { updateVideoWatched } from '../hooks';
import { CHANNEL_LIST_UPLOAD_CAP, ChannelDirectory } from './ChannelDirectory';

const makeVideo = (
  id: string,
  title: string,
  watched = false,
): YouTubeVideo => ({
  id: `vid-${id}`,
  videoId: `vid-${id}`,
  channelId: 'ch-1',
  title,
  thumbnail: null,
  publishedAt: '2025-01-01T00:00:00Z',
  channelTitle: 'Test Channel',
  watched,
});

const makeChannel = (
  id: string,
  title: string,
  videos: YouTubeVideo[] = [],
): ChannelCarousel => ({
  channelId: id,
  channelTitle: title,
  channelThumbnail: null,
  videos,
});

/** The one horizontal channel tab set. */
const getChannelTabs = () =>
  within(
    screen.getByRole('tablist', { name: 'Enabled channels' }),
  ).getAllByRole('tab');

/** Each upload row is the element carrying the tabindex above its title. */
const getUploadRows = () =>
  screen
    .getAllByRole('heading', { level: 4 })
    .map((heading) => heading.closest('[tabindex]') as HTMLElement);

/** The heading naming the Selected channel inside the detail pane. */
const getPaneHeadingText = () =>
  screen.getByRole('heading', { level: 2 }).textContent;

describe('ChannelDirectory', () => {
  beforeEach(() => {
    capturedPlayerOnNearEnd = undefined;
    jest.clearAllMocks();
    mockUseIsMobileState.mockReturnValue(false);
  });

  describe('Error state', () => {
    it('shows role="alert" with error text when error prop is set', () => {
      const onRetry = jest.fn();
      render(
        <ChannelDirectory
          channels={[]}
          loading={false}
          error="Failed to load channels"
          onRetry={onRetry}
        />,
      );

      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('Failed to load channels');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
    });

    it('does not show Retry button when error is set but onRetry is not provided', () => {
      render(
        <ChannelDirectory
          channels={[]}
          loading={false}
          error="Failed to load channels"
        />,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument();
    });

    it('calls onRetry when Retry button is clicked', () => {
      const onRetry = jest.fn();
      render(
        <ChannelDirectory
          channels={[]}
          loading={false}
          error="Failed to load channels"
          onRetry={onRetry}
        />,
      );

      const retryButton = screen.getByRole('button', { name: 'Retry' });
      fireEvent.click(retryButton);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows error alert even when loading is true', () => {
      render(
        <ChannelDirectory
          channels={[]}
          loading={true}
          error="Failed to load channels"
        />,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Failed to load channels')).toBeInTheDocument();
      expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('shows skeleton placeholders with status role when loading is true and channels is empty', () => {
      const { container } = render(
        <ChannelDirectory channels={[]} loading={true} error={null} />,
      );

      const statusRegion = container.querySelector('[role="status"]');
      expect(statusRegion).toBeInTheDocument();
      expect(statusRegion).toHaveAttribute('aria-live', 'polite');

      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('Empty state', () => {
    it('shows the "No Enabled Channels yet" copy with a link to Channels when channels is empty and not loading', () => {
      render(<ChannelDirectory channels={[]} loading={false} error={null} />);

      expect(
        screen.getByText(/No Enabled Channels yet\. Turn on a channel in/),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Channels' })).toHaveAttribute(
        'href',
        '/dashboard/youtube/channels',
      );
    });
  });

  describe('Channel list rendering and default selection', () => {
    it('selects the first channel by default and names the detail pane after it', () => {
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [
        makeChannel('ch-1', 'Channel 1', videos),
        makeChannel('ch-2', 'Channel 2', videos),
      ];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      expect(screen.getByRole('tabpanel')).toHaveAttribute(
        'aria-label',
        'Channel 1',
      );
      expect(getPaneHeadingText()).toBe('Channel 1');
    });

    it('marks the selected channel tab with aria-selected="true" and the others "false"', () => {
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [
        makeChannel('ch-1', 'Channel 1', videos),
        makeChannel('ch-2', 'Channel 2', videos),
      ];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const [first, second] = getChannelTabs();
      expect(first).toHaveAttribute('aria-selected', 'true');
      expect(second).toHaveAttribute('aria-selected', 'false');
    });

    it('shows the unwatched count on the chip and states it in the accessible name', () => {
      const videos = [
        makeVideo('1', 'Video 1', false),
        makeVideo('2', 'Video 2', false),
        makeVideo('3', 'Video 3', true),
      ];
      const channels = [
        makeChannel('ch-1', 'Channel 1', videos),
        makeChannel('ch-2', 'Channel 2', [makeVideo('4', 'Video 4', true)]),
      ];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const [withNew, allWatched] = getChannelTabs();
      expect(withNew).toHaveAccessibleName('Channel 1, 2 new');
      expect(withNew).toHaveTextContent('Channel 1');
      expect(withNew).toHaveTextContent('· 2');
      expect(allWatched).toHaveAccessibleName('Channel 2');
      expect(allWatched).not.toHaveTextContent('·');
    });
  });

  describe('Channel tab set (horizontal model)', () => {
    const channels = [
      makeChannel('ch-1', 'Channel 1', [makeVideo('1', 'Video 1')]),
      makeChannel('ch-2', 'Channel 2', [makeVideo('2', 'Video 2')]),
      makeChannel('ch-3', 'Channel 3', [makeVideo('3', 'Video 3')]),
    ];

    it('moves focus and selection to the next channel tab on ArrowRight', () => {
      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const tabs = getChannelTabs();
      expect(tabs).toHaveLength(3);

      tabs[0].focus();
      fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });

      expect(tabs[1]).toHaveFocus();
      expect(screen.getByRole('tabpanel')).toHaveAttribute(
        'aria-label',
        'Channel 2',
      );
      expect(getPaneHeadingText()).toBe('Channel 2');
    });

    it('moves focus and selection to the previous channel tab on ArrowLeft', () => {
      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const tabs = getChannelTabs();
      tabs[1].focus();
      fireEvent.keyDown(tabs[1], { key: 'ArrowLeft' });

      expect(tabs[0]).toHaveFocus();
      expect(getPaneHeadingText()).toBe('Channel 1');
    });

    it('Home/End on a channel tab jumps to the first/last channel', () => {
      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const tabs = getChannelTabs();
      tabs[1].focus();
      fireEvent.keyDown(tabs[1], { key: 'Home' });
      expect(tabs[0]).toHaveFocus();
      expect(getPaneHeadingText()).toBe('Channel 1');

      fireEvent.keyDown(tabs[0], { key: 'End' });
      expect(tabs[2]).toHaveFocus();
      expect(getPaneHeadingText()).toBe('Channel 3');
    });

    it('ignores the vertical axis, leaving the channel selection and page scroll alone', () => {
      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const tabs = getChannelTabs();
      tabs[0].focus();

      const downEvent = fireEvent.keyDown(tabs[0], { key: 'ArrowDown' });
      expect(tabs[0]).toHaveFocus();
      // Not handled here, so the browser keeps its default scroll behaviour.
      expect(downEvent).toBe(true);

      fireEvent.keyDown(tabs[0], { key: 'ArrowUp' });
      expect(tabs[0]).toHaveFocus();
      expect(getPaneHeadingText()).toBe('Channel 1');
    });

    it('stops at the ends rather than wrapping', () => {
      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const tabs = getChannelTabs();
      tabs[0].focus();
      fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
      expect(tabs[0]).toHaveFocus();
      expect(getPaneHeadingText()).toBe('Channel 1');

      tabs[2].focus();
      fireEvent.keyDown(tabs[2], { key: 'ArrowRight' });
      expect(tabs[2]).toHaveFocus();
      expect(getPaneHeadingText()).toBe('Channel 3');
    });
  });

  describe('Uploads list — empty and populated', () => {
    it('shows "No uploads for this channel" and YouTube link when channel has no videos', () => {
      const channels = [makeChannel('ch-1', 'Channel 1', [])];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      expect(
        screen.getByText('No uploads for this channel.'),
      ).toBeInTheDocument();

      const youtubeLink = screen.getByRole('link', {
        name: 'Open channel on YouTube',
      });
      expect(youtubeLink).toHaveAttribute(
        'href',
        'https://www.youtube.com/channel/ch-1',
      );
    });

    it('renders one row per video with a watch link and its NEW or WATCHED state', () => {
      const videos = [
        makeVideo('1', 'Video 1', false),
        makeVideo('2', 'Video 2', true),
      ];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      expect(getUploadRows()).toHaveLength(2);

      const videoLinks = screen.getAllByRole('link');
      const watchLinks = videoLinks.filter(
        (link) =>
          link.getAttribute('href')?.includes('youtube.com/watch?v=') || false,
      );
      expect(watchLinks.length).toBe(2);

      expect(screen.getByText('New')).toBeInTheDocument(); // Video 1 is unwatched
      expect(screen.getByText('Watched')).toBeInTheDocument(); // Video 2 is watched
    });

    it('renders end-of-list disclosure after non-empty uploads list', () => {
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      expect(
        screen.getByText(/MyOrganiser stores only recent uploads/),
      ).toBeInTheDocument();

      const youtubeLinks = screen.getAllByRole('link', {
        name: 'Open channel on YouTube',
      });
      expect(youtubeLinks.length).toBe(1); // The one in the end-of-list section
    });
  });

  describe('Keyboard navigation — uploads list', () => {
    it('ArrowDown/ArrowUp on focused video row moves focus to next/previous row', () => {
      const videos = [
        makeVideo('1', 'Video 1'),
        makeVideo('2', 'Video 2'),
        makeVideo('3', 'Video 3'),
      ];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const rows = getUploadRows();
      expect(rows).toHaveLength(3);

      // Focus on first row
      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: 'ArrowDown' });

      // Second row should have focus
      expect(rows[1]).toHaveFocus();

      // ArrowUp should go back
      fireEvent.keyDown(rows[1], { key: 'ArrowUp' });
      expect(rows[0]).toHaveFocus();
    });

    it('Home/End on video row jumps to first/last', () => {
      const videos = [
        makeVideo('1', 'Video 1'),
        makeVideo('2', 'Video 2'),
        makeVideo('3', 'Video 3'),
      ];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const rows = getUploadRows();

      // Press Home from middle row
      rows[1].focus();
      fireEvent.keyDown(rows[1], { key: 'Home' });
      expect(rows[0]).toHaveFocus();

      // Press End
      fireEvent.keyDown(rows[0], { key: 'End' });
      expect(rows[2]).toHaveFocus();
    });
  });

  describe('In-app player (open/close/escape)', () => {
    it('opens the player in a section named for the channel when "Play in app" is clicked', () => {
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const playButton = screen.getByRole('button', {
        name: /Play Video 1 in app/,
      });
      fireEvent.click(playButton);

      expect(screen.getByTestId('player-vid-1')).toBeInTheDocument();
      expect(
        screen.getByRole('region', { name: 'Playing from Channel 1' }),
      ).toBeInTheDocument();
    });

    it('renders "Close player" button when player is open', () => {
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const playButton = screen.getByRole('button', {
        name: /Play Video 1 in app/,
      });
      fireEvent.click(playButton);

      const closeButton = screen.getByRole('button', {
        name: 'Close player',
      });
      expect(closeButton).toBeInTheDocument();
    });

    it('closes player and restores focus to "Play in app" button when "Close player" is clicked', () => {
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const playButton = screen.getByRole('button', {
        name: /Play Video 1 in app/,
      });
      fireEvent.click(playButton);

      expect(screen.getByTestId('player-vid-1')).toBeInTheDocument();

      const closeButton = screen.getByRole('button', {
        name: 'Close player',
      });
      fireEvent.click(closeButton);

      expect(screen.queryByTestId('player-vid-1')).not.toBeInTheDocument();
      expect(playButton).toHaveFocus();
    });

    it('marks an unwatched video watched and reports it when the player reports near end', async () => {
      const onWatchedToggle = jest.fn();
      const videos = [makeVideo('1', 'Video 1', false)];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      (updateVideoWatched as jest.Mock).mockResolvedValue({
        watched: true,
      });

      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          error={null}
          onWatchedToggle={onWatchedToggle}
        />,
      );

      const playButton = screen.getByRole('button', {
        name: /Play Video 1 in app/,
      });
      fireEvent.click(playButton);

      expect(capturedPlayerOnNearEnd).toBeDefined();

      // Simulate video near end
      if (capturedPlayerOnNearEnd) {
        capturedPlayerOnNearEnd();
      }

      await waitFor(() => {
        expect(updateVideoWatched).toHaveBeenCalledWith('vid-1', true);
      });

      await waitFor(() => {
        expect(onWatchedToggle).toHaveBeenCalledWith('vid-1', true);
      });
    });

    it('closes player and restores focus to "Play in app" when Escape is pressed on Close button', () => {
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const playButton = screen.getByRole('button', {
        name: /Play Video 1 in app/,
      });
      fireEvent.click(playButton);

      expect(screen.getByTestId('player-vid-1')).toBeInTheDocument();

      const closeButton = screen.getByRole('button', {
        name: 'Close player',
      });
      fireEvent.keyDown(closeButton, { key: 'Escape' });

      expect(screen.queryByTestId('player-vid-1')).not.toBeInTheDocument();
      expect(playButton).toHaveFocus();
    });

    it('closes player and restores focus when Escape is pressed on focused upload row', () => {
      const videos = [makeVideo('1', 'Video 1'), makeVideo('2', 'Video 2')];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const playButton = screen.getByRole('button', {
        name: /Play Video 1 in app/,
      });
      fireEvent.click(playButton);

      expect(screen.getByTestId('player-vid-1')).toBeInTheDocument();

      const rows = getUploadRows();
      expect(rows).toHaveLength(2);

      fireEvent.keyDown(rows[0], { key: 'Escape' });

      expect(screen.queryByTestId('player-vid-1')).not.toBeInTheDocument();
      expect(playButton).toHaveFocus();
    });
  });

  describe('Watched/unwatched toggle on upload row', () => {
    it('calls updateVideoWatched and onWatchedToggle when the NEW pill is clicked, then offers to mark it new', async () => {
      const onWatchedToggle = jest.fn();
      const videos = [makeVideo('1', 'Video 1', false)];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      (updateVideoWatched as jest.Mock).mockResolvedValue({
        watched: true,
      });

      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          error={null}
          onWatchedToggle={onWatchedToggle}
        />,
      );

      const watchButton = screen.getByRole('button', {
        name: /Mark Video 1 as watched/,
      });
      fireEvent.click(watchButton);

      await waitFor(() => {
        expect(updateVideoWatched).toHaveBeenCalledWith('vid-1', true);
      });

      await waitFor(() => {
        expect(onWatchedToggle).toHaveBeenCalledWith('vid-1', true);
      });

      // Button text should update
      expect(
        screen.getByRole('button', { name: /Mark Video 1 as new/ }),
      ).toBeInTheDocument();
    });

    it('reverts to previous watched state and shows error alert on updateVideoWatched rejection', async () => {
      const videos = [makeVideo('1', 'Video 1', false)];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      (updateVideoWatched as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      const watchButton = screen.getByRole('button', {
        name: /Mark Video 1 as watched/,
      });
      fireEvent.click(watchButton);

      // Wait for the error to appear
      await waitFor(() => {
        const alerts = screen.getAllByRole('alert');
        const errorAlert = alerts.find(
          (alert) => alert.textContent === 'Failed to update status',
        );
        expect(errorAlert).toBeInTheDocument();
      });

      // Status should revert to "New"
      expect(screen.getByText('New')).toBeInTheDocument();
    });
  });

  describe('Add to queue', () => {
    it('does not render add-to-queue button when onAddToQueue is not provided', () => {
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      expect(
        screen.queryByRole('button', { name: /Add to queue/ }),
      ).not.toBeInTheDocument();
    });

    it('calls onAddToQueue when "Add to queue" button is clicked', () => {
      const onAddToQueue = jest.fn();
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          error={null}
          onAddToQueue={onAddToQueue}
        />,
      );

      const addButton = screen.getByRole('button', {
        name: /Add Video 1 to queue/,
      });
      fireEvent.click(addButton);

      expect(onAddToQueue).toHaveBeenCalledWith('vid-1');
    });

    it('disables button and shows "Queued" when isQueued returns true', () => {
      const onAddToQueue = jest.fn();
      const isQueued = jest.fn().mockReturnValue(true);
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          error={null}
          onAddToQueue={onAddToQueue}
          isQueued={isQueued}
        />,
      );

      const button = screen.getByRole('button', {
        name: /already queued/,
      });
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Queued');
    });

    it('disables button and shows "Queue full" when queueFull is true', () => {
      const onAddToQueue = jest.fn();
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [makeChannel('ch-1', 'Channel 1', videos)];

      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          error={null}
          onAddToQueue={onAddToQueue}
          isQueued={() => false}
          queueFull={true}
        />,
      );

      const button = screen.getByRole('button', { name: /Queue is full/ });
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Queue full');
    });
  });

  describe('Channel switching clears player and resets focus', () => {
    it('closes active player and resets selected channel when switching channels', () => {
      const videos = [makeVideo('1', 'Video 1')];
      const channels = [
        makeChannel('ch-1', 'Channel 1', videos),
        makeChannel('ch-2', 'Channel 2', videos),
      ];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      // Open player on first channel
      const playButton = screen.getByRole('button', {
        name: /Play Video 1 in app/,
      });
      fireEvent.click(playButton);
      expect(screen.getByTestId('player-vid-1')).toBeInTheDocument();

      // Switch to second channel via the channel tab set
      fireEvent.click(getChannelTabs()[1]);

      // Player should close
      expect(screen.queryByTestId('player-vid-1')).not.toBeInTheDocument();

      // Second channel should be displayed via detail pane heading
      expect(getPaneHeadingText()).toBe('Channel 2');
    });
  });

  describe('Single active player arbitration', () => {
    const channels = [
      makeChannel('ch-1', 'Channel 1', [makeVideo('1', 'Video 1')]),
    ];

    it('claims playback before opening its own player', () => {
      const onPlaybackClaim = jest.fn();
      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          onPlaybackClaim={onPlaybackClaim}
        />,
      );

      fireEvent.click(
        screen.getByRole('button', { name: /Play Video 1 in app/ }),
      );

      expect(onPlaybackClaim).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('player-vid-1')).toBeInTheDocument();
    });

    it('closes its player when another surface takes playback', () => {
      const { rerender } = render(
        <ChannelDirectory channels={channels} loading={false} />,
      );

      fireEvent.click(
        screen.getByRole('button', { name: /Play Video 1 in app/ }),
      );
      expect(screen.getByTestId('player-vid-1')).toBeInTheDocument();

      rerender(
        <ChannelDirectory
          channels={channels}
          loading={false}
          playbackSuspended
        />,
      );

      expect(screen.queryByTestId('player-vid-1')).not.toBeInTheDocument();
    });

    it('does not steal focus back when it is suspended', () => {
      const { rerender } = render(
        <ChannelDirectory channels={channels} loading={false} />,
      );

      const playButton = screen.getByRole('button', {
        name: /Play Video 1 in app/,
      });
      fireEvent.click(playButton);

      // The surface that claimed playback owns focus placement, so a suspend
      // must not pull focus back to this row's play button.
      (document.activeElement as HTMLElement | null)?.blur();

      rerender(
        <ChannelDirectory
          channels={channels}
          loading={false}
          playbackSuspended
        />,
      );

      expect(document.activeElement).not.toBe(playButton);
    });

    it('still plays normally when no arbitration props are supplied', () => {
      render(<ChannelDirectory channels={channels} loading={false} />);

      fireEvent.click(
        screen.getByRole('button', { name: /Play Video 1 in app/ }),
      );

      expect(screen.getByTestId('player-vid-1')).toBeInTheDocument();
    });
  });

  describe('Deep-linked channel', () => {
    const channels = [
      makeChannel('ch-1', 'Channel 1', [makeVideo('1', 'Video 1')]),
      makeChannel('ch-2', 'Channel 2', [makeVideo('2', 'Video 2')]),
    ];

    it('opens the channel named by the link', () => {
      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          initialChannelId="ch-2"
        />,
      );

      expect(getPaneHeadingText()).toBe('Channel 2');
    });

    it('falls back to the first channel when the link names a channel that is no longer enabled', () => {
      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          initialChannelId="ch-disabled-since-the-mail-went-out"
        />,
      );

      expect(getPaneHeadingText()).toBe('Channel 1');
    });

    it('lets the User navigate away from the linked channel', () => {
      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          initialChannelId="ch-2"
        />,
      );

      fireEvent.click(getChannelTabs()[0]);

      expect(getPaneHeadingText()).toBe('Channel 1');
    });
  });

  describe('Expanding past the channel list cap', () => {
    const cappedChannel = () =>
      makeChannel(
        'ch-1',
        'Channel 1',
        Array.from({ length: CHANNEL_LIST_UPLOAD_CAP }, (_, i) =>
          makeVideo(String(i + 1), `Video ${i + 1}`),
        ),
      );

    const showOlder = () =>
      screen.queryByRole('button', { name: /Show older uploads/i });

    it('offers to load older uploads when the channel sits on the cap', () => {
      render(
        <ChannelDirectory
          channels={[cappedChannel()]}
          loading={false}
          onLoadMoreUploads={jest.fn()}
        />,
      );

      expect(showOlder()).toBeInTheDocument();
    });

    it('does not offer when the channel holds fewer uploads than the cap', () => {
      render(
        <ChannelDirectory
          channels={[makeChannel('ch-1', 'Channel 1', [makeVideo('1', 'V1')])]}
          loading={false}
          onLoadMoreUploads={jest.fn()}
        />,
      );

      expect(showOlder()).not.toBeInTheDocument();
    });

    it('does not offer once the channel is known to be fully loaded', () => {
      render(
        <ChannelDirectory
          channels={[cappedChannel()]}
          loading={false}
          onLoadMoreUploads={jest.fn()}
          fullyLoadedChannelIds={new Set(['ch-1'])}
        />,
      );

      expect(showOlder()).not.toBeInTheDocument();
    });

    it('does not offer when the page cannot load more', () => {
      render(<ChannelDirectory channels={[cappedChannel()]} loading={false} />);

      expect(showOlder()).not.toBeInTheDocument();
    });

    it('asks for the channel that is on screen', () => {
      const onLoadMoreUploads = jest.fn();
      render(
        <ChannelDirectory
          channels={[
            makeChannel('ch-0', 'Channel 0', [makeVideo('x', 'Other')]),
            cappedChannel(),
          ]}
          loading={false}
          initialChannelId="ch-1"
          onLoadMoreUploads={onLoadMoreUploads}
        />,
      );

      fireEvent.click(showOlder() as HTMLElement);

      expect(onLoadMoreUploads).toHaveBeenCalledWith('ch-1');
    });

    it('reports progress and refuses a second request while loading', () => {
      const onLoadMoreUploads = jest.fn();
      render(
        <ChannelDirectory
          channels={[cappedChannel()]}
          loading={false}
          onLoadMoreUploads={onLoadMoreUploads}
          loadingMoreChannelIds={new Set(['ch-1'])}
        />,
      );

      const button = screen.getByRole('button', {
        name: /Loading older uploads/i,
      });
      expect(button).toBeDisabled();

      fireEvent.click(button);
      expect(onLoadMoreUploads).not.toHaveBeenCalled();
    });

    it('keeps the end-of-list disclosure alongside the control', () => {
      render(
        <ChannelDirectory
          channels={[cappedChannel()]}
          loading={false}
          onLoadMoreUploads={jest.fn()}
        />,
      );

      // Expanding reaches the whole cached snapshot, not the whole channel —
      // the disclosure about uncached uploads still has to be true.
      expect(
        screen.getByText(/MyOrganiser stores only recent uploads/),
      ).toBeInTheDocument();
    });
  });

  describe('Channel selector tab semantics', () => {
    const renderTwoChannels = () =>
      render(
        <ChannelDirectory
          channels={[
            makeChannel('ch-1', 'Channel 1', [makeVideo('1', 'Video 1')]),
            makeChannel('ch-2', 'Channel 2', [makeVideo('2', 'Video 2')]),
          ]}
          loading={false}
          error={null}
        />,
      );

    it('exposes the channel selector as one horizontal tab set, not a nav landmark', () => {
      const { container } = renderTwoChannels();

      // The set carries a single tab stop and moves with arrow keys, which is
      // the tabs contract; announcing it as navigation contradicted that.
      expect(container.querySelector('nav')).toBeNull();
      const tablist = screen.getByRole('tablist', {
        name: 'Enabled channels',
      });
      expect(tablist).toHaveAttribute('aria-orientation', 'horizontal');
      expect(screen.getAllByRole('tablist')).toHaveLength(1);
      expect(getChannelTabs()).toHaveLength(2);
    });

    it('points every channel tab at the one detail pane it swaps', () => {
      renderTwoChannels();

      const panel = screen.getByRole('tabpanel');
      expect(panel).toHaveAttribute('aria-label', 'Channel 1');

      const panelId = panel.getAttribute('id');
      expect(panelId).toBeTruthy();

      getChannelTabs().forEach((tab) => {
        expect(tab).toHaveAttribute('aria-controls', panelId);
      });
    });

    it('gives each channel tab a unique id derived from its channel', () => {
      renderTwoChannels();

      expect(getChannelTabs().map((tab) => tab.id)).toEqual([
        'channel-tab-ch-1',
        'channel-tab-ch-2',
      ]);
    });

    it('moves aria-selected onto the newly chosen channel', () => {
      renderTwoChannels();

      const tabs = getChannelTabs();

      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

      fireEvent.click(tabs[1]);

      expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Phone upload rows', () => {
    beforeEach(() => {
      mockUseIsMobileState.mockReturnValue(true);
    });

    it('makes the thumbnail the one Play control per row and it opens the player', () => {
      const channels = [
        makeChannel('ch-1', 'Channel 1', [
          makeVideo('1', 'Video 1'),
          makeVideo('2', 'Video 2'),
        ]),
      ];

      render(
        <ChannelDirectory channels={channels} loading={false} error={null} />,
      );

      expect(screen.getAllByRole('button', { name: / in app$/ })).toHaveLength(
        2,
      );

      fireEvent.click(
        screen.getByRole('button', { name: 'Play Video 1 in app' }),
      );

      expect(screen.getByTestId('player-vid-1')).toBeInTheDocument();
    });

    it('toggles the watched pill from the phone row', async () => {
      const onWatchedToggle = jest.fn();
      (updateVideoWatched as jest.Mock).mockResolvedValue({ watched: true });
      const channels = [
        makeChannel('ch-1', 'Channel 1', [makeVideo('1', 'Video 1')]),
      ];

      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          error={null}
          onWatchedToggle={onWatchedToggle}
        />,
      );

      fireEvent.click(
        screen.getByRole('button', { name: 'Mark Video 1 as watched' }),
      );

      await waitFor(() => {
        expect(updateVideoWatched).toHaveBeenCalledWith('vid-1', true);
      });
      await waitFor(() => {
        expect(onWatchedToggle).toHaveBeenCalledWith('vid-1', true);
      });
      expect(
        screen.getByRole('button', { name: 'Mark Video 1 as new' }),
      ).toBeInTheDocument();
    });

    it('calls onAddToQueue from the icon-only queue control', () => {
      const onAddToQueue = jest.fn();
      const channels = [
        makeChannel('ch-1', 'Channel 1', [makeVideo('1', 'Video 1')]),
      ];

      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          error={null}
          onAddToQueue={onAddToQueue}
        />,
      );

      const addButton = screen.getByRole('button', {
        name: 'Add Video 1 to queue',
      });
      expect(addButton.textContent).toBe('');

      fireEvent.click(addButton);

      expect(onAddToQueue).toHaveBeenCalledWith('vid-1');
    });

    it('disables the icon-only queue control under its queued and full names', () => {
      const channels = [
        makeChannel('ch-1', 'Channel 1', [makeVideo('1', 'Video 1')]),
      ];

      const { unmount } = render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          error={null}
          onAddToQueue={jest.fn()}
          isQueued={() => true}
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Video 1 is already queued' }),
      ).toBeDisabled();
      unmount();

      render(
        <ChannelDirectory
          channels={channels}
          loading={false}
          error={null}
          onAddToQueue={jest.fn()}
          queueFull
        />,
      );

      expect(
        screen.getByRole('button', {
          name: /Queue is full — remove an upload to add Video 1/,
        }),
      ).toBeDisabled();
    });
  });
});
