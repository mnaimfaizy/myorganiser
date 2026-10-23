import {
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
  type MobileNumberRecord,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';

import { countryNameForCode } from '../data/countryCodes';
import {
  describeMobileDangerZone,
  describeMobileNumberDeletion,
  filterMobileNumbers,
  formatMobileNumbersPhoneSummary,
  formatMobileNumbersSummary,
  formatMobileUpdatedLine,
  mobilePlaceStatus,
  smsHref,
  telHref,
} from './mobile-summary';

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

function makeMobileNumber(
  overrides: Partial<MobileNumberRecord> = {},
): MobileNumberRecord {
  return {
    id: 'mn',
    label: 'Personal',
    countryCode: '+61',
    phoneNumber: '412345678',
    usageLocations: [],
    createdAt: isoOn(2026, 0, 1),
    ...overrides,
  };
}

const NUMBER_ALL_DONE = makeMobileNumber({
  id: 'all-done',
  usageLocations: [makeLocation({ id: 'done', changed: true })],
});
const NUMBER_NO_PLACES = makeMobileNumber({ id: 'no-places' });
const NUMBER_ONE_OPEN = makeMobileNumber({
  id: 'one-open',
  usageLocations: [makeLocation({ id: 'open-1' })],
});
const NUMBER_TWO_OPEN = makeMobileNumber({
  id: 'two-open',
  usageLocations: [
    makeLocation({ id: 'open-2' }),
    makeLocation({ id: 'open-3' }),
  ],
});

const PERSONAL = makeMobileNumber({
  id: 'personal',
  label: 'Personal',
  countryCode: '+61',
  phoneNumber: '412345678',
});
const WORK = makeMobileNumber({
  id: 'work',
  label: 'Work',
  countryCode: '+1',
  phoneNumber: '4155550100',
});

describe('formatMobileNumbersSummary', () => {
  it.each([
    ['no numbers', [], '0 numbers · 0 places still to update'],
    [
      'one number with every place updated',
      [NUMBER_ALL_DONE],
      '1 number · 0 places still to update',
    ],
    [
      'two numbers with one place still open',
      [NUMBER_NO_PLACES, NUMBER_ONE_OPEN],
      '2 numbers · 1 place still to update',
    ],
    [
      'one number with two places still open',
      [NUMBER_TWO_OPEN],
      '1 number · 2 places still to update',
    ],
  ])('%s', (_label, items, expected) => {
    expect(formatMobileNumbersSummary(items)).toBe(expected);
  });
});

describe('formatMobileNumbersPhoneSummary', () => {
  it.each([
    ['no numbers', [], '0 saved · 0 places to update'],
    [
      'one number with every place updated',
      [NUMBER_ALL_DONE],
      '1 saved · 0 places to update',
    ],
    [
      'two numbers with one place still open',
      [NUMBER_NO_PLACES, NUMBER_ONE_OPEN],
      '2 saved · 1 place to update',
    ],
    [
      'one number with two places still open',
      [NUMBER_TWO_OPEN],
      '1 saved · 2 places to update',
    ],
  ])('%s', (_label, items, expected) => {
    expect(formatMobileNumbersPhoneSummary(items)).toBe(expected);
  });
});

describe('filterMobileNumbers', () => {
  const items = [PERSONAL, WORK];

  it('returns a copy of every number for a blank query', () => {
    const result = filterMobileNumbers(items, '   ');

    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });

  it.each([
    ['a label, ignoring case', 'WORK', ['Work']],
    ['the formatted number', '+61 412', ['Personal']],
    ['spaced digits from the formatted number', '412 345', ['Personal']],
    ['digits that ignore the formatting', '412345', ['Personal']],
    ['digits from the other number', '415555', ['Work']],
  ])('matches %s', (_label, query, expectedLabels) => {
    expect(filterMobileNumbers(items, query).map((m) => m.label)).toEqual(
      expectedLabels,
    );
  });

  it.each([
    ['text that matches no label or number', 'zzz'],
    ['digits that match no number', '999'],
  ])('excludes %s', (_label, query) => {
    expect(filterMobileNumbers(items, query)).toEqual([]);
  });
});

describe('mobilePlaceStatus', () => {
  it.each([
    [
      'no places',
      makeMobileNumber({ usageLocations: [] }),
      { label: 'No places', tone: 'neutral' },
    ],
    [
      'every place updated',
      makeMobileNumber({
        usageLocations: [
          makeLocation({ id: 'a', changed: true }),
          makeLocation({ id: 'b', changed: true }),
        ],
      }),
      { label: 'All 2 updated', tone: 'success' },
    ],
    [
      'some places still open',
      makeMobileNumber({
        usageLocations: [
          makeLocation({ id: 'a', changed: true }),
          makeLocation({ id: 'b', changed: false }),
          makeLocation({ id: 'c', changed: false }),
        ],
      }),
      { label: '1 of 3 places updated', tone: 'warning' },
    ],
  ])('shows %s', (_label, item, expected) => {
    expect(mobilePlaceStatus(item)).toEqual(expected);
  });
});

describe('describeMobileNumberDeletion', () => {
  it.each([
    [
      'no places',
      0,
      'This action cannot be undone. The mobile number will be permanently removed.',
    ],
    [
      'one place',
      1,
      'This action cannot be undone. The mobile number and its 1 usage location will be permanently removed.',
    ],
    [
      'several places',
      2,
      'This action cannot be undone. The mobile number and its 2 usage locations will be permanently removed.',
    ],
  ])('describes deletion with %s', (_label, count, expected) => {
    const item = makeMobileNumber({
      usageLocations: Array.from({ length: count }, (_, i) =>
        makeLocation({ id: `loc-${i}` }),
      ),
    });

    expect(describeMobileNumberDeletion(item)).toBe(expected);
  });
});

describe('describeMobileDangerZone', () => {
  it.each([
    ['no places', 0, 'It is removed from every device.'],
    ['one place', 1, 'Its 1 place goes with it, on every device.'],
    ['several places', 2, 'Its 2 places go with it, on every device.'],
  ])('describes the danger zone with %s', (_label, count, expected) => {
    const item = makeMobileNumber({
      usageLocations: Array.from({ length: count }, (_, i) =>
        makeLocation({ id: `loc-${i}` }),
      ),
    });

    expect(describeMobileDangerZone(item)).toBe(expected);
  });
});

describe('formatMobileUpdatedLine', () => {
  it.each([
    [
      'the country and the update day this year',
      makeMobileNumber({
        countryCode: '+61',
        updatedAt: isoOn(2026, 9, 3),
      }),
      'Australia · updated 3 Oct',
    ],
    [
      'the date added when it was never updated',
      makeMobileNumber({
        countryCode: '+61',
        createdAt: isoOn(2026, 8, 1),
      }),
      'Australia · added 1 Sep',
    ],
    [
      'the update day in preference to the date added',
      makeMobileNumber({
        countryCode: '+61',
        createdAt: isoOn(2026, 8, 1),
        updatedAt: isoOn(2026, 9, 3),
      }),
      'Australia · updated 3 Oct',
    ],
    [
      'the year on a day from another year',
      makeMobileNumber({
        countryCode: '+61',
        updatedAt: isoOn(2025, 9, 3),
      }),
      'Australia · updated 3 Oct 2025',
    ],
    [
      'a capitalised line without the country for a legacy number',
      makeMobileNumber({
        countryCode: undefined,
        phoneNumber: undefined,
        mobileNumber: '+61 412 345 678',
        updatedAt: isoOn(2026, 9, 3),
      }),
      'Updated 3 Oct',
    ],
    [
      'a capitalised line without the country for an unknown calling code',
      makeMobileNumber({
        countryCode: '+999',
        updatedAt: isoOn(2026, 9, 3),
      }),
      'Updated 3 Oct',
    ],
    [
      'the country alone when no date is stored',
      makeMobileNumber({ countryCode: '+61', createdAt: '' }),
      'Australia',
    ],
    [
      'nothing when neither the country nor a date is known',
      makeMobileNumber({ countryCode: '+999', createdAt: '' }),
      '',
    ],
    [
      'the date added when the update stamp is empty',
      makeMobileNumber({
        countryCode: '+61',
        updatedAt: '',
        createdAt: isoOn(2026, 8, 1),
      }),
      'Australia · added 1 Sep',
    ],
  ])('shows %s', (_label, item, expected) => {
    expect(formatMobileUpdatedLine(item, TODAY)).toBe(expected);
  });
});

describe('countryNameForCode', () => {
  it.each([
    ['a single country', '+61', 'Australia'],
    ['a code shared by two countries', '+1', 'United States / Canada'],
    ['a code outside the list', '+999', undefined],
  ])('names %s', (_label, code, expected) => {
    expect(countryNameForCode(code)).toBe(expected);
  });
});

describe('telHref and smsHref', () => {
  it.each([
    [
      'a structured number, keeping the country code and digits only',
      makeMobileNumber({ countryCode: '+61', phoneNumber: '412 345 678' }),
      'tel:+61412345678',
      'sms:+61412345678',
    ],
    [
      'a legacy number, keeping only the plus sign and digits',
      makeMobileNumber({
        countryCode: undefined,
        phoneNumber: undefined,
        mobileNumber: '+61 (0) 412-345',
      }),
      'tel:+610412345',
      'sms:+610412345',
    ],
    [
      'a number with no dialable digits, giving no link',
      makeMobileNumber({
        countryCode: undefined,
        phoneNumber: undefined,
        mobileNumber: undefined,
      }),
      null,
      null,
    ],
  ])('dials %s', (_label, item, tel, sms) => {
    expect(telHref(item)).toBe(tel);
    expect(smsHref(item)).toBe(sms);
  });
});
