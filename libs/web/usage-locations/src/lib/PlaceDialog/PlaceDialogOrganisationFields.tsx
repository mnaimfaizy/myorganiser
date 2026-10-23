import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@myorganiser/web-ui';
import type { ChangeEvent } from 'react';
import type { Control } from 'react-hook-form';

import { ORGANISATION_TYPE_OPTIONS } from '../labels';
import type { PlaceFormValues } from '../placeForm';
import type { PlaceNoun } from './PlaceDialog';
import { PlaceDuplicateAlert } from './PlaceDuplicateAlert';

export interface PlaceDialogOrganisationFieldsProps {
  control: Control<PlaceFormValues>;
  /** The organisation name as typed, quoted in the duplicate warning. */
  orgName: string;
  /** True when the typed name matches another place on this address or number. */
  isDuplicate: boolean;
  noun: PlaceNoun;
  onOrgNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOrgTypeChange: (value: string) => void;
}

/** The organisation name and type row, with the duplicate warning beneath it. */
export function PlaceDialogOrganisationFields({
  control,
  orgName,
  isDuplicate,
  noun,
  onOrgNameChange,
  onOrgTypeChange,
}: PlaceDialogOrganisationFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
        <FormField
          control={control}
          name="orgName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organisation</FormLabel>
              <FormControl>
                <Input
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onChange={onOrgNameChange}
                  autoComplete="off"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="orgType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>
              <Select value={field.value} onValueChange={onOrgTypeChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {ORGANISATION_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
      </div>

      {isDuplicate ? (
        <PlaceDuplicateAlert orgName={orgName} noun={noun} />
      ) : null}
    </>
  );
}
