import type { FieldErrors } from 'react-hook-form';

import { invalidSaveToast } from './invalidSaveToast';

type Values = { countryCode: string; weekday: number };

describe('invalidSaveToast', () => {
  it('uses the first field error message', () => {
    const errors = {
      countryCode: { type: 'min', message: 'Select a country.' },
      weekday: { type: 'max', message: 'Select a day.' },
    } as unknown as FieldErrors<Values>;

    expect(invalidSaveToast(errors)).toEqual({
      title: 'Not saved',
      description: 'Select a country.',
      variant: 'destructive',
    });
  });

  it('falls back when the first error has no string message', () => {
    const errors = {
      countryCode: { type: 'custom', message: 42 },
      weekday: { type: 'max', message: 'Select a day.' },
    } as unknown as FieldErrors<Values>;

    expect(invalidSaveToast(errors)).toEqual({
      title: 'Not saved',
      description: 'Check your choices and try again.',
      variant: 'destructive',
    });
  });

  it('falls back when the first error message is an empty string', () => {
    const errors = {
      countryCode: { type: 'min', message: '' },
    } as unknown as FieldErrors<Values>;

    expect(invalidSaveToast(errors)).toEqual({
      title: 'Not saved',
      description: 'Check your choices and try again.',
      variant: 'destructive',
    });
  });

  it('falls back when there are no errors', () => {
    expect(invalidSaveToast({} as FieldErrors<Values>)).toEqual({
      title: 'Not saved',
      description: 'Check your choices and try again.',
      variant: 'destructive',
    });
  });
});
