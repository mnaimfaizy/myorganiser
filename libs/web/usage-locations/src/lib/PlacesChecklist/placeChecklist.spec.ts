import {
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';

import {
  filterPlaces,
  formatPlacePhoneMeta,
  formatPlaceMeta,
  formatShortDate,
  placeProgress,
  sortPlaces,
  type PlaceProgress,
} from './placeChecklist';

const TODAY = new Date(2026, 9, 22, 12);

/** A local-noon ISO string, so the calendar day holds in any time zone. */
function isoOn(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12).toISOString();
}

function makeLocation(
  overrides: Partial<UsageLocationRecord> = {},
): UsageLocationRecord {
  return {
    id: 'loc',
    organisationName: 'Services Australia',
    organisationType: OrganisationTypeEnum.Government,
    updateMethod: UpdateMethodEnum.Online,
    changed: false,
    priority: PriorityEnum.Normal,
    createdAt: isoOn(2026, 0, 1),
    ...overrides,
  };
}

const ids = <T extends { id: string }>(items: readonly T[]): string[] =>
  items.map((item) => item.id);

describe('placeProgress', () => {
  it.each<[string, UsageLocationRecord[], PlaceProgress]>([
    [
      'a mix of updated and open places',
      [
        makeLocation({ changed: true }),
        makeLocation({ changed: false }),
        makeLocation({ changed: false }),
      ],
      { done: 1, total: 3, left: 2 },
    ],
    ['no places', [], { done: 0, total: 0, left: 0 }],
  ])('counts places for %s', (_label, locations, expected) => {
    expect(placeProgress(locations)).toEqual(expected);
  });
});

describe('formatShortDate', () => {
  it.each<[string | undefined, string | null]>([
    [isoOn(2026, 9, 3), '3 Oct'],
    [isoOn(2025, 9, 3), '3 Oct 2025'],
    [undefined, null],
    ['not a date', null],
  ])('formats %s as %s', (iso, expected) => {
    expect(formatShortDate(iso, TODAY)).toBe(expected);
  });
});

describe('place meta lines', () => {
  it.each<[string, UsageLocationRecord, string]>([
    [
      'an unchanged place',
      makeLocation({
        organisationType: OrganisationTypeEnum.Government,
        updateMethod: UpdateMethodEnum.Online,
      }),
      'Government · online',
    ],
    [
      'a changed place with changedAt',
      makeLocation({
        organisationType: OrganisationTypeEnum.Utility,
        updateMethod: UpdateMethodEnum.InPerson,
        changed: true,
        changedAt: isoOn(2026, 9, 2),
      }),
      'Utility · in person · updated 2 Oct',
    ],
    [
      'a changed place without changedAt',
      makeLocation({
        organisationType: OrganisationTypeEnum.Utility,
        updateMethod: UpdateMethodEnum.InPerson,
        changed: true,
      }),
      'Utility · in person · updated',
    ],
  ])('formats the desktop meta for %s', (_label, location, expected) => {
    expect(formatPlaceMeta(location, TODAY)).toBe(expected);
  });

  it.each<[string, UsageLocationRecord, string]>([
    [
      'no link',
      makeLocation({ updateMethod: UpdateMethodEnum.Online }),
      'Online',
    ],
    [
      'a saved link',
      makeLocation({
        updateMethod: UpdateMethodEnum.Online,
        link: 'https://example.com/account',
      }),
      'Online · link saved',
    ],
    [
      'a padded safe link',
      makeLocation({
        updateMethod: UpdateMethodEnum.Online,
        link: '  https://example.com/account  ',
      }),
      'Online · link saved',
    ],
    [
      'a javascript: link',
      makeLocation({
        updateMethod: UpdateMethodEnum.Online,
        // eslint-disable-next-line no-script-url -- deliberate unsafe-scheme fixture for issue #1281
        link: 'javascript:alert(1)',
      }),
      'Online',
    ],
    [
      'an https link missing its slashes',
      makeLocation({
        updateMethod: UpdateMethodEnum.Online,
        link: 'https:example.com',
      }),
      'Online',
    ],
  ])('formats the phone meta for %s', (_label, location, expected) => {
    expect(formatPlacePhoneMeta(location)).toBe(expected);
  });
});

describe('sortPlaces and filterPlaces', () => {
  it('puts places still to update first, most urgent first, then updated places in saved order', () => {
    const sorted = sortPlaces([
      makeLocation({ id: 'p1', changed: true, priority: PriorityEnum.High }),
      makeLocation({ id: 'p2', changed: false, priority: PriorityEnum.Low }),
      makeLocation({ id: 'p3', changed: false, priority: PriorityEnum.High }),
      makeLocation({ id: 'p4', changed: false, priority: PriorityEnum.Medium }),
      makeLocation({ id: 'p5', changed: true, priority: PriorityEnum.Low }),
      makeLocation({ id: 'p6', changed: false, priority: PriorityEnum.Normal }),
    ]);
    expect(ids(sorted)).toEqual(['p3', 'p4', 'p6', 'p2', 'p1', 'p5']);
  });

  it('keeps ties in saved order and leaves the input array unchanged', () => {
    const input = [
      makeLocation({ id: 'q1', changed: false, priority: PriorityEnum.Normal }),
      makeLocation({ id: 'q2', changed: true }),
      makeLocation({ id: 'q3', changed: false, priority: PriorityEnum.Normal }),
      makeLocation({ id: 'q4', changed: false, priority: PriorityEnum.High }),
      makeLocation({ id: 'q5', changed: true }),
    ];
    const before = ids(input);

    const sorted = sortPlaces(input);

    expect(ids(sorted)).toEqual(['q4', 'q1', 'q3', 'q2', 'q5']);
    expect(ids(input)).toEqual(before);
    expect(sorted).not.toBe(input);
  });

  it('keeps only places not yet updated for todo, and returns a copy for all', () => {
    const places = [
      makeLocation({ id: 'a', changed: false }),
      makeLocation({ id: 'b', changed: true }),
      makeLocation({ id: 'c', changed: false }),
    ];

    expect(ids(filterPlaces(places, 'todo'))).toEqual(['a', 'c']);

    const all = filterPlaces(places, 'all');
    expect(ids(all)).toEqual(['a', 'b', 'c']);
    expect(all).not.toBe(places);
  });
});
