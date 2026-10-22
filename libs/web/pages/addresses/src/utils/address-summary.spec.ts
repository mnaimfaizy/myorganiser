import {
  AddressStatusEnum,
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
  type AddressRecord,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';

import {
  addressCopyFields,
  addressPhoneCopyFields,
  describeAddressDeletion,
  describeDangerZone,
  filterAddresses,
  formatAddressForCopy,
  formatAddressLines,
  formatAddressShortLine,
  formatAddressUpdatedLine,
  formatAddressesPhoneSummary,
  formatAddressesSummary,
  type AddressListFilter,
} from './address-summary';

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

function makeAddress(overrides: Partial<AddressRecord> = {}): AddressRecord {
  return {
    id: 'addr',
    label: 'Home',
    status: AddressStatusEnum.Current,
    usageLocations: [],
    createdAt: isoOn(2026, 0, 1),
    ...overrides,
  };
}

function makeLocations(count: number): UsageLocationRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeLocation({ id: `loc-${i}` }),
  );
}

const RICHMOND: Partial<AddressRecord> = {
  propertyNumber: '14',
  street: 'Rose Lane',
  suburb: 'Richmond',
  state: 'VIC',
  zipCode: '3121',
  country: 'Australia',
};

const summaryAddresses = [
  makeAddress({
    id: 'a',
    status: AddressStatusEnum.Current,
    usageLocations: [makeLocation({ id: 'a1', changed: false })],
  }),
  makeAddress({
    id: 'b',
    status: AddressStatusEnum.Old,
    usageLocations: [
      makeLocation({ id: 'b1', changed: true }),
      makeLocation({ id: 'b2', changed: false }),
    ],
  }),
  makeAddress({
    id: 'c',
    status: AddressStatusEnum.Old,
    usageLocations: [makeLocation({ id: 'c1', changed: true })],
  }),
];

const filterFixture = [
  makeAddress({
    id: 'home',
    label: 'Home',
    status: AddressStatusEnum.Current,
    street: 'Rose Lane',
    country: 'Australia',
  }),
  makeAddress({
    id: 'parents',
    label: 'Parents',
    status: AddressStatusEnum.Old,
    propertyNumber: '7',
    street: 'Elm Street',
    suburb: 'Ballarat',
    state: 'VIC',
    zipCode: '3350',
    country: 'Australia',
  }),
  makeAddress({
    id: 'office',
    label: 'Office',
    status: AddressStatusEnum.Current,
    street: 'Market Road',
    country: 'New Zealand',
  }),
];

const ids = <T extends { id: string }>(items: readonly T[]): string[] =>
  items.map((item) => item.id);

describe('header summaries', () => {
  it('formats the desktop and phone lines with singular and plural forms', () => {
    expect(formatAddressesSummary(summaryAddresses)).toBe(
      '3 addresses · 1 current · 2 places still to update',
    );
    expect(formatAddressesPhoneSummary(summaryAddresses)).toBe(
      '3 saved · 2 places to update',
    );

    const single = [makeAddress({ usageLocations: [makeLocation()] })];
    expect(formatAddressesSummary(single)).toBe(
      '1 address · 1 current · 1 place still to update',
    );
    expect(formatAddressesPhoneSummary(single)).toBe(
      '1 saved · 1 place to update',
    );
  });
});

describe('filterAddresses', () => {
  it.each<[AddressListFilter, string[]]>([
    ['current', ['home', 'office']],
    ['old', ['parents']],
    ['all', ['home', 'parents', 'office']],
  ])('keeps the %s status filter', (filter, expected) => {
    expect(ids(filterAddresses(filterFixture, '', filter))).toEqual(expected);
  });

  it.each<[string, string[]]>([
    ['  HOME ', ['home']],
    ['elm street', ['parents']],
    ['zealand', ['office']],
    ['7 elm street', ['parents']],
    ['   ', ['home', 'parents', 'office']],
    ['zzz', []],
  ])(
    'matches the query %j against label, street, country and full address',
    (query, expected) => {
      expect(ids(filterAddresses(filterFixture, query, 'all'))).toEqual(
        expected,
      );
    },
  );

  it('combines the query with the status filter using AND', () => {
    expect(ids(filterAddresses(filterFixture, 'australia', 'current'))).toEqual(
      ['home'],
    );
    expect(ids(filterAddresses(filterFixture, 'australia', 'old'))).toEqual([
      'parents',
    ]);
  });
});

describe('formatAddressLines', () => {
  it.each<[string, AddressRecord, string[]]>([
    [
      'a structured address',
      makeAddress(RICHMOND),
      ['14 Rose Lane', 'Richmond VIC 3121, Australia'],
    ],
    [
      'no property number',
      makeAddress({ ...RICHMOND, propertyNumber: undefined }),
      ['Rose Lane', 'Richmond VIC 3121, Australia'],
    ],
    [
      'no state',
      makeAddress({ ...RICHMOND, state: undefined }),
      ['14 Rose Lane', 'Richmond 3121, Australia'],
    ],
    [
      'no country',
      makeAddress({ ...RICHMOND, country: undefined }),
      ['14 Rose Lane', 'Richmond VIC 3121'],
    ],
    [
      'a legacy single-line address',
      makeAddress({ address: '1 Old Road, Town' }),
      ['1 Old Road, Town'],
    ],
    [
      'a legacy record with nothing set',
      makeAddress(),
      ['No address provided'],
    ],
    ['only a country', makeAddress({ country: 'Australia' }), ['Australia']],
  ])('formats the lines for %s', (_label, address, expected) => {
    expect(formatAddressLines(address)).toEqual(expected);
  });

  it('formats the one-line form without a country, and the copy text with newlines', () => {
    expect(
      formatAddressShortLine(makeAddress({ ...RICHMOND, country: undefined })),
    ).toBe('14 Rose Lane, Richmond VIC 3121');
    expect(
      formatAddressShortLine(makeAddress({ address: '1 Old Road, Town' })),
    ).toBe('1 Old Road, Town');
    expect(formatAddressShortLine(makeAddress())).toBe('No address provided');
    expect(formatAddressShortLine(makeAddress({ country: 'Australia' }))).toBe(
      'Australia',
    );
    expect(formatAddressForCopy(makeAddress(RICHMOND))).toBe(
      '14 Rose Lane\nRichmond VIC 3121, Australia',
    );
  });
});

describe('copy fields', () => {
  it('lists desktop fields in postal order, omits empty ones, and groups phone fields', () => {
    expect(addressCopyFields(makeAddress(RICHMOND))).toEqual([
      { label: 'Property number', value: '14' },
      { label: 'Street', value: 'Rose Lane' },
      { label: 'Suburb', value: 'Richmond' },
      { label: 'State', value: 'VIC' },
      { label: 'Postcode', value: '3121' },
      { label: 'Country', value: 'Australia' },
    ]);
    expect(
      addressCopyFields(
        makeAddress({
          ...RICHMOND,
          propertyNumber: undefined,
          state: undefined,
        }),
      ),
    ).toEqual([
      { label: 'Street', value: 'Rose Lane' },
      { label: 'Suburb', value: 'Richmond' },
      { label: 'Postcode', value: '3121' },
      { label: 'Country', value: 'Australia' },
    ]);
    expect(
      addressCopyFields(makeAddress({ address: '1 Old Road, Town' })),
    ).toEqual([{ label: 'Address', value: '1 Old Road, Town' }]);
    expect(addressCopyFields(makeAddress())).toEqual([]);

    expect(addressPhoneCopyFields(makeAddress(RICHMOND))).toEqual([
      { label: 'Street', value: '14 Rose Lane' },
      { label: 'Suburb', value: 'Richmond VIC 3121' },
      { label: 'Country', value: 'Australia' },
    ]);
    expect(
      addressPhoneCopyFields(makeAddress({ address: '1 Old Road, Town' })),
    ).toEqual([{ label: 'Address', value: '1 Old Road, Town' }]);
  });
});

describe('dates', () => {
  it.each<[string, Partial<AddressRecord>, string]>([
    [
      'an updatedAt, preferred over createdAt',
      { updatedAt: isoOn(2026, 9, 3), createdAt: isoOn(2026, 8, 1) },
      'Updated 3 Oct · encrypted on this device',
    ],
    [
      'only a createdAt',
      { createdAt: isoOn(2026, 8, 1) },
      'Added 1 Sep · encrypted on this device',
    ],
    [
      'neither date being valid',
      { createdAt: 'not a date', updatedAt: 'not a date' },
      'Encrypted on this device',
    ],
  ])('builds the updated line from %s', (_label, dates, expected) => {
    expect(formatAddressUpdatedLine(makeAddress(dates), TODAY)).toBe(expected);
  });
});

describe('delete confirmation copy', () => {
  it.each<[number, string, string]>([
    [
      0,
      'This action cannot be undone. The address will be permanently removed.',
      'It is removed from every device.',
    ],
    [
      1,
      'This action cannot be undone. The address and its 1 usage location will be permanently removed.',
      'Its 1 place goes with it, on every device.',
    ],
    [
      5,
      'This action cannot be undone. The address and its 5 usage locations will be permanently removed.',
      'Its 5 places go with it, on every device.',
    ],
  ])('describes deletion for %i places', (count, deletionText, dangerText) => {
    const address = makeAddress({ usageLocations: makeLocations(count) });
    expect(describeAddressDeletion(address)).toBe(deletionText);
    expect(describeDangerZone(address)).toBe(dangerText);
  });
});
