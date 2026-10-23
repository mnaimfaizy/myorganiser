import { AdminAuditAction } from '@myorganiser/app-api-client';

import {
  arePlacesLow,
  AUDIT_ACTION_TONE,
  attentionTone,
  deriveAttentionRows,
  desktopAttentionCopy,
  phoneAttentionCopy,
  phonePlacesLeftNote,
  phoneUnverifiedNote,
  placesLeftNote,
  platformAdminsNote,
  unverifiedOverWeekNote,
  usersJoinedNote,
  type AttentionRow,
} from './overview';

const ZERO_OVERVIEW = {
  users: 0,
  usersJoinedLast7Days: 0,
  platformAdmins: 0,
  unverified: 0,
  unverifiedOverAWeek: 0,
  disabled: 0,
  youtubeAccessPlacesUsed: 0,
  youtubeAccessPlacesLeft: 0,
  youtubeAccessCeiling: 0,
  feedbackReportsReceived: 0,
};

const ADR_0129_SENTENCE = 'Withdraw unused access to free one';

describe('arePlacesLow', () => {
  it('is true at exactly a quarter of the ceiling', () => {
    expect(
      arePlacesLow({ youtubeAccessPlacesLeft: 25, youtubeAccessCeiling: 100 }),
    ).toBe(true);
  });

  it('is false just above a quarter of the ceiling', () => {
    expect(
      arePlacesLow({ youtubeAccessPlacesLeft: 26, youtubeAccessCeiling: 100 }),
    ).toBe(false);
  });

  it('is false when the ceiling is zero', () => {
    expect(
      arePlacesLow({ youtubeAccessPlacesLeft: 0, youtubeAccessCeiling: 0 }),
    ).toBe(false);
  });
});

describe('deriveAttentionRows', () => {
  it('gives no rows for the all-zero overview', () => {
    expect(deriveAttentionRows(ZERO_OVERVIEW)).toEqual([]);
  });

  it('orders unverified, then places, then disabled when all apply', () => {
    const rows = deriveAttentionRows({
      ...ZERO_OVERVIEW,
      unverifiedOverAWeek: 2,
      disabled: 1,
      youtubeAccessPlacesLeft: 5,
      youtubeAccessCeiling: 25,
    });

    expect(rows).toEqual([
      { id: 'unverified', count: 2 },
      { id: 'places', left: 5, ceiling: 25 },
      { id: 'disabled', count: 1 },
    ]);
  });

  it('shows only the places row when only places are low', () => {
    const rows = deriveAttentionRows({
      ...ZERO_OVERVIEW,
      youtubeAccessPlacesLeft: 5,
      youtubeAccessCeiling: 25,
    });

    expect(rows).toEqual([{ id: 'places', left: 5, ceiling: 25 }]);
  });
});

describe('attention copy', () => {
  it('uses singular and plural account wording for unverified and disabled rows', () => {
    expect(desktopAttentionCopy({ id: 'unverified', count: 1 }).title).toBe(
      '1 account unverified for over a week',
    );
    expect(desktopAttentionCopy({ id: 'unverified', count: 3 }).title).toBe(
      '3 accounts unverified for over a week',
    );
    expect(desktopAttentionCopy({ id: 'disabled', count: 1 }).title).toBe(
      '1 account disabled',
    );
    expect(desktopAttentionCopy({ id: 'disabled', count: 2 }).title).toBe(
      '2 accounts disabled',
    );
  });

  it('gives the desktop places copy with its detail and action', () => {
    expect(
      desktopAttentionCopy({ id: 'places', left: 7, ceiling: 25 }),
    ).toEqual({
      title: 'YouTube Access places running low',
      detail: '7 of 25 left.',
      action: 'See holders',
    });
  });

  it('gives the phone copy for each row without an action text', () => {
    expect(phoneAttentionCopy({ id: 'unverified', count: 3 })).toEqual({
      title: '3 unverified over a week',
      detail: 'They cannot sign in yet',
    });
    expect(phoneAttentionCopy({ id: 'places', left: 7, ceiling: 25 })).toEqual({
      title: 'YouTube places running low',
      detail: '7 of 25 left',
    });
  });

  it('never shows the withdraw sentence that ADR 0129 forbids, in any row', () => {
    const rows: AttentionRow[] = [
      { id: 'unverified', count: 1 },
      { id: 'places', left: 7, ceiling: 25 },
      { id: 'disabled', count: 1 },
    ];

    for (const row of rows) {
      const desktop = desktopAttentionCopy(row);
      const phone = phoneAttentionCopy(row);
      const text = [
        desktop.title,
        desktop.detail,
        desktop.action,
        phone.title,
        phone.detail,
      ].join(' ');

      expect(text).not.toContain(ADR_0129_SENTENCE);
    }
  });

  it('tones disabled as danger and the other rows as warning', () => {
    expect(attentionTone({ id: 'disabled', count: 1 })).toBe('danger');
    expect(attentionTone({ id: 'unverified', count: 1 })).toBe('warning');
    expect(attentionTone({ id: 'places', left: 1, ceiling: 25 })).toBe(
      'warning',
    );
  });
});

describe('stat notes', () => {
  it('gives the platform admins note from the total count', () => {
    expect(platformAdminsNote(0)).toBeNull();
    expect(platformAdminsNote(1)).toBeNull();
    expect(platformAdminsNote(2)).toBe('You and 1 other');
    expect(platformAdminsNote(3)).toBe('You and 2 others');
  });

  it('gives the joined, unverified and places notes for desktop and phone', () => {
    expect(usersJoinedNote(3)).toBe('+3 this week');
    expect(unverifiedOverWeekNote(4)).toBe('4 for more than 7 days');
    expect(placesLeftNote(7)).toBe('7 left · a first grant uses one');
    expect(phoneUnverifiedNote(4)).toBe('4 over a week');
    expect(phonePlacesLeftNote(7)).toBe('7 left');
  });
});

describe('AUDIT_ACTION_TONE', () => {
  it('has a tone for every audit action', () => {
    expect(Object.keys(AUDIT_ACTION_TONE).sort()).toEqual(
      Object.values(AdminAuditAction).sort(),
    );
  });

  it('gives a representative tone per category', () => {
    expect(AUDIT_ACTION_TONE[AdminAuditAction.Disable]).toBe('danger');
    expect(AUDIT_ACTION_TONE[AdminAuditAction.Promote]).toBe('trust');
    expect(AUDIT_ACTION_TONE[AdminAuditAction.ForceLogout]).toBe('warning');
    expect(AUDIT_ACTION_TONE[AdminAuditAction.YoutubeAccessGrant]).toBe(
      'brand',
    );
    expect(AUDIT_ACTION_TONE[AdminAuditAction.ResendVerification]).toBe(
      'neutral',
    );
  });
});
