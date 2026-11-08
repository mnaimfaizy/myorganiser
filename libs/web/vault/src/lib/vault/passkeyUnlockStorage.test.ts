/**
 * Tests for Passkey Unlock storage primitives (ADR 0136).
 *
 * Covers the per-owner wrapping record (key composition, round-trip, owner
 * isolation, corrupt-entry handling, removal) and the per-owner offer record.
 * A corrupt or mis-keyed entry reads as "not enrolled" / "not offered", never
 * as another User's record. localStorage only.
 */

import {
  PASSKEY_UNLOCK_OFFER_RECORD_VERSION,
  PASSKEY_UNLOCK_RECORD_VERSION,
  PASSKEY_UNLOCK_STORAGE_KEY,
  readPasskeyUnlockOffered,
  readPasskeyUnlockRecord,
  removePasskeyUnlockOffered,
  removePasskeyUnlockRecord,
  writePasskeyUnlockOffered,
  writePasskeyUnlockRecord,
  type PasskeyUnlockRecord,
} from './passkeyUnlockStorage';

const OWNER_GUARD_MESSAGE =
  'Passkey Unlock cannot be resolved without an owner';

const WRAPPING_KEY_PREFIX = 'myorganiser_passkey_unlock_v1';
const OFFER_KEY_PREFIX = 'myorganiser_passkey_unlock_offer_v1';

function validRecord(owner: string): PasskeyUnlockRecord {
  return {
    version: PASSKEY_UNLOCK_RECORD_VERSION,
    owner,
    credentialId: 'Y3JlZC1pZA==',
    prfSalt: 'c2FsdC1ieXRlcw==',
    wrappedMasterKey: { iv: 'aXYtYnl0ZXM=', ciphertext: 'Y2lwaGVydGV4dA==' },
  };
}

function writeWrappingRecordFor(owner: string): void {
  writePasskeyUnlockRecord({
    owner,
    credentialId: 'Y3JlZC1pZA==',
    prfSalt: 'c2FsdC1ieXRlcw==',
    wrappedMasterKey: { iv: 'aXYtYnl0ZXM=', ciphertext: 'Y2lwaGVydGV4dA==' },
  });
}

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('passkeyUnlockStorage — Passkey Unlock storage primitives', () => {
  describe('wrapping record — key composition and round-trip', () => {
    test('1: writes under myorganiser_passkey_unlock_v1:<owner> and reads back the same record', () => {
      writeWrappingRecordFor('user-a');

      const raw = localStorage.getItem(`${WRAPPING_KEY_PREFIX}:user-a`);
      expect(raw).not.toBeNull();
      expect(PASSKEY_UNLOCK_STORAGE_KEY).toBe(WRAPPING_KEY_PREFIX);

      expect(readPasskeyUnlockRecord('user-a')).toEqual(validRecord('user-a'));
    });

    test('2: a second write replaces the first enrolment for the same owner', () => {
      writeWrappingRecordFor('user-a');
      writePasskeyUnlockRecord({
        owner: 'user-a',
        credentialId: 'c2Vjb25kLWNyZWQ=',
        prfSalt: 'c2FsdC0y',
        wrappedMasterKey: { iv: 'aXYtMg==', ciphertext: 'Y3QtMg==' },
      });

      expect(readPasskeyUnlockRecord('user-a')).toEqual({
        version: PASSKEY_UNLOCK_RECORD_VERSION,
        owner: 'user-a',
        credentialId: 'c2Vjb25kLWNyZWQ=',
        prfSalt: 'c2FsdC0y',
        wrappedMasterKey: { iv: 'aXYtMg==', ciphertext: 'Y3QtMg==' },
      });
    });

    test('3: stored value carries only the wrapping fields, no plaintext key material', () => {
      writeWrappingRecordFor('user-a');

      const raw = localStorage.getItem(`${WRAPPING_KEY_PREFIX}:user-a`);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(
        [
          'credentialId',
          'owner',
          'prfSalt',
          'version',
          'wrappedMasterKey',
        ].sort(),
      );
      expect(parsed).not.toHaveProperty('masterKey');
    });

    test('4: returns undefined when the owner has no entry', () => {
      expect(readPasskeyUnlockRecord('user-a')).toBeUndefined();
    });
  });

  describe('wrapping record — owner isolation', () => {
    test('5: owner A record is not readable as owner B', () => {
      writeWrappingRecordFor('user-a');

      expect(readPasskeyUnlockRecord('user-b')).toBeUndefined();
    });

    test('6: an entry under B key naming A in its value reads as undefined for B', () => {
      localStorage.setItem(
        `${WRAPPING_KEY_PREFIX}:user-b`,
        JSON.stringify(validRecord('user-a')),
      );

      expect(readPasskeyUnlockRecord('user-b')).toBeUndefined();
      expect(readPasskeyUnlockRecord('user-a')).toBeUndefined();
    });
  });

  describe('owner guard — empty or whitespace owner throws on every entry point', () => {
    test.each(['', '   '])(
      '7: throws for read, write, and remove of both kinds when owner is %j',
      (owner) => {
        expect(() => readPasskeyUnlockRecord(owner)).toThrow(
          OWNER_GUARD_MESSAGE,
        );
        expect(() =>
          writePasskeyUnlockRecord({
            owner,
            credentialId: 'Y3JlZA==',
            prfSalt: 'c2FsdA==',
            wrappedMasterKey: { iv: 'aXY=', ciphertext: 'Y3Q=' },
          }),
        ).toThrow(OWNER_GUARD_MESSAGE);
        expect(() => removePasskeyUnlockRecord(owner)).toThrow(
          OWNER_GUARD_MESSAGE,
        );
        expect(() => readPasskeyUnlockOffered(owner)).toThrow(
          OWNER_GUARD_MESSAGE,
        );
        expect(() => writePasskeyUnlockOffered(owner)).toThrow(
          OWNER_GUARD_MESSAGE,
        );
        expect(() => removePasskeyUnlockOffered(owner)).toThrow(
          OWNER_GUARD_MESSAGE,
        );
      },
    );
  });

  describe('wrapping record — corrupt entries read as undefined', () => {
    const valid = validRecord('user-a');

    test.each([
      ['non-JSON text', '{not json'],
      ['JSON null', 'null'],
      ['wrong version', JSON.stringify({ ...valid, version: 2 })],
      [
        'missing credentialId',
        JSON.stringify({ ...valid, credentialId: undefined }),
      ],
      ['empty credentialId', JSON.stringify({ ...valid, credentialId: '' })],
      ['missing prfSalt', JSON.stringify({ ...valid, prfSalt: undefined })],
      ['empty prfSalt', JSON.stringify({ ...valid, prfSalt: '' })],
      [
        'null wrappedMasterKey',
        JSON.stringify({ ...valid, wrappedMasterKey: null }),
      ],
      [
        'missing wrappedMasterKey.iv',
        JSON.stringify({ ...valid, wrappedMasterKey: { ciphertext: 'Y3Q=' } }),
      ],
      [
        'empty wrappedMasterKey.iv',
        JSON.stringify({
          ...valid,
          wrappedMasterKey: { iv: '', ciphertext: 'Y3Q=' },
        }),
      ],
      [
        'missing wrappedMasterKey.ciphertext',
        JSON.stringify({ ...valid, wrappedMasterKey: { iv: 'aXY=' } }),
      ],
      [
        'empty wrappedMasterKey.ciphertext',
        JSON.stringify({
          ...valid,
          wrappedMasterKey: { iv: 'aXY=', ciphertext: '' },
        }),
      ],
    ])('8: %s reads as undefined', (_label, raw) => {
      localStorage.setItem(`${WRAPPING_KEY_PREFIX}:user-a`, raw);

      expect(readPasskeyUnlockRecord('user-a')).toBeUndefined();
    });
  });

  describe('wrapping record — removal', () => {
    test('9: removes only the given owner record', () => {
      writeWrappingRecordFor('user-a');
      writeWrappingRecordFor('user-b');
      const userBBefore = localStorage.getItem(`${WRAPPING_KEY_PREFIX}:user-b`);

      removePasskeyUnlockRecord('user-a');

      expect(readPasskeyUnlockRecord('user-a')).toBeUndefined();
      expect(localStorage.getItem(`${WRAPPING_KEY_PREFIX}:user-a`)).toBeNull();
      expect(localStorage.getItem(`${WRAPPING_KEY_PREFIX}:user-b`)).toBe(
        userBBefore,
      );
      expect(readPasskeyUnlockRecord('user-b')).toEqual(validRecord('user-b'));
    });
  });

  describe('offer record — Passkey Unlock offered', () => {
    test('10: reads false when no offer record exists', () => {
      expect(readPasskeyUnlockOffered('user-a')).toBe(false);
    });

    test.each([
      ['non-JSON text', '{nope'],
      ['JSON null', 'null'],
      ['a JSON string', '"offered"'],
      ['wrong version', JSON.stringify({ version: 2, owner: 'user-a' })],
      [
        'owner mismatch in value',
        JSON.stringify({
          version: PASSKEY_UNLOCK_OFFER_RECORD_VERSION,
          owner: 'user-b',
        }),
      ],
    ])('11: reads false when the entry is %s', (_label, raw) => {
      localStorage.setItem(`${OFFER_KEY_PREFIX}:user-a`, raw);

      expect(readPasskeyUnlockOffered('user-a')).toBe(false);
    });

    test('12: reads true after writePasskeyUnlockOffered, under the offer key', () => {
      writePasskeyUnlockOffered('user-a');

      expect(readPasskeyUnlockOffered('user-a')).toBe(true);
      expect(localStorage.getItem(`${OFFER_KEY_PREFIX}:user-a`)).not.toBeNull();
    });

    test('13: removePasskeyUnlockOffered clears the offer for that owner', () => {
      writePasskeyUnlockOffered('user-a');

      removePasskeyUnlockOffered('user-a');

      expect(readPasskeyUnlockOffered('user-a')).toBe(false);
      expect(localStorage.getItem(`${OFFER_KEY_PREFIX}:user-a`)).toBeNull();
    });

    test('14: the offer is isolated per owner and does not touch the wrapping record', () => {
      writePasskeyUnlockOffered('user-a');
      writeWrappingRecordFor('user-b');

      expect(readPasskeyUnlockOffered('user-b')).toBe(false);
      expect(readPasskeyUnlockRecord('user-a')).toBeUndefined();

      removePasskeyUnlockOffered('user-b');

      expect(readPasskeyUnlockOffered('user-a')).toBe(true);
      expect(readPasskeyUnlockRecord('user-b')).toEqual(validRecord('user-b'));
    });
  });

  describe('unreadable storage — a refusing read reads as not enrolled and not offered', () => {
    test('15: readPasskeyUnlockRecord is undefined when localStorage.getItem throws', () => {
      writeWrappingRecordFor('user-a');
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });

      expect(readPasskeyUnlockRecord('user-a')).toBeUndefined();
    });

    test('16: readPasskeyUnlockOffered is false when localStorage.getItem throws', () => {
      writePasskeyUnlockOffered('user-a');
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });

      expect(readPasskeyUnlockOffered('user-a')).toBe(false);
    });
  });
});
