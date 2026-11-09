import { localDateKey } from '@myorganiser/core/portable';
import { toCalendarDate } from './calendarDate';
import { localDateOnlyString } from './taskModel';

// Both helpers must key a Date to the same local calendar day as the shared
// `localDateKey`. Dates are built from local components, so the expected
// strings hold in any TZ.
const cases: Array<[string, Date, string]> = [
  ['local midnight new year', new Date(2026, 0, 1, 0, 0, 0, 0), '2026-01-01'],
  [
    'last millisecond of the year',
    new Date(2025, 11, 31, 23, 59, 59, 999),
    '2025-12-31',
  ],
  [
    'one millisecond before local midnight',
    new Date(new Date(2026, 0, 1, 0, 0, 0, 0).getTime() - 1),
    '2025-12-31',
  ],
  [
    'last millisecond of February in a common year',
    new Date(2026, 1, 28, 23, 59, 59, 999),
    '2026-02-28',
  ],
  [
    'March 1 after a common February',
    new Date(2027, 2, 1, 0, 0, 0, 0),
    '2027-03-01',
  ],
  ['leap day', new Date(2028, 1, 29, 0, 0, 0, 0), '2028-02-29'],
  [
    'single-digit month and day',
    new Date(2026, 8, 9, 0, 0, 0, 0),
    '2026-09-09',
  ],
  [
    'last day of December',
    new Date(2026, 11, 31, 23, 59, 59, 999),
    '2026-12-31',
  ],
];

describe('localDateKey parity for calendar helpers', () => {
  it.each(cases)(
    'keys %s to the local calendar day',
    (_label, date, expected) => {
      expect(localDateKey(date)).toBe(expected);
      expect(toCalendarDate(date)).toBe(localDateKey(date));
      expect(localDateOnlyString(date)).toBe(localDateKey(date));
    },
  );

  it.each(cases)(
    'agrees with the expected literal for %s',
    (_label, date, expected) => {
      expect(toCalendarDate(date)).toBe(expected);
      expect(localDateOnlyString(date)).toBe(expected);
    },
  );
});
