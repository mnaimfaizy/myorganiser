import {
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';
import { z } from 'zod';

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const placeFormSchema = z.object({
  orgName: z.string().trim().min(1, 'Organisation name is required'),
  orgType: z.enum(OrganisationTypeEnum),
  updateMethod: z.enum(UpdateMethodEnum),
  priority: z.enum(PriorityEnum),
  link: z
    .string()
    .trim()
    .refine((value) => !value || isHttpUrl(value), {
      message: 'Enter a valid URL, including http:// or https://',
    })
    .optional(),
  changed: z.boolean(),
});

export type PlaceFormValues = z.infer<typeof placeFormSchema>;

export const PLACE_FORM_DEFAULTS: PlaceFormValues = {
  orgName: '',
  orgType: OrganisationTypeEnum.Government,
  updateMethod: UpdateMethodEnum.Online,
  priority: PriorityEnum.Normal,
  link: '',
  changed: false,
};

export function normalizeOrganisationName(value: string | undefined): string {
  return (
    (value ?? '')
      .normalize('NFKD')
      // NFKD splits an accent off its letter; drop the mark so "Bär" folds to
      // "bar" rather than leaving a gap where the mark was.
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  );
}

export function usageLocationRecordToFormValues(
  location: Pick<
    UsageLocationRecord,
    | 'organisationName'
    | 'organisationType'
    | 'updateMethod'
    | 'priority'
    | 'link'
    | 'changed'
  >,
): PlaceFormValues {
  return {
    orgName: location.organisationName,
    orgType: location.organisationType,
    updateMethod: location.updateMethod,
    priority: location.priority,
    link: location.link ?? '',
    changed: location.changed,
  };
}

export function usageLocationFormValuesToRecordFields(
  values: PlaceFormValues,
): Pick<
  UsageLocationRecord,
  | 'organisationName'
  | 'organisationType'
  | 'updateMethod'
  | 'priority'
  | 'changed'
  | 'link'
> {
  return {
    organisationName: values.orgName.trim(),
    organisationType: values.orgType,
    updateMethod: values.updateMethod,
    priority: values.priority,
    changed: values.changed,
    link: values.link?.trim() ? values.link.trim() : undefined,
  };
}
