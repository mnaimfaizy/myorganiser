import {
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
  type OrganisationType,
  type Priority,
  type UpdateMethod,
} from '@myorganiser/vault-core';
import type { SegmentedControlOption } from '@myorganiser/web-ui';

export const ORGANISATION_TYPE_LABELS = {
  [OrganisationTypeEnum.Government]: 'Government',
  [OrganisationTypeEnum.Private]: 'Private',
  [OrganisationTypeEnum.Bank]: 'Bank',
  [OrganisationTypeEnum.Insurance]: 'Insurance',
  [OrganisationTypeEnum.School]: 'School',
  [OrganisationTypeEnum.University]: 'University',
  [OrganisationTypeEnum.Employer]: 'Employer',
  [OrganisationTypeEnum.Utility]: 'Utility',
  [OrganisationTypeEnum.Healthcare]: 'Healthcare',
  [OrganisationTypeEnum.Telecom]: 'Telecom',
  [OrganisationTypeEnum.Housing]: 'Housing',
  [OrganisationTypeEnum.Email]: 'Email',
  [OrganisationTypeEnum.Other]: 'Other',
} as const satisfies Record<OrganisationType, string>;

export const UPDATE_METHOD_LABELS = {
  [UpdateMethodEnum.Online]: 'Online',
  [UpdateMethodEnum.Phone]: 'Phone',
  [UpdateMethodEnum.Mail]: 'Mail',
  [UpdateMethodEnum.InPerson]: 'In person',
} as const satisfies Record<UpdateMethod, string>;

export const PRIORITY_LABELS = {
  [PriorityEnum.Low]: 'Low',
  [PriorityEnum.Normal]: 'Normal',
  [PriorityEnum.Medium]: 'Medium',
  [PriorityEnum.High]: 'High',
} as const satisfies Record<Priority, string>;

/**
 * Options in each table's own order, so a member added to an enum appears in
 * its control as soon as its label is written, and nowhere else.
 */
function optionsFrom<T extends string>(
  labels: Readonly<Record<T, string>>,
): readonly SegmentedControlOption<T>[] {
  return (Object.keys(labels) as T[]).map((value) => ({
    value,
    label: labels[value],
  }));
}

/** Select options, in the order the dialog shows them. */
export const ORGANISATION_TYPE_OPTIONS = optionsFrom(ORGANISATION_TYPE_LABELS);

/** Segment options, in the artboard's order (Online, Phone, Mail, In person). */
export const UPDATE_METHOD_OPTIONS = optionsFrom(UPDATE_METHOD_LABELS);

/** Segment options, lowest to highest. */
export const PRIORITY_OPTIONS = optionsFrom(PRIORITY_LABELS);

/** True when a Select's string value is a known organisation type. */
export function isOrganisationType(value: string): value is OrganisationType {
  return Object.prototype.hasOwnProperty.call(ORGANISATION_TYPE_LABELS, value);
}
