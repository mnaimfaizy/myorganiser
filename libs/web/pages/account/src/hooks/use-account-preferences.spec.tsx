/* eslint-disable import/first -- jest.mock must precede application imports */

const mockToast = jest.fn();
const mockGet = jest.fn();
const mockSet = jest.fn();
let storageCallback: (() => void) | undefined;

jest.mock('@myorganiser/web-ui', () => ({
  useToast: () => ({ toast: mockToast }),
}));
jest.mock('@myorganiser/core', () => ({
  getAccountSettings: () => mockGet(),
  setAccountSettings: (v: unknown) => mockSet(v),
  subscribeAccountSettings: (cb: () => void) => {
    storageCallback = cb;
    return () => undefined;
  },
}));

import { act, renderHook, waitFor } from '@testing-library/react';

import { accountPreferencesSchema } from '../schemas/accountPreferences';
import { useAccountPreferences } from './use-account-preferences';

describe('useAccountPreferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockReturnValue({ countryCode: 'NZ', preferredCurrency: 'NZD' });
  });

  it('starts from the saved settings', async () => {
    const { result } = renderHook(() => useAccountPreferences());
    await waitFor(() => expect(result.current.countryCode).toBe('NZ'));
    expect(result.current.preferredCurrency).toBe('NZD');
  });

  it('writes nothing until save, then stores both picks and toasts', async () => {
    const { result } = renderHook(() => useAccountPreferences());
    await waitFor(() => expect(result.current.countryCode).toBe('NZ'));

    act(() => {
      result.current.setCountryCode('US');
      result.current.setPreferredCurrency('USD');
    });
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();

    await act(() => result.current.save());
    expect(mockSet).toHaveBeenCalledWith({
      countryCode: 'US',
      preferredCurrency: 'USD',
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Saved',
      description: 'Account settings updated.',
    });
  });

  it('re-reads the settings when storage changes', async () => {
    const { result } = renderHook(() => useAccountPreferences());
    await waitFor(() => expect(result.current.countryCode).toBe('NZ'));
    mockGet.mockReturnValue({ countryCode: 'GB', preferredCurrency: 'GBP' });
    act(() => storageCallback?.());
    await waitFor(() => expect(result.current.countryCode).toBe('GB'));
    expect(result.current.preferredCurrency).toBe('GBP');
  });

  it('does not save an empty country', async () => {
    const { result } = renderHook(() => useAccountPreferences());
    await waitFor(() => expect(result.current.countryCode).toBe('NZ'));
    act(() => result.current.setCountryCode(''));
    await act(() => result.current.save());
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe('accountPreferencesSchema', () => {
  it('accepts a country and a supported currency', () => {
    expect(
      accountPreferencesSchema.safeParse({
        countryCode: 'AU',
        preferredCurrency: 'AUD',
      }).success,
    ).toBe(true);
  });

  it('rejects an empty country code', () => {
    const r = accountPreferencesSchema.safeParse({
      countryCode: '',
      preferredCurrency: 'AUD',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe('Select a country.');
  });

  it('rejects an unsupported currency', () => {
    const r = accountPreferencesSchema.safeParse({
      countryCode: 'AU',
      preferredCurrency: 'XXX',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe('Select a supported currency.');
  });
});
