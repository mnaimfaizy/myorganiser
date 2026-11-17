/**
 * Tests for deriveVaultHomeState and VAULT_HOME_WITHHELD_COPY.
 *
 * Pure derivation: no mocks. Covers the Local Vault status precedence, the
 * Vault Absent Evidence mapping for an `absent` device, and the rule that
 * `create` is reachable only from an absent device with a settled
 * `no-server-vault` answer.
 */

import type {
  LocalVaultStatus,
  VaultAbsentEvidence,
} from '@myorganiser/web-vault';

import {
  deriveVaultHomeState,
  VAULT_HOME_WITHHELD_COPY,
  type VaultHomeState,
} from './vaultHomeState';
import type { VaultAbsentEvidenceState } from './useVaultAbsentEvidence';
import {
  VAULT_ABSENT_EVIDENCE_CHECKING_VIEW,
  VAULT_ABSENT_EVIDENCE_GATE_VIEWS,
} from './vaultAbsentEvidenceGateView';

type SettledKind = VaultAbsentEvidence['kind'];

const CHECKING: VaultAbsentEvidenceState = { status: 'checking' };

const SETTLED_RESULTS: Record<SettledKind, VaultAbsentEvidence> = {
  'no-server-vault': { kind: 'no-server-vault' },
  'server-holds-vault': {
    kind: 'server-holds-vault',
    // Minimal stand-in: the derivation only reads `kind`, never `serverMeta`.
    serverMeta: {} as Extract<
      VaultAbsentEvidence,
      { kind: 'server-holds-vault' }
    >['serverMeta'],
  },
  postponed: { kind: 'postponed' },
  'session-lost': { kind: 'session-lost' },
};

const settled = (kind: SettledKind): VaultAbsentEvidenceState => ({
  status: 'settled',
  result: SETTLED_RESULTS[kind],
});

const SETTLED_KINDS = Object.keys(SETTLED_RESULTS) as SettledKind[];

const ABSENT_EVIDENCE_STATES: [string, VaultAbsentEvidenceState][] = [
  ['checking', CHECKING],
  ...SETTLED_KINDS.map(
    (kind) =>
      [`settled ${kind}`, settled(kind)] as [string, VaultAbsentEvidenceState],
  ),
];

const SHUT_LOCAL_STATUSES: LocalVaultStatus[] = [
  'owned',
  'unclaimed',
  'owner-mismatch',
];

const ALL_STATUSES: (LocalVaultStatus | null)[] = [
  null,
  'absent',
  ...SHUT_LOCAL_STATUSES,
];

describe('deriveVaultHomeState', () => {
  test.each(
    ABSENT_EVIDENCE_STATES.flatMap(([label, absentEvidence]) =>
      [true, false].map(
        (unlocked) => [label, unlocked, absentEvidence] as const,
      ),
    ),
  )(
    'no Vault Session (status null) is checking, given %s and unlocked=%s',
    (_label, unlocked, absentEvidence) => {
      expect(
        deriveVaultHomeState({ status: null, unlocked, absentEvidence }),
      ).toBe('checking');
    },
  );

  test.each([
    ['owned', 'checking', CHECKING],
    ['owned', 'settled no-server-vault', settled('no-server-vault')],
    ['absent', 'checking', CHECKING],
    ['absent', 'settled no-server-vault', settled('no-server-vault')],
    ['unclaimed', 'settled no-server-vault', settled('no-server-vault')],
  ] as [LocalVaultStatus, string, VaultAbsentEvidenceState][])(
    'an open Vault on %s status with %s absent evidence and unlocked=true is unlocked',
    (status, _label, absentEvidence) => {
      expect(
        deriveVaultHomeState({ status, unlocked: true, absentEvidence }),
      ).toBe('unlocked');
    },
  );

  test.each(
    SHUT_LOCAL_STATUSES.flatMap((status) =>
      [
        ['checking', CHECKING],
        ['settled no-server-vault', settled('no-server-vault')],
      ].map(
        ([label, absentEvidence]) => [status, label, absentEvidence] as const,
      ),
    ) as [LocalVaultStatus, string, VaultAbsentEvidenceState][],
  )(
    'a held but shut %s Vault is locked given %s absent evidence',
    (status, _label, absentEvidence) => {
      expect(
        deriveVaultHomeState({ status, unlocked: false, absentEvidence }),
      ).toBe('locked');
    },
  );

  test('an absent device whose server question is out is checking', () => {
    expect(
      deriveVaultHomeState({
        status: 'absent',
        unlocked: false,
        absentEvidence: CHECKING,
      }),
    ).toBe('checking');
  });

  test.each([
    ['no-server-vault', 'create'],
    ['server-holds-vault', 'server-holds-vault'],
    ['postponed', 'postponed'],
    ['session-lost', 'session-lost'],
  ] as [SettledKind, VaultHomeState][])(
    'an absent device with settled %s evidence is %s',
    (kind, expected) => {
      expect(
        deriveVaultHomeState({
          status: 'absent',
          unlocked: false,
          absentEvidence: settled(kind),
        }),
      ).toBe(expected);
    },
  );

  test("'create' is returned only for absent + locked + settled no-server-vault", () => {
    const creators: unknown[] = [];
    for (const status of ALL_STATUSES) {
      for (const unlocked of [true, false]) {
        for (const [label, absentEvidence] of ABSENT_EVIDENCE_STATES) {
          const state = deriveVaultHomeState({
            status,
            unlocked,
            absentEvidence,
          });
          if (state === 'create') creators.push([status, unlocked, label]);
        }
      }
    }
    expect(creators).toEqual([['absent', false, 'settled no-server-vault']]);
  });
});

describe('VAULT_HOME_WITHHELD_COPY', () => {
  test.each(['server-holds-vault', 'postponed', 'session-lost'] as const)(
    'settled %s copy is read from the vault page gate view',
    (kind) => {
      const view = VAULT_ABSENT_EVIDENCE_GATE_VIEWS[kind];
      const copy = VAULT_HOME_WITHHELD_COPY[kind];
      expect(view.kind).not.toBe('vault-status');
      expect(copy.title).toBe(view.title);
      expect(copy.description).toBe(view.description);
    },
  );

  test('checking copy is the shared checking view, pinned to the exact sentence', () => {
    expect(VAULT_HOME_WITHHELD_COPY.checking).toEqual(
      VAULT_ABSENT_EVIDENCE_CHECKING_VIEW,
    );
    expect(VAULT_ABSENT_EVIDENCE_CHECKING_VIEW.title).toBe(
      'Checking for your vault',
    );
    expect(VAULT_HOME_WITHHELD_COPY.checking.description).toBe(
      'Checking whether your vault is already on the server…',
    );
  });

  test('no withheld title or description tells the User they are locked out', () => {
    for (const copy of Object.values(VAULT_HOME_WITHHELD_COPY)) {
      expect(copy.title).not.toMatch(/lock/i);
      expect(copy.description).not.toMatch(/lock/i);
    }
  });
});

describe('deriveVaultHomeState agrees with VAULT_ABSENT_EVIDENCE_GATE_VIEWS on create', () => {
  test.each(SETTLED_KINDS)(
    'settled %s: Home offers create exactly when its gate view is vault-status',
    (kind) => {
      const state = deriveVaultHomeState({
        status: 'absent',
        unlocked: false,
        absentEvidence: settled(kind),
      });
      const gateIsOrdinary =
        VAULT_ABSENT_EVIDENCE_GATE_VIEWS[kind].kind === 'vault-status';
      expect(state === 'create').toBe(gateIsOrdinary);
    },
  );
});
