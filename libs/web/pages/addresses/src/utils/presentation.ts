import {
  AddressStatusEnum,
  PriorityEnum,
  type AddressStatus,
  type Priority,
} from '@myorganiser/vault-core';
import type { StatusPillTone } from '@myorganiser/web-ui';

import type { AddressListFilter } from './address-summary';

/**
 * Display words and tones for the Address and Usage Location vocabularies.
 * Each table is pinned to its enum (ADR 0053): a member added to the enum and
 * not here fails to compile, instead of falling back to a guessed label.
 */

export interface PillSpec {
  label: string;
  tone: StatusPillTone;
}

export const ADDRESS_STATUS_PILL = {
  [AddressStatusEnum.Current]: { label: 'CURRENT', tone: 'trust' },
  [AddressStatusEnum.Old]: { label: 'OLD', tone: 'neutral' },
} as const satisfies Record<AddressStatus, PillSpec>;

export const PLACE_PRIORITY_PILL = {
  [PriorityEnum.High]: { label: 'HIGH', tone: 'danger' },
  [PriorityEnum.Medium]: { label: 'MEDIUM', tone: 'warning' },
  [PriorityEnum.Normal]: { label: 'NORMAL', tone: 'neutral' },
  [PriorityEnum.Low]: { label: 'LOW', tone: 'neutral' },
} as const satisfies Record<Priority, PillSpec>;

/** The pill on a place that is already updated, in place of its priority. */
export const PLACE_UPDATED_PILL = {
  label: 'UPDATED',
  tone: 'success',
} as const satisfies PillSpec;

/** The list's status chips, in chip order. */
export const ADDRESS_FILTER_LABELS = {
  all: 'All',
  [AddressStatusEnum.Current]: 'Current',
  [AddressStatusEnum.Old]: 'Old',
} as const satisfies Record<AddressListFilter, string>;

export const ADDRESS_FILTER_KEYS = Object.keys(
  ADDRESS_FILTER_LABELS,
) as AddressListFilter[];
