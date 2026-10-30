import { subscriptionFormSchema } from './subscription';

const VALID_FORM = {
  name: 'Spotify',
  status: 'active',
  billingCycle: 'monthly',
  amount: 10,
  currency: 'AUD',
  paymentMethod: 'creditCard',
  renewalType: 'autoRenew',
  tier: 'basic',
  startDate: '2025-01-15',
};

describe('subscriptionFormSchema link', () => {
  it('accepts a form with no link', () => {
    expect(subscriptionFormSchema.safeParse(VALID_FORM).success).toBe(true);
  });

  it('accepts an empty link', () => {
    expect(
      subscriptionFormSchema.safeParse({ ...VALID_FORM, link: '' }).success,
    ).toBe(true);
  });

  it('accepts an https link and an http link', () => {
    expect(
      subscriptionFormSchema.safeParse({
        ...VALID_FORM,
        link: 'https://example.com',
      }).success,
    ).toBe(true);
    expect(
      subscriptionFormSchema.safeParse({
        ...VALID_FORM,
        link: 'http://example.com',
      }).success,
    ).toBe(true);
  });

  it('rejects a javascript: link with the full web address message', () => {
    const result = subscriptionFormSchema.safeParse({
      ...VALID_FORM,
      // eslint-disable-next-line no-script-url -- deliberate unsafe-scheme fixture for issue #1281
      link: 'javascript:alert(1)',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['link'],
        message: 'Enter a full web address, starting with https://',
      }),
    ]);
  });

  it('rejects a data: link with the full web address message', () => {
    const result = subscriptionFormSchema.safeParse({
      ...VALID_FORM,
      link: 'data:text/html,x',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['link'],
        message: 'Enter a full web address, starting with https://',
      }),
    ]);
  });
});
