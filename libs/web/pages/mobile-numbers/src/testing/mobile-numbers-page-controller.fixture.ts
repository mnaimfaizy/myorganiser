import {
  type MobileNumberRecord,
  OrganisationTypeEnum,
  PriorityEnum,
  type UsageLocationRecord,
  UpdateMethodEnum,
} from '@myorganiser/vault-core';
// Imported explicitly: this file is type-checked by the lib tsconfig too,
// which carries no jest globals.
import { jest } from '@jest/globals';
import type { MobileNumbersPageController } from '../hooks/use-mobile-numbers-page';
import type { AddMobileNumberFormValues } from '../schemas/mobileNumber';

export interface MakeMobileNumbersPageControllerOptions {
  loading?: boolean;
}

/**
 * A complete `MobileNumbersPageController` for component tests. Every action is
 * a `jest.fn` that resolves its success value, so a test overrides only the
 * action it asserts on, with `mockResolvedValue(false)` for example.
 */
export function makeMobileNumbersPageController(
  items: MobileNumberRecord[] = [],
  { loading = false }: MakeMobileNumbersPageControllerOptions = {},
): MobileNumbersPageController {
  return {
    items,
    loading,
    addMobileNumber: jest.fn(
      async (_values: AddMobileNumberFormValues) => undefined,
    ),
    updateMobileNumber: jest.fn(async () => undefined),
    deleteMobileNumber: jest.fn(async () => true),
    saveLocation: jest.fn(async () => undefined),
    setLocationChanged: jest.fn(async () => true),
    deleteLocation: jest.fn(async () => true),
  };
}

/** A complete Mobile Number record; override only what a test asserts on. */
export function makeMobileNumberRecord(
  overrides: Partial<MobileNumberRecord> &
    Pick<MobileNumberRecord, 'id' | 'label'>,
): MobileNumberRecord {
  return {
    countryCode: '+61',
    phoneNumber: '412345678',
    usageLocations: [],
    createdAt: '2026-01-15T09:00:00.000Z',
    ...overrides,
  };
}

/** A Usage Location record; `changed` says whether its checklist line is ticked. */
export function makeUsageLocationRecord(
  id: string,
  changed: boolean,
): UsageLocationRecord {
  return {
    id,
    organisationName: `Place ${id}`,
    organisationType: OrganisationTypeEnum.Government,
    updateMethod: UpdateMethodEnum.Online,
    changed,
    priority: PriorityEnum.Normal,
    createdAt: '2026-01-15T09:00:00.000Z',
  };
}
