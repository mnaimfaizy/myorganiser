import type { HomeSummaryData } from '../home-summary';
import { buildHomeView, type HomeView, type HomeViewInput } from '../home-view';

/** Wednesday 21 October 2026, 09:30 local: the morning greeting. */
export const FIXTURE_NOW = new Date(2026, 9, 21, 9, 30);

/** One overdue and one due-today task, one open Personal and one open Work. */
export const POPULATED_SUMMARY: HomeSummaryData = {
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

export const EMPTY_UNLOCKED_SUMMARY: HomeSummaryData = {
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

/** Builds a Home view through the real view model, so copy and state rules match production. */
export function buildFixtureView(
  overrides: Partial<HomeViewInput> = {},
): HomeView {
  return buildHomeView({
    now: FIXTURE_NOW,
    firstName: 'Ada',
    unlocked: true,
    summary: POPULATED_SUMMARY,
    backup: { status: 'empty' },
    youtube: { visible: false, state: { status: 'disconnected' } },
    synced: true,
    ...overrides,
  });
}
