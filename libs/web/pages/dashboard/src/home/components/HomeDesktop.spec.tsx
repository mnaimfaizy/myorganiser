import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { formatMoney } from '@myorganiser/core';
import type { YouTubeState, YouTubeVideo } from '../home-view';
import { HomeDesktop } from './HomeDesktop';
import {
  buildFixtureView,
  EMPTY_UNLOCKED_SUMMARY,
  FIXTURE_NOW,
} from '../testing/home-view-fixtures';

const VIDEO_PUBLISHED_AT = new Date(FIXTURE_NOW.getTime() - 2 * 60 * 60 * 1000);

function uploadRow(overrides: Partial<YouTubeVideo> = {}): YouTubeVideo {
  return {
    videoId: 'v1',
    title: 'New upload',
    thumbnail: null,
    publishedAt: VIDEO_PUBLISHED_AT.toISOString(),
    channelTitle: 'Channel One',
    ...overrides,
  };
}

/** YouTube visible and loaded with the given uploads, for the view input. */
function loadedYouTube(videos: YouTubeVideo[]) {
  return {
    visible: true,
    state: { status: 'loaded' as const, channels: 1, videos },
  };
}

describe('HomeDesktop', () => {
  it('shows one h1 greeting and the hero sentence for an unlocked vault', () => {
    render(<HomeDesktop view={buildFixtureView()} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Good morning, Ada' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '3 tasks are due today and 2 subscriptions renew this week.',
      ),
    ).toBeInTheDocument();
  });

  it('exposes today’s task progress as a progressbar with its values', () => {
    render(<HomeDesktop view={buildFixtureView()} />);

    const bar = screen.getByRole('progressbar', {
      name: "Today's tasks done",
    });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
  });

  it('opens Quick add onto five links to the add flows', () => {
    render(<HomeDesktop view={buildFixtureView()} />);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Quick add' }), {
      key: 'Enter',
    });

    const items = screen.getAllByRole('menuitem');
    expect(
      items.map((item) => [item.textContent, item.getAttribute('href')]),
    ).toEqual([
      ['Tasks', '/dashboard/tasks'],
      ['Groceries', '/dashboard/groceries'],
      ['Addresses', '/dashboard/addresses'],
      ['Subscriptions', '/dashboard/subscriptions'],
      ['Mobile numbers', '/dashboard/mobile-numbers'],
    ]);
  });

  it('links the hero to today’s tasks and names the Tasks, Groceries and Vault spaces by title, summary and pill', () => {
    render(<HomeDesktop view={buildFixtureView()} />);

    expect(
      screen.getByRole('link', { name: "Open today's tasks" }),
    ).toHaveAttribute('href', '/dashboard/tasks');
    expect(
      screen.getByRole('link', {
        name: 'Tasks 3 open across Personal and Work 2 due today',
      }),
    ).toHaveAttribute('href', '/dashboard/tasks');
    expect(
      screen.getByRole('link', {
        name: `Groceries 2 lists, 5 items left to buy $9.00`,
      }),
    ).toHaveAttribute('href', '/dashboard/groceries');
    expect(
      screen.getByRole('link', {
        name: 'Vault No backups recorded yet Unlocked',
      }),
    ).toHaveAttribute('href', '/dashboard/vault');
  });

  it('lists due tasks and renewals under Coming up, read-only', () => {
    render(<HomeDesktop view={buildFixtureView()} />);

    const comingUp = screen.getByRole('region', { name: 'Coming up' });
    const rows = within(comingUp)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(rows).toEqual([
      'Pay ratesOverdue',
      'Book dentistToday',
      expect.stringContaining('Streaming'),
      expect.stringContaining('Domain'),
    ]);
    expect(within(comingUp).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(comingUp).getByText('Renews Fri 23 Oct')).toBeInTheDocument();
    expect(
      within(comingUp).getByText(formatMoney({ amount: 10, currency: 'USD' })),
    ).toBeInTheDocument();
  });

  it('shows the empty copy under Coming up when nothing is due or renewing', () => {
    render(
      <HomeDesktop
        view={buildFixtureView({ summary: EMPTY_UNLOCKED_SUMMARY })}
      />,
    );

    const comingUp = screen.getByRole('region', { name: 'Coming up' });
    expect(
      within(comingUp).getByText('Nothing due today.'),
    ).toBeInTheDocument();
    expect(
      within(comingUp).getByText('Nothing renews this week.'),
    ).toBeInTheDocument();
  });

  it('links a recent upload to YouTube in a new tab', () => {
    const { rerender } = render(<HomeDesktop view={buildFixtureView()} />);
    expect(
      screen.queryByRole('region', { name: 'New videos' }),
    ).not.toBeInTheDocument();

    rerender(
      <HomeDesktop
        view={buildFixtureView({
          youtube: {
            visible: true,
            state: {
              status: 'loaded',
              channels: 1,
              videos: [
                {
                  videoId: 'v1',
                  title: 'New upload',
                  thumbnail: null,
                  publishedAt: VIDEO_PUBLISHED_AT.toISOString(),
                  channelTitle: 'Channel One',
                },
              ],
            },
          },
        })}
      />,
    );

    const videos = screen.getByRole('region', { name: 'New videos' });
    const upload = within(videos).getByRole('link', {
      name: /New upload/,
    });
    expect(upload).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=v1',
    );
    expect(upload).toHaveAttribute('target', '_blank');
    expect(upload).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the thumbnail of a recent upload as an image with empty alt text', () => {
    const { container } = render(
      <HomeDesktop
        view={buildFixtureView({
          youtube: loadedYouTube([
            uploadRow({ thumbnail: 'https://i.ytimg.com/vi/v1/hq.jpg' }),
          ]),
        })}
      />,
    );

    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', 'https://i.ytimg.com/vi/v1/hq.jpg');
    expect(image).toHaveAttribute('alt', '');
  });

  it.each<[string, YouTubeState, string]>([
    ['loading', { status: 'loading' }, 'Loading…'],
    ['error', { status: 'error' }, 'Could not load videos. Try again later.'],
    [
      'loaded with no uploads',
      { status: 'loaded', channels: 1, videos: [] },
      'No videos yet. Sync your subscriptions to see recent uploads.',
    ],
  ])('shows the %s copy in New videos', (_label, state, copy) => {
    render(
      <HomeDesktop
        view={buildFixtureView({ youtube: { visible: true, state } })}
      />,
    );

    const videos = screen.getByRole('region', { name: 'New videos' });
    expect(within(videos).getByText(copy)).toBeInTheDocument();
  });

  it('offers Connect YouTube in New videos when YouTube is not connected', () => {
    render(
      <HomeDesktop
        view={buildFixtureView({
          youtube: { visible: true, state: { status: 'disconnected' } },
        })}
      />,
    );

    const videos = screen.getByRole('region', { name: 'New videos' });
    expect(
      within(videos).getByText('YouTube is not connected.'),
    ).toBeInTheDocument();
    expect(
      within(videos).getByRole('link', { name: 'Connect YouTube' }),
    ).toHaveAttribute('href', '/dashboard/youtube');
  });

  it('shows Loading… in the Coming up cards and the hero while the summary is still being read', () => {
    render(<HomeDesktop view={buildFixtureView({ summary: null })} />);

    const hero = screen.getByRole('region', { name: 'Good morning, Ada' });
    expect(within(hero).getByText('Loading…')).toBeInTheDocument();

    const dueToday = screen.getByRole('region', { name: 'Due today' });
    expect(within(dueToday).getByText('Loading…')).toBeInTheDocument();
    const renewing = screen.getByRole('region', { name: 'Renewing soon' });
    expect(within(renewing).getByText('Loading…')).toBeInTheDocument();
  });

  it('shows Unlock and recovery key links, no Coming up, and Locked pills for a locked vault', () => {
    render(
      <HomeDesktop
        view={buildFixtureView({
          unlocked: false,
          summary: null,
          backup: { status: 'pending' },
        })}
      />,
    );

    expect(screen.getByRole('link', { name: 'Unlock vault' })).toHaveAttribute(
      'href',
      '/dashboard/vault',
    );
    expect(
      screen.getByRole('link', { name: 'Use recovery key' }),
    ).toHaveAttribute('href', '/dashboard/vault');
    expect(
      screen.queryByRole('region', { name: 'Coming up' }),
    ).not.toBeInTheDocument();
    // Five sealed spaces plus the Vault space, each with a Locked pill.
    expect(screen.getAllByText('Locked')).toHaveLength(6);
  });
});
