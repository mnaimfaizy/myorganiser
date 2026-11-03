import { describe, expect, it } from '@jest/globals';

import { localDateKey } from './localDateKey';

// This project's jest.global-setup.js pins the process timezone to
// Asia/Tokyo (UTC+9) before any test runs, specifically so the test below
// can tell local time from UTC apart.
describe('localDateKey', () => {
  it('zero-pads a single-digit month and day', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('keeps a just-after-midnight local time on its own local day, not the earlier UTC day', () => {
    const date = new Date(2026, 9, 22, 0, 1);

    // Confirms this instant really does fall on the previous UTC day, so
    // the assertion below only passes for an implementation reading local
    // getters rather than UTC ones (e.g. `toISOString`'s).
    expect(date.toISOString().slice(0, 10)).toBe('2026-10-21');
    expect(localDateKey(date)).toBe('2026-10-22');
  });
});
