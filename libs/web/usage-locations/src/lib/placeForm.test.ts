import type { UsageLocationRecord } from '@myorganiser/vault-core';

import {
  normalizeOrganisationName,
  PLACE_FORM_DEFAULTS,
  placeFormSchema,
  usageLocationFormValuesToRecordFields,
  usageLocationRecordToFormValues,
} from './placeForm';

const VALID_FORM = {
  orgName: 'Commonwealth Bank',
  orgType: 'bank',
  updateMethod: 'online',
  priority: 'normal',
  link: '',
  changed: false,
};

const RECORD: UsageLocationRecord = {
  id: 'loc-1',
  organisationName: 'Commonwealth Bank',
  organisationType: 'bank',
  updateMethod: 'phone',
  priority: 'high',
  changed: true,
  link: 'https://bank.example/update-details',
  createdAt: '2026-01-01T00:00:00.000Z',
  changedAt: '2026-02-01T00:00:00.000Z',
};

describe('normalizeOrganisationName', () => {
  it('folds case, punctuation and surrounding whitespace so equivalent names compare equal', () => {
    expect(normalizeOrganisationName('  Comm-Bank ')).toBe(
      normalizeOrganisationName('comm bank'),
    );
    expect(normalizeOrganisationName('  Comm-Bank ')).toBe('comm bank');
  });

  it('folds a mid-word accent so accented and plain spellings normalise equal', () => {
    expect(normalizeOrganisationName('Bär')).toBe(
      normalizeOrganisationName('bar'),
    );
    expect(normalizeOrganisationName('Crédit Agricole')).toBe(
      normalizeOrganisationName('credit agricole'),
    );
  });

  it('folds a trailing accent so an accented name matches its plain spelling', () => {
    expect(normalizeOrganisationName('Café')).toBe(
      normalizeOrganisationName('Cafe'),
    );
  });

  it('treats an absent name as empty', () => {
    expect(normalizeOrganisationName(undefined)).toBe('');
  });
});

describe('placeFormSchema', () => {
  it('accepts a complete form with no link', () => {
    expect(placeFormSchema.safeParse(VALID_FORM).success).toBe(true);
  });

  it('rejects an empty organisation name with the required message', () => {
    const result = placeFormSchema.safeParse({ ...VALID_FORM, orgName: '' });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['orgName'],
        message: 'Organisation name is required',
      }),
    ]);
  });

  it('rejects a link without an http or https scheme', () => {
    const result = placeFormSchema.safeParse({
      ...VALID_FORM,
      link: 'bank.example/update',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['link'],
        message: 'Enter a valid URL, including http:// or https://',
      }),
    ]);
  });

  it('accepts an empty link and an https link', () => {
    expect(placeFormSchema.safeParse({ ...VALID_FORM, link: '' }).success).toBe(
      true,
    );
    expect(
      placeFormSchema.safeParse({
        ...VALID_FORM,
        link: 'https://bank.example/update',
      }).success,
    ).toBe(true);
  });

  it('rejects an organisation type outside the enum', () => {
    const result = placeFormSchema.safeParse({
      ...VALID_FORM,
      orgType: 'spaceship',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['orgType'] }),
    ]);
  });
});

describe('usageLocationRecordToFormValues and usageLocationFormValuesToRecordFields', () => {
  it('round-trips the editable fields of a record', () => {
    const values = usageLocationRecordToFormValues(RECORD);

    expect(values).toEqual({
      orgName: 'Commonwealth Bank',
      orgType: 'bank',
      updateMethod: 'phone',
      priority: 'high',
      link: 'https://bank.example/update-details',
      changed: true,
    });
    expect(usageLocationFormValuesToRecordFields(values)).toEqual({
      organisationName: RECORD.organisationName,
      organisationType: RECORD.organisationType,
      updateMethod: RECORD.updateMethod,
      priority: RECORD.priority,
      changed: RECORD.changed,
      link: RECORD.link,
    });
  });

  it('writes organisationType, not orgType, into the record fields', () => {
    const fields = usageLocationFormValuesToRecordFields({
      ...PLACE_FORM_DEFAULTS,
      orgName: 'Commonwealth Bank',
      orgType: 'bank',
    });

    expect(fields).toHaveProperty('organisationType', 'bank');
    expect(fields).not.toHaveProperty('orgType');
  });

  it('trims the organisation name before writing it', () => {
    const fields = usageLocationFormValuesToRecordFields({
      ...PLACE_FORM_DEFAULTS,
      orgName: '  Commonwealth Bank  ',
    });

    expect(fields.organisationName).toBe('Commonwealth Bank');
  });

  it('writes an empty link as undefined', () => {
    const fields = usageLocationFormValuesToRecordFields({
      ...PLACE_FORM_DEFAULTS,
      orgName: 'Commonwealth Bank',
      link: '   ',
    });

    expect(fields.link).toBeUndefined();
  });
});
