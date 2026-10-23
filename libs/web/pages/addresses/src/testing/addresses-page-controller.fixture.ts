import {
  AddressStatusEnum,
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
  type AddressRecord,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';
// Imported explicitly: this file is type-checked by the lib tsconfig too,
// which carries no jest globals.
import { jest } from '@jest/globals';
import type { AddressesPageController } from '../hooks/use-addresses-page';
import type { AddAddressFormValues } from '../schemas/address';

export interface MakeAddressesPageControllerOptions {
  loading?: boolean;
}

/**
 * A complete `AddressesPageController` for component tests. Every action is a
 * `jest.fn` that resolves its success value, so a test overrides only the action
 * it asserts on, with `mockResolvedValue(false)` for example.
 */
export function makeAddressesPageController(
  items: AddressRecord[] = [],
  { loading = false }: MakeAddressesPageControllerOptions = {},
): AddressesPageController {
  return {
    items,
    loading,
    addAddress: jest.fn(async (values: AddAddressFormValues) =>
      makeAddressRecord({
        id: 'addr-new',
        label: values.label,
        propertyNumber: values.propertyNumber,
        street: values.street,
        suburb: values.suburb,
        state: values.state,
        zipCode: values.zipCode,
        country: 'Australia',
      }),
    ),
    updateAddress: jest.fn(async () => undefined),
    setAddressStatus: jest.fn(async () => true),
    deleteAddress: jest.fn(async () => true),
    saveLocation: jest.fn(async () => undefined),
    setLocationChanged: jest.fn(async () => true),
    deleteLocation: jest.fn(async () => true),
  };
}

/** A complete Address record; override only what a test asserts on. */
export function makeAddressRecord(
  overrides: Partial<AddressRecord> & Pick<AddressRecord, 'id' | 'label'>,
): AddressRecord {
  return {
    status: AddressStatusEnum.Current,
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
