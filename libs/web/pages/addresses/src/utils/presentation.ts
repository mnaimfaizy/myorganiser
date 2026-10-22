import { AddressStatusEnum, type AddressStatus } from '@myorganiser/vault-core';
import type { PillSpec } from '@myorganiser/web-usage-locations';

import type { AddressListFilter } from './address-summary';

/**
 * Display words and tones for the Address vocabulary. Each table is pinned to
 * its enum (ADR 0053): a member added to the enum and not here fails to
 * compile, instead of falling back to a guessed label. The Usage Location pills
 * live in `@myorganiser/web-usage-locations`.
 */

export const ADDRESS_STATUS_PILL = {
  [AddressStatusEnum.Current]: { label: 'CURRENT', tone: 'trust' },
  [AddressStatusEnum.Old]: { label: 'OLD', tone: 'neutral' },
} as const satisfies Record<AddressStatus, PillSpec>;

/** The list's status chips, in chip order. */
export const ADDRESS_FILTER_LABELS = {
  all: 'All',
  [AddressStatusEnum.Current]: 'Current',
  [AddressStatusEnum.Old]: 'Old',
} as const satisfies Record<AddressListFilter, string>;

export const ADDRESS_FILTER_KEYS = Object.keys(
  ADDRESS_FILTER_LABELS,
) as AddressListFilter[];
