import {
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
} from '@myorganiser/vault-core';

import {
  ORGANISATION_TYPE_LABELS,
  PRIORITY_LABELS,
  UPDATE_METHOD_LABELS,
  UPDATE_METHOD_OPTIONS,
} from './labels';

describe('vocabulary labels', () => {
  it('has a non-empty label for every organisation type', () => {
    expect(Object.keys(ORGANISATION_TYPE_LABELS).sort()).toEqual(
      Object.values(OrganisationTypeEnum).sort(),
    );
    for (const label of Object.values(ORGANISATION_TYPE_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('has a non-empty label for every update method', () => {
    expect(Object.keys(UPDATE_METHOD_LABELS).sort()).toEqual(
      Object.values(UpdateMethodEnum).sort(),
    );
    for (const label of Object.values(UPDATE_METHOD_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('has a non-empty label for every priority', () => {
    expect(Object.keys(PRIORITY_LABELS).sort()).toEqual(
      Object.values(PriorityEnum).sort(),
    );
    for (const label of Object.values(PRIORITY_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('orders update method segments Online, Phone, Mail, In person', () => {
    expect(UPDATE_METHOD_OPTIONS.map((option) => option.label)).toEqual([
      'Online',
      'Phone',
      'Mail',
      'In person',
    ]);
  });
});
