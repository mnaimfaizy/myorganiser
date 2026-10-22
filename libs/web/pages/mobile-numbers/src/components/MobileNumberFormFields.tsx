import { Combobox, Input, Label } from '@myorganiser/web-ui';
import { ChangeEvent, useCallback } from 'react';
import {
  COUNTRY_CALLING_CODES,
  countryNameForCode,
} from '../data/countryCodes';

/**
 * One option per calling code. +1 is shared by the United States and Canada,
 * so the option names both, and the value stays unique for the picker.
 */
const COUNTRY_CODE_OPTIONS = Array.from(
  new Set(COUNTRY_CALLING_CODES.map((c) => c.code)),
).map((code) => {
  const flag = COUNTRY_CALLING_CODES.find((c) => c.code === code)?.flag ?? '';
  return {
    value: code,
    label: `${flag} ${countryNameForCode(code) ?? code} (${code})`,
  };
});

export interface MobileNumberFormFieldsProps {
  label: string;
  countryCode: string;
  phoneNumber: string;
  fieldErrors?: {
    label?: string;
    countryCode?: string;
    phoneNumber?: string;
  };
  onLabelChange: (value: string) => void;
  onCountryCodeChange: (value: string) => void;
  onPhoneNumberChange: (value: string) => void;
}

export function MobileNumberFormFields(props: MobileNumberFormFieldsProps) {
  const {
    label,
    countryCode,
    phoneNumber,
    fieldErrors,
    onLabelChange,
    onCountryCodeChange,
    onPhoneNumberChange,
  } = props;

  const handleLabelChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onLabelChange(e.target.value);
    },
    [onLabelChange],
  );

  const handlePhoneNumberChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onPhoneNumberChange(e.target.value);
    },
    [onPhoneNumberChange],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="mobile-label" className="text-sm font-medium">
          Label
        </Label>
        <Input
          id="mobile-label"
          value={label}
          onChange={handleLabelChange}
          placeholder="Personal"
          className="h-11"
        />
        {fieldErrors?.label && (
          <p className="text-sm font-medium text-destructive">
            {fieldErrors.label}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="mobile-country-code" className="text-sm font-medium">
            Country Code
          </Label>
          <Combobox
            id="mobile-country-code"
            value={countryCode}
            onValueChange={onCountryCodeChange}
            options={COUNTRY_CODE_OPTIONS}
            placeholder="Select country code"
            searchPlaceholder="Search countries..."
            emptyText="No countries found."
            className="h-11"
          />
          {fieldErrors?.countryCode && (
            <p className="text-sm font-medium text-destructive">
              {fieldErrors.countryCode}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="mobile-phone-number" className="text-sm font-medium">
            Phone Number
          </Label>
          <Input
            id="mobile-phone-number"
            value={phoneNumber}
            onChange={handlePhoneNumberChange}
            placeholder="555 123 4567"
            className="h-11"
          />
          {fieldErrors?.phoneNumber && (
            <p className="text-sm font-medium text-destructive">
              {fieldErrors.phoneNumber}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
