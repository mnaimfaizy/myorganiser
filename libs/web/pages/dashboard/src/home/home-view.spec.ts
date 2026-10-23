import type {
  HomeDueTask,
  HomeRenewal,
  HomeSummaryData,
  TasksHomeSummary,
} from './home-summary';
import {
  buildHomeView,
  type BackupState,
  type HomePill,
  type HomeSpace,
  type HomeSpaceKey,
  type HomeView,
  type HomeViewInput,
  type YouTubeState,
  type YouTubeVideo,
} from './home-view';

// Wednesday 21 October 2026, 09:30 local (morning greeting).
const NOW = new Date(2026, 9, 21, 9, 30);
const TWO_HOURS_AGO = new Date(
  NOW.getTime() - 2 * 60 * 60 * 1000,
).toISOString();
const TWO_DAYS_AGO = new Date(
  NOW.getTime() - 2 * 24 * 60 * 60 * 1000,
).toISOString();

const LOCKED_HERO =
  "Your vault is locked. Unlock it to see what's due, your lists and your spending.";

const EMPTY_SUMMARY: HomeSummaryData = {
  tasks: {
    open: 0,
    openContexts: [],
    dueOpen: [],
    doneToday: 0,
    todayTotal: 0,
    todayDone: 0,
  },
  subscriptions: { active: 0, monthly: '', renewingSoon: [] },
  groceries: { listCount: 0, itemsLeft: 0, knownSpend: 0 },
  addresses: { count: 0, places: 0, updatedPlaces: 0 },
  mobile: { count: 0, places: 0, updatedPlaces: 0 },
};

const POPULATED: HomeSummaryData = {
  tasks: {
    open: 3,
    openContexts: ['Personal', 'Work'],
    dueOpen: [
      { id: 't-old', title: 'Pay rates', dueDate: '2026-10-19', overdue: true },
      {
        id: 't-today',
        title: 'Book dentist',
        dueDate: '2026-10-21',
        overdue: false,
      },
    ],
    doneToday: 1,
    todayTotal: 3,
    todayDone: 1,
  },
  subscriptions: {
    active: 2,
    monthly: '$10.00 + A$1.00',
    renewingSoon: [
      {
        id: 's-1',
        name: 'Streaming',
        renewsOn: new Date(2026, 9, 23),
        amount: 10,
        currency: 'USD',
      },
      {
        id: 's-2',
        name: 'Domain',
        renewsOn: new Date(2026, 9, 25),
        amount: 12,
        currency: 'AUD',
      },
    ],
  },
  groceries: { listCount: 2, itemsLeft: 5, knownSpend: 9 },
  addresses: { count: 2, places: 3, updatedPlaces: 1 },
  mobile: { count: 2, places: 2, updatedPlaces: 0 },
};

function renewals(count: number): HomeRenewal[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    name: `Sub ${i}`,
    renewsOn: new Date(2026, 9, 25),
    amount: 10,
    currency: 'USD',
  }));
}

function summaryWith(
  tasks: Partial<TasksHomeSummary>,
  renewingSoon: readonly HomeRenewal[] = POPULATED.subscriptions.renewingSoon,
): HomeSummaryData {
  return {
    ...POPULATED,
    tasks: { ...POPULATED.tasks, ...tasks },
    subscriptions: { ...POPULATED.subscriptions, renewingSoon },
  };
}

function viewInput(overrides: Partial<HomeViewInput> = {}): HomeViewInput {
  return {
    now: NOW,
    firstName: 'Ada',
    unlocked: true,
    summary: POPULATED,
    backup: { status: 'empty' },
    youtube: { visible: false, state: { status: 'disconnected' } },
    synced: true,
    ...overrides,
  };
}

function space(view: HomeView, key: HomeSpaceKey): HomeSpace {
  const found = view.spaces.find((entry) => entry.key === key);
  if (!found) throw new Error(`no ${key} space in the view`);
  return found;
}

function video(
  videoId: string,
  overrides: Partial<YouTubeVideo> = {},
): YouTubeVideo {
  return {
    videoId,
    title: `Video ${videoId}`,
    thumbnail: null,
    publishedAt: TWO_HOURS_AGO,
    channelTitle: 'Chan',
    ...overrides,
  };
}

function loadedYouTube(channels: number | null, count: number): YouTubeState {
  return {
    status: 'loaded',
    channels,
    videos: Array.from({ length: count }, (_, i) => video(`v${i}`)),
  };
}

describe('buildHomeView', () => {
  it.each<[string | null, string]>([
    ['Ada', 'Ada'],
    [null, 'there'],
  ])(
    'greets by first name or "there" when none is known (%s)',
    (firstName, expected) => {
      const view = buildHomeView(viewInput({ firstName }));

      expect(view.firstName).toBe(expected);
      expect(view.greeting).toBe('Good morning');
      expect(view.dateCaption).toBe('Wednesday, 21 October');
    },
  );

  it.each<[number, number, string]>([
    [0, 0, 'No tasks are due today and no subscriptions renew this week.'],
    [1, 1, '1 task is due today and 1 subscription renews this week.'],
    [3, 2, '3 tasks are due today and 2 subscriptions renew this week.'],
    [0, 2, 'No tasks are due today and 2 subscriptions renew this week.'],
  ])(
    'hero line for %i due task(s) and %i renewal(s)',
    (todayTotal, renewCount, expected) => {
      const view = buildHomeView(
        viewInput({
          summary: summaryWith(
            { todayTotal, todayDone: 0 },
            renewals(renewCount),
          ),
        }),
      );

      expect(view.heroLine).toBe(expected);
    },
  );

  it('shows loading copy and no progress or rows until the vault blobs are read', () => {
    const view = buildHomeView(viewInput({ summary: null }));

    expect(view.summaryPending).toBe(true);
    expect(view.heroLine).toBe('Loading…');
    expect(view.progress).toBeNull();
    expect(view.todayTitle).toBe('Loading…');
    expect(view.todayMeta).toBe('');
    expect(view.dueRows).toEqual([]);
    expect(view.renewalRows).toEqual([]);
    const measuredKeys: HomeSpaceKey[] = [
      'tasks',
      'groceries',
      'subscriptions',
      'addresses',
      'mobile',
    ];
    expect(measuredKeys.map((key) => space(view, key).summary)).toEqual(
      measuredKeys.map(() => 'Loading…'),
    );
  });

  it('replaces the hero, progress, Today card and rows with locked copy even when a summary exists', () => {
    const view = buildHomeView(
      viewInput({
        unlocked: false,
        synced: false,
        youtube: { visible: true, state: loadedYouTube(1, 0) },
      }),
    );

    expect(view.unlocked).toBe(false);
    expect(view.summaryPending).toBe(false);
    expect(view.heroLine).toBe(LOCKED_HERO);
    expect(view.progress).toBeNull();
    expect(view.todayTitle).toBe('');
    expect(view.todayMeta).toBe('');
    expect(view.dueRows).toEqual([]);
    expect(view.renewalRows).toEqual([]);
    expect(view.synced).toBe(false);
  });

  it.each<[Partial<TasksHomeSummary>, { done: number; total: number } | null]>([
    [{ dueOpen: [], doneToday: 0, todayTotal: 0, todayDone: 0 }, null],
    [
      { todayTotal: 3, todayDone: 1 },
      { done: 1, total: 3 },
    ],
  ])(
    'shows progress only when something is due today (%#)',
    (tasks, expected) => {
      const view = buildHomeView(viewInput({ summary: summaryWith(tasks) }));

      expect(view.progress).toEqual(expected);
    },
  );

  it('seals every space except YouTube when locked, and marks the vault as locked', () => {
    const view = buildHomeView(viewInput({ unlocked: false }));

    expect(view.spaces.map((entry) => entry.key)).toEqual([
      'tasks',
      'groceries',
      'subscriptions',
      'addresses',
      'mobile',
      'vault',
    ]);
    const sealedKeys: HomeSpaceKey[] = [
      'tasks',
      'groceries',
      'subscriptions',
      'addresses',
      'mobile',
    ];
    expect(
      sealedKeys.map((key) => {
        const entry = space(view, key);
        return {
          key,
          summary: entry.summary,
          pill: entry.pill,
          meta: entry.meta,
          phonePill: entry.phonePill,
        };
      }),
    ).toEqual(
      sealedKeys.map((key) => ({
        key,
        summary: 'Encrypted · unlock to view',
        pill: { label: 'Locked', tone: 'neutral' },
        meta: 'Encrypted',
        phonePill: { label: 'Locked', tone: 'neutral' },
      })),
    );
    expect(space(view, 'vault')).toMatchObject({
      summary: 'Unlock to use your spaces',
      pill: { label: 'Locked', tone: 'warning' },
      meta: 'Encrypted',
      phonePill: { label: 'Locked', tone: 'neutral' },
    });
  });

  it.each<[boolean, boolean, HomeSpaceKey[]]>([
    [
      true,
      false,
      ['tasks', 'groceries', 'subscriptions', 'addresses', 'mobile', 'vault'],
    ],
    [
      true,
      true,
      [
        'tasks',
        'groceries',
        'subscriptions',
        'addresses',
        'mobile',
        'youtube',
        'vault',
      ],
    ],
    [
      false,
      true,
      [
        'tasks',
        'groceries',
        'subscriptions',
        'addresses',
        'mobile',
        'youtube',
        'vault',
      ],
    ],
  ])(
    'orders spaces with YouTube between Mobile numbers and Vault (unlocked %s, YouTube visible %s)',
    (unlocked, youtubeVisible, expected) => {
      const view = buildHomeView(
        viewInput({
          unlocked,
          youtube: {
            visible: youtubeVisible,
            state: { status: 'disconnected' },
          },
        }),
      );

      expect(view.spaces.map((entry) => entry.key)).toEqual(expected);
      expect(view.youtubeVisible).toBe(youtubeVisible);
    },
  );

  it.each<[HomeSpaceKey, string, HomePill | null, string, HomePill | null]>([
    [
      'tasks',
      '3 open across Personal and Work',
      { label: '2 due today', tone: 'warning' },
      '3 open across Personal and Work',
      null,
    ],
    [
      'groceries',
      '2 lists, 5 items left to buy',
      { label: '$9.00', tone: 'neutral' },
      '2 lists · 5 left',
      null,
    ],
    [
      'subscriptions',
      '2 active, $10.00 + A$1.00 a month',
      { label: '2 renew soon', tone: 'warning' },
      '$10.00 + A$1.00 a month',
      { label: '2 soon', tone: 'warning' },
    ],
    [
      'addresses',
      '2 saved · 1 of 3 places updated',
      { label: '2 to update', tone: 'warning' },
      '1 of 3 updated',
      null,
    ],
    [
      'mobile',
      '2 saved numbers',
      { label: '2', tone: 'neutral' },
      '2 saved',
      null,
    ],
  ])(
    'unlocked %s space reads its summary, pill and phone meta',
    (key, summary, pill, meta, phonePill) => {
      const entry = space(buildHomeView(viewInput()), key);

      expect({
        summary: entry.summary,
        pill: entry.pill,
        meta: entry.meta,
        phonePill: entry.phonePill,
      }).toEqual({
        summary,
        pill,
        meta,
        phonePill,
      });
    },
  );

  it.each<
    [
      HomeSpaceKey,
      HomeSummaryData,
      string,
      HomePill | null,
      string,
      HomePill | null,
    ]
  >([
    [
      'mobile',
      { ...POPULATED, mobile: { count: 1, places: 0, updatedPlaces: 0 } },
      '1 saved number',
      { label: '1', tone: 'neutral' },
      '1 saved',
      null,
    ],
    [
      'tasks',
      summaryWith({ open: 2, openContexts: [] }),
      '2 open',
      { label: '2 due today', tone: 'warning' },
      '2 open',
      null,
    ],
    [
      'subscriptions',
      {
        ...POPULATED,
        subscriptions: { active: 2, monthly: '', renewingSoon: [] },
      },
      '2 active',
      null,
      '2 active',
      null,
    ],
    [
      'groceries',
      {
        ...POPULATED,
        groceries: { listCount: 1, itemsLeft: 1, knownSpend: 9 },
      },
      '1 list, 1 item left to buy',
      { label: '$9.00', tone: 'neutral' },
      '1 list · 1 left',
      null,
    ],
  ])(
    'unlocked %s space reads its singular and no-monthly copy',
    (key, summary, expectedSummary, pill, meta, phonePill) => {
      const entry = space(buildHomeView(viewInput({ summary })), key);

      expect({
        summary: entry.summary,
        pill: entry.pill,
        meta: entry.meta,
        phonePill: entry.phonePill,
      }).toEqual({
        summary: expectedSummary,
        pill,
        meta,
        phonePill,
      });
    },
  );

  it('uses empty-state copy and drops the pills for zero counts, and reports places only when they exist', () => {
    const empty = buildHomeView(viewInput({ summary: EMPTY_SUMMARY }));

    expect(space(empty, 'tasks')).toMatchObject({
      summary: 'Nothing open',
      pill: null,
    });
    expect(space(empty, 'groceries')).toMatchObject({
      summary: 'No grocery lists yet',
      pill: null,
      meta: 'No grocery lists yet',
    });
    expect(space(empty, 'subscriptions')).toMatchObject({
      summary: 'None active',
      pill: null,
      meta: 'None active',
      phonePill: null,
    });
    expect(space(empty, 'addresses')).toMatchObject({
      summary: 'None saved',
      pill: null,
      meta: 'None saved',
    });
    expect(space(empty, 'mobile')).toMatchObject({
      summary: 'None saved',
      pill: null,
      meta: 'None saved',
    });

    // Saved addresses with no usage places drop the "of N places" clause.
    // The single renewal pins the source's singular copy: "1 renews soon".
    const noPlaces = buildHomeView(
      viewInput({
        summary: {
          ...POPULATED,
          addresses: { count: 2, places: 0, updatedPlaces: 0 },
          subscriptions: {
            ...POPULATED.subscriptions,
            renewingSoon: [POPULATED.subscriptions.renewingSoon[0]],
          },
        },
      }),
    );

    expect(space(noPlaces, 'addresses')).toMatchObject({
      summary: '2 saved',
      meta: '2 saved',
      pill: null,
    });
    expect(space(noPlaces, 'subscriptions')).toMatchObject({
      pill: { label: '1 renews soon', tone: 'warning' },
      phonePill: { label: '1 soon', tone: 'warning' },
    });
  });

  it.each<[BackupState, string]>([
    [{ status: 'empty' }, 'No backups recorded yet'],
    [{ status: 'pending' }, 'Unlocked'],
    [{ status: 'error' }, 'Unlocked'],
    [
      {
        status: 'loaded',
        record: { createdAt: TWO_DAYS_AGO, source: 'google-drive' },
      },
      'Backed up to Google Drive 2 days ago',
    ],
    [
      {
        status: 'loaded',
        record: { createdAt: TWO_DAYS_AGO, source: 'local' },
      },
      'Backed up 2 days ago',
    ],
    [
      {
        status: 'loaded',
        record: { createdAt: 'not a date', source: 'local' },
      },
      'Unlocked',
    ],
  ])('vault space copy for backup state %#', (backup, expected) => {
    const entry = space(buildHomeView(viewInput({ backup })), 'vault');

    expect(entry.summary).toBe(expected);
    expect(entry.meta).toBe(expected);
    expect(entry.pill).toEqual({ label: 'Unlocked', tone: 'trust' });
  });

  it.each<[YouTubeState, string, HomePill | null, string]>([
    [{ status: 'loading' }, 'Loading…', null, 'Loading…'],
    [{ status: 'disconnected' }, 'Not connected', null, 'Not connected'],
    [{ status: 'error' }, 'Could not load', null, 'Could not load'],
    [
      loadedYouTube(2, 3),
      '2 channels',
      { label: '3 new', tone: 'neutral' },
      '3 new videos',
    ],
    [
      loadedYouTube(1, 1),
      '1 channel',
      { label: '1 new', tone: 'neutral' },
      '1 new video',
    ],
    [loadedYouTube(1, 0), '1 channel', null, '0 new videos'],
    [
      loadedYouTube(null, 2),
      'Connected',
      { label: '2 new', tone: 'neutral' },
      '2 new videos',
    ],
  ])('YouTube space for state %#', (state, summary, pill, meta) => {
    const entry = space(
      buildHomeView(viewInput({ youtube: { visible: true, state } })),
      'youtube',
    );

    expect({
      summary: entry.summary,
      pill: entry.pill,
      meta: entry.meta,
    }).toEqual({ summary, pill, meta });
  });

  it('lists the first three videos as YouTube watch links with channel and relative time', () => {
    const view = buildHomeView(
      viewInput({
        youtube: {
          visible: true,
          state: {
            status: 'loaded',
            channels: 1,
            videos: [
              video('id one&two', {
                title: 'First',
                thumbnail: 'https://img.example/1.jpg',
              }),
              video('b'),
              video('c'),
              video('d'),
            ],
          },
        },
      }),
    );

    expect(view.videoRows).toHaveLength(3);
    expect(view.videoRows[0]).toEqual({
      videoId: 'id one&two',
      title: 'First',
      thumbnail: 'https://img.example/1.jpg',
      href: 'https://www.youtube.com/watch?v=id%20one%26two',
      meta: 'Chan · 2 hours ago',
    });
  });

  it.each<[string | undefined, string, string]>([
    ['Chan', TWO_HOURS_AGO, 'Chan · 2 hours ago'],
    [undefined, TWO_HOURS_AGO, '2 hours ago'],
    ['Chan', 'not a date', 'Chan'],
    [undefined, 'not a date', ''],
  ])(
    'video meta for channel %s and published %s',
    (channelTitle, publishedAt, expected) => {
      const view = buildHomeView(
        viewInput({
          youtube: {
            visible: true,
            state: {
              status: 'loaded',
              channels: 1,
              videos: [video('x', { channelTitle, publishedAt })],
            },
          },
        }),
      );

      expect(view.videoRows[0].meta).toBe(expected);
    },
  );

  it('caps Due today and Renewing soon at five rows, tagging overdue tasks as danger', () => {
    const dueOpen: HomeDueTask[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      dueDate: i === 0 ? '2026-10-19' : '2026-10-21',
      overdue: i === 0,
    }));
    const view = buildHomeView(
      viewInput({
        summary: {
          ...POPULATED,
          tasks: { ...POPULATED.tasks, dueOpen, todayTotal: 6 },
          subscriptions: {
            ...POPULATED.subscriptions,
            renewingSoon: renewals(6),
          },
        },
      }),
    );

    expect(view.dueRows.map((row) => row.id)).toEqual([
      't0',
      't1',
      't2',
      't3',
      't4',
    ]);
    expect(view.dueRows[0].pill).toEqual({ label: 'Overdue', tone: 'danger' });
    expect(view.dueRows[1].pill).toEqual({ label: 'Today', tone: 'neutral' });
    expect(view.renewalRows).toHaveLength(5);
    expect(
      view.renewalRows.every((row) => row.when === 'Renews Sun 25 Oct'),
    ).toBe(true);
    expect(view.renewalRows.every((row) => row.amount.includes('10.00'))).toBe(
      true,
    );
  });

  it.each<[Partial<TasksHomeSummary>, number, string, string]>([
    [
      { dueOpen: [], doneToday: 0, todayTotal: 0, todayDone: 0 },
      0,
      'Nothing due today',
      '',
    ],
    [
      {
        dueOpen: POPULATED.tasks.dueOpen.slice(0, 1),
        doneToday: 0,
        todayTotal: 1,
        todayDone: 0,
      },
      0,
      '1 task due',
      '0 of 1 done',
    ],
    [
      { todayTotal: 3, todayDone: 1 },
      1,
      '3 tasks due',
      '1 of 3 done · 1 renews this week',
    ],
    [
      { dueOpen: [], doneToday: 0, todayTotal: 0, todayDone: 0 },
      2,
      'Nothing due today',
      '2 renew this week',
    ],
  ])(
    'phone Today card for %# shows the due count and renewal count',
    (tasks, renewCount, title, meta) => {
      const view = buildHomeView(
        viewInput({ summary: summaryWith(tasks, renewals(renewCount)) }),
      );

      expect({ title: view.todayTitle, meta: view.todayMeta }).toEqual({
        title,
        meta,
      });
    },
  );
});
