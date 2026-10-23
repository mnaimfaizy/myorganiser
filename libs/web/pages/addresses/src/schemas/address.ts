import { COUNTRIES } from '@myorganiser/core';
import { z } from 'zod';

const countryCodes = new Set<string>(COUNTRIES.map((country) => country.code));

const textField = (label: string, maxLength: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(maxLength, `${label} must be ${maxLength} characters or less`);

const optionalTextField = (label: string, maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength, `${label} must be ${maxLength} characters or less`)
    .optional()
    .or(z.literal(''));

export const addAddressSchema = z.object({
  label: textField('Label', 60),
  propertyNumber: optionalTextField('Number', 32),
  street: textField('Street', 120),
  suburb: textField('Suburb or city', 80),
  state: textField('State', 80),
  zipCode: z
    .string()
    .trim()
    .min(2, 'Postcode must be at least 2 characters')
    .max(16, 'Postcode must be 16 characters or less')
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9\s-]*$/,
      'Use letters, numbers, spaces, or hyphens',
    ),
  countryCode: z.string().refine((value) => countryCodes.has(value), {
    message: 'Select a valid country',
  }),
});

export type AddAddressFormValues = z.infer<typeof addAddressSchema>;

export function isAddressCountryCode(value: string | undefined): boolean {
  return Boolean(value && countryCodes.has(value));
}
