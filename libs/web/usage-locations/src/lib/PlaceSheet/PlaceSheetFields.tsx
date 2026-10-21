'use client';

import {
  ChoiceChip,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
} from '@myorganiser/web-ui';
import {
  OrganisationTypeEnum,
  type OrganisationType,
} from '@myorganiser/vault-core';
import { useCallback, useState } from 'react';
import { useWatch } from 'react-hook-form';

import type { PlaceNoun } from '../PlaceDialog/PlaceDialog';
import { PlaceDialogUpdateFields } from '../PlaceDialog/PlaceDialogUpdateFields';
import { PlaceDuplicateAlert } from '../PlaceDialog/PlaceDuplicateAlert';
import { ORGANISATION_TYPE_LABELS } from '../labels';
import type { UsePlaceFormResult } from '../usePlaceForm';

/**
 * Which organisation types sit in the first chip row. The rest sit behind
 * "More…". One table pinned to the enum (ADR 0053): a type added to the enum
 * and not here fails to compile. Its key order is the chip order.
 */
const ORGANISATION_TYPE_CHIP_GROUP = {
  [OrganisationTypeEnum.Government]: 'primary',
  [OrganisationTypeEnum.Utility]: 'primary',
  [OrganisationTypeEnum.Bank]: 'primary',
  [OrganisationTypeEnum.Private]: 'more',
  [OrganisationTypeEnum.Insurance]: 'more',
  [OrganisationTypeEnum.School]: 'more',
  [OrganisationTypeEnum.University]: 'more',
  [OrganisationTypeEnum.Employer]: 'more',
  [OrganisationTypeEnum.Healthcare]: 'more',
  [OrganisationTypeEnum.Telecom]: 'more',
  [OrganisationTypeEnum.Housing]: 'more',
  [OrganisationTypeEnum.Email]: 'more',
  [OrganisationTypeEnum.Other]: 'more',
} as const satisfies Record<OrganisationType, 'primary' | 'more'>;

const organisationTypesIn = (group: 'primary' | 'more'): OrganisationType[] =>
  (Object.keys(ORGANISATION_TYPE_CHIP_GROUP) as OrganisationType[]).filter(
    (type) => ORGANISATION_TYPE_CHIP_GROUP[type] === group,
  );

const PRIMARY_ORGANISATION_TYPES = organisationTypesIn('primary');
const MORE_ORGANISATION_TYPES = organisationTypesIn('more');

interface PlaceSheetTypeChipsProps {
  place: UsePlaceFormResult;
}

/**
 * The organisation type as single-select chips. "More…" reveals the rest, and
 * they start revealed when the saved type is one of them.
 */
function PlaceSheetTypeChips({ place }: PlaceSheetTypeChipsProps) {
  const orgType = useWatch({ control: place.form.control, name: 'orgType' });
  const [moreRevealed, setMoreRevealed] = useState(false);
  const showMore =
    moreRevealed || ORGANISATION_TYPE_CHIP_GROUP[orgType] === 'more';
  const { handleOrgTypeChange } = place;

  const chooseType = useCallback(
    (type: OrganisationType) => {
      handleOrgTypeChange(type);
    },
    [handleOrgTypeChange],
  );

  const handleRevealMore = useCallback(() => {
    setMoreRevealed(true);
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-body-sm font-semibold text-foreground">Type</span>
      <div
        role="group"
        aria-label="Type"
        className="flex min-w-0 gap-2 overflow-x-auto pb-1"
      >
        {PRIMARY_ORGANISATION_TYPES.map((type) => (
          <ChoiceChip
            key={type}
            pressed={orgType === type}
            onPressedChange={() => chooseType(type)}
          >
            {ORGANISATION_TYPE_LABELS[type]}
          </ChoiceChip>
        ))}
        <ChoiceChip pressed={showMore} onPressedChange={handleRevealMore}>
          More…
        </ChoiceChip>
        {showMore
          ? MORE_ORGANISATION_TYPES.map((type) => (
              <ChoiceChip
                key={type}
                pressed={orgType === type}
                onPressedChange={() => chooseType(type)}
              >
                {ORGANISATION_TYPE_LABELS[type]}
              </ChoiceChip>
            ))
          : null}
      </div>
    </div>
  );
}

export interface PlaceSheetFieldsProps {
  place: UsePlaceFormResult;
  noun: PlaceNoun;
}

/** The body of the phone place sheet: the fields in the artboard's order. */
export function PlaceSheetFields({ place, noun }: PlaceSheetFieldsProps) {
  const { form, orgName, duplicateLocation } = place;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-2">
      <FormField
        control={form.control}
        name="orgName"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-body-sm font-semibold">
              Organisation
            </FormLabel>
            <FormControl>
              <Input
                name={field.name}
                ref={field.ref}
                value={field.value}
                onChange={place.handleOrgNameChange}
                autoComplete="off"
                className="h-12"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {duplicateLocation !== null ? (
        <PlaceDuplicateAlert orgName={orgName} noun={noun} />
      ) : null}

      <PlaceSheetTypeChips place={place} />

      <PlaceDialogUpdateFields
        control={form.control}
        onUpdateMethodChange={place.handleUpdateMethodChange}
        onPriorityChange={place.handlePriorityChange}
      />

      <FormField
        control={form.control}
        name="link"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-body-sm font-semibold">
              Where to change it{' '}
              <span className="font-normal text-muted-foreground">
                · optional
              </span>
            </FormLabel>
            <FormControl>
              <Input
                name={field.name}
                ref={field.ref}
                value={field.value ?? ''}
                onChange={place.handleLinkChange}
                type="url"
                placeholder="https://"
                className="h-12"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="changed"
        render={({ field }) => (
          <FormItem className="flex min-h-14 flex-row items-center gap-3 space-y-0 px-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-body text-foreground">Already updated</span>
              <span className="text-caption text-muted-foreground">
                Records today&apos;s date
              </span>
            </div>
            <FormControl>
              <Switch
                aria-label="Already updated"
                checked={field.value}
                onCheckedChange={place.handleChangedChange}
              />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  );
}
