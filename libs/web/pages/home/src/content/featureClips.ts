import { Smartphone, Truck, type LucideIcon } from 'lucide-react';

// Mock-UI data for the landing page clips. The clips stand in for short feature
// videos; every value here is illustrative sample data inside the mock UI.

export type FeatureKey =
  | 'tasks'
  | 'subscriptions'
  | 'groceries'
  | 'vaultCopy'
  | 'addresses'
  | 'mobileNumbers';

export interface ClipBodyProps {
  step: number;
  compact: boolean;
}

/** Number of animation steps in one loop of each clip. */
export const CLIP_STEPS = {
  tasks: 6,
  subscriptions: 6,
  groceries: 7,
  vaultCopy: 6,
  addresses: 8,
  mobileNumbers: 8,
} as const satisfies Record<FeatureKey, number>;

/** The path shown in each clip's mock address bar. */
export const CLIP_PATHS = {
  tasks: 'tasks',
  subscriptions: 'subscriptions',
  groceries: 'groceries',
  vaultCopy: 'vault',
  addresses: 'addresses',
  mobileNumbers: 'mobile-numbers',
} as const satisfies Record<FeatureKey, string>;

export const TASK_NAMES: string[] = [
  'Renew passport',
  'Book dentist',
  'Pay council tax',
  'Call mum',
];

export interface SubscriptionSample {
  name: string;
  price: number;
  daysToRenewal: number;
}

export const SUBSCRIPTION_SAMPLES: SubscriptionSample[] = [
  { name: 'Netflix', price: 10.99, daysToRenewal: 3 },
  { name: 'Spotify', price: 11.99, daysToRenewal: 12 },
  { name: 'iCloud+', price: 2.99, daysToRenewal: 19 },
  { name: 'Gym', price: 34.0, daysToRenewal: 26 },
];

export const GROCERY_ITEMS: string[] = [
  'Oat milk',
  'Eggs',
  'Spinach',
  'Coffee beans',
];

export const VAULT_CIPHERTEXT = 'k9Xq2…Zp7Lw0aF4vR=';

export interface ChecklistOrganisation {
  org: string;
  how: string;
  urgent: boolean;
}

export interface ChangeChecklistConfig {
  icon: LucideIcon;
  from: string;
  to: string;
  heading: string;
  organisations: ChecklistOrganisation[];
}

export const ADDRESS_CHECKLIST: ChangeChecklistConfig = {
  icon: Truck,
  from: '12 Elm Grove',
  to: '4 Mill Lane',
  heading: 'Who needs your new address',
  organisations: [
    { org: 'Bank', how: 'App → Profile', urgent: true },
    { org: 'Employer payroll', how: 'HR portal', urgent: true },
    { org: 'GP surgery', how: 'Phone reception', urgent: false },
    { org: 'Electoral roll', how: 'Online form', urgent: false },
    { org: 'Energy supplier', how: 'Account page', urgent: false },
  ],
};

export const MOBILE_NUMBER_CHECKLIST: ChangeChecklistConfig = {
  icon: Smartphone,
  from: '07700 900123',
  to: '07700 900456',
  heading: 'Who needs your new number',
  organisations: [
    { org: 'Bank security codes', how: 'In branch', urgent: true },
    { org: 'Employer', how: 'HR portal', urgent: true },
    { org: 'GP surgery', how: 'Phone reception', urgent: false },
    { org: 'Dentist', how: 'Email', urgent: false },
    { org: 'Delivery accounts', how: 'App settings', urgent: false },
  ],
};
