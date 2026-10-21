'use client';

import {
  Combobox,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@myorganiser/web-ui';
import { Control } from 'react-hook-form';

import { type AddAddressFormValues } from '../schemas/address';
import { ADDRESS_COUNTRY_OPTIONS } from '../utils/addressForm';

export interface AddAddressFormFieldsProps {
  control: Control<AddAddressFormValues>;
}

/**
 * The address fields in the artboard's grid: Label and Country, then Number and
 * Street, then Suburb or city, State and Postcode. Each row stacks to one column
 * below the sm breakpoint, where the three-up and the number row would be cramped.
 * The input ids are e2e selectors and do not change.
 */
export function AddAddressFormFields(props: AddAddressFormFieldsProps) {
  const { control } = props;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Label</FormLabel>
              <FormControl>
                <Input placeholder="Home / Office / Work" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="countryCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="addr-country">Country</FormLabel>
              <Combobox
                id="addr-country"
                value={field.value}
                onValueChange={field.onChange}
                options={ADDRESS_COUNTRY_OPTIONS}
                placeholder="Select a country"
                searchPlaceholder="Search countries..."
                emptyText="No countries found."
              />
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
        <FormField
          control={control}
          name="propertyNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="addr-property">Number</FormLabel>
              <FormControl>
                <Input id="addr-property" placeholder="221B" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="street"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="addr-street">Street</FormLabel>
              <FormControl>
                <Input id="addr-street" placeholder="Baker Street" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <FormField
          control={control}
          name="suburb"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="addr-suburb">Suburb or city</FormLabel>
              <FormControl>
                <Input id="addr-suburb" placeholder="London" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="state"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="addr-state">State</FormLabel>
              <FormControl>
                <Input
                  id="addr-state"
                  placeholder="Greater London"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="zipCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="addr-zipcode">Postcode</FormLabel>
              <FormControl>
                <Input id="addr-zipcode" placeholder="NW1 6XE" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  );
}
