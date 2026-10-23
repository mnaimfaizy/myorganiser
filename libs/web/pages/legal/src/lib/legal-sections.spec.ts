import {
  legalSectionTitle,
  numberLegalSections,
  PRIVACY_POLICY_SECTIONS,
  TERMS_OF_SERVICE_SECTIONS,
} from './legal-sections';

describe('numberLegalSections', () => {
  it('numbers the Privacy Policy sections 01 to 09 in their given order when there is an operator', () => {
    const numbered = numberLegalSections(PRIVACY_POLICY_SECTIONS, {
      hasOperator: true,
    });

    expect(numbered.map((section) => section.number)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
    ]);
    expect(numbered.map((section) => section.id)).toEqual(
      PRIVACY_POLICY_SECTIONS.map((section) => section.id),
    );
  });

  it('drops contact when there is no operator, and numbers the following section 08 with no gap', () => {
    const numbered = numberLegalSections(PRIVACY_POLICY_SECTIONS, {
      hasOperator: false,
    });

    expect(numbered.map((section) => section.id)).not.toContain('contact');
    expect(numbered.map((section) => section.number)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
    ]);
    expect(numbered[numbered.length - 1]).toEqual({
      id: 'changes',
      title: 'Policy Changes',
      number: '08',
    });
  });

  it('numbers the Terms of Service sections 01 to 08 when there is an operator, and 01 to 07 without one', () => {
    const withOperator = numberLegalSections(TERMS_OF_SERVICE_SECTIONS, {
      hasOperator: true,
    });
    const withoutOperator = numberLegalSections(TERMS_OF_SERVICE_SECTIONS, {
      hasOperator: false,
    });

    expect(withOperator.map((section) => section.number)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
    ]);
    expect(withoutOperator.map((section) => section.number)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
    ]);
    expect(withoutOperator.map((section) => section.id)).not.toContain(
      'contact',
    );
  });
});

describe('legalSectionTitle', () => {
  it('returns the heading of a known section id', () => {
    expect(legalSectionTitle(PRIVACY_POLICY_SECTIONS, 'cookies')).toBe(
      'Cookies & Sessions',
    );
  });

  it('throws an error naming the unknown section id', () => {
    expect(() => legalSectionTitle(PRIVACY_POLICY_SECTIONS, 'missing')).toThrow(
      'Unknown legal section "missing".',
    );
  });
});
