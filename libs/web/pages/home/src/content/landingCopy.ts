import {
  colorCyanVar,
  colorSecondaryVar,
  colorSuccessVar,
  colorWarningVar,
} from '@myorganiser/design-tokens';
import {
  EyeOff,
  Megaphone,
  MapPin,
  ScanEye,
  Smartphone,
  SquareCheck,
  type LucideIcon,
} from 'lucide-react';

import type { FeatureKey } from './featureClips';

// Landing copy. Every claim here must stay factual: no ads and no analytics
// (ADR 0129), no testimonials, no invented figures. YouTube is never mentioned.

// The public source repository. The licence is Elastic License 2.0, which is
// source-available and not OSI open source, so copy must never call it open source.
export const GITHUB_REPO_URL = 'https://github.com/mnaimfaizy/myorganiser';
export const GITHUB_NAV_LABEL = 'MyOrganiser on GitHub';
export const PUBLIC_CODE_HEADING = "Don't take our word for it.";
export const PUBLIC_CODE_TEXT =
  'The code is public on GitHub — including the in-browser encryption.';
export const PUBLIC_CODE_CTA = 'View the code on GitHub';

export interface NavLink {
  href: string;
  label: string;
}

export const NAV_LINKS: NavLink[] = [
  { href: '#features', label: 'Features' },
  { href: '#moving', label: 'Moving' },
  { href: '#privacy', label: 'Privacy' },
  { href: '#faq', label: 'FAQ' },
];

export const STAGE_CHIP = 'End-to-end encrypted · Free to sign up';
export const STAGE_HEADLINE = 'Keep your life yours.';
export const STAGE_INTRO =
  'Tasks, lists, subscriptions, and every address and number you have — encrypted on your device before it goes anywhere.';
export const STAGE_CTA = 'Start Your Free Vault';
export const STAGE_CAPTION = 'This is all our server will ever see.';
export const STAGE_REVEAL = '…and this is what you see. Only on your device.';
export const STAGE_HINT = 'Scroll to switch privacy on';

export interface FlipCardCopy {
  label: string;
  plain: string;
  cipher: string;
  icon: LucideIcon;
}

export const FLIP_CARDS: FlipCardCopy[] = [
  {
    label: 'Address',
    plain: '4 Mill Lane, York',
    cipher: 'Q3Jx9mR2aV7k…',
    icon: MapPin,
  },
  {
    label: 'Mobile number',
    plain: '07700 900456',
    cipher: 'pL0zW7cVd1Hs…',
    icon: Smartphone,
  },
  {
    label: 'Task',
    plain: 'Tell the bank I moved',
    cipher: 'aF4vRk9XqZp7…',
    icon: SquareCheck,
  },
];

export interface PillarCopy {
  title: string;
  text: string;
  icon: LucideIcon;
}

export const PILLARS: PillarCopy[] = [
  {
    title: 'No ads',
    text: 'Nothing in MyOrganiser is paid for by advertisers.',
    icon: Megaphone,
  },
  {
    title: 'No analytics',
    text: 'No analytics and no tracking — we do not build a profile of you.',
    icon: ScanEye,
  },
  {
    title: 'No reading',
    text: 'We store ciphertext. Nobody but you can read your vault — not even a platform administrator.',
    icon: EyeOff,
  },
];

export const RENTERS_CHIP = 'Made for renters';
export const RENTERS_HEADING = 'New address. New number. Nobody forgotten.';
export const RENTERS_BODY =
  'Every address and every mobile number keeps a list of the organisations that use it — your bank, employer, doctor, utilities, the bank that texts you security codes. When you move or change number, tick them off one by one, urgent ones first.';
export const RENTERS_POINTS: string[] = [
  'Urgent ones flagged first',
  'How to reach each one',
  'Every address and number you have, in one place',
];

export interface FeatureCardCopy {
  feature: FeatureKey;
  eyebrow: string;
  title: string;
  blurb: string;
  tintVar: string;
  span: string;
  chip?: string;
}

export const FEATURE_CARDS: FeatureCardCopy[] = [
  {
    feature: 'tasks',
    eyebrow: 'Tasks',
    title: 'A task list nobody else can read',
    blurb:
      'Plan the day with priorities, due dates, and effort estimates, then tick things off. Archive what is done. Your list stays private, even from us.',
    tintVar: colorSecondaryVar,
    span: 'md:col-span-2',
  },
  {
    feature: 'subscriptions',
    eyebrow: 'Subscriptions',
    title: 'See what every subscription really costs you',
    blurb:
      'Track streaming, software, and memberships in one place. Yearly and weekly plans are restated as a monthly equivalent, so you can compare them side by side and spot the ones you forgot.',
    tintVar: colorSuccessVar,
    span: '',
  },
  {
    feature: 'groceries',
    eyebrow: 'Groceries',
    title: 'A shopping list you can reuse every week',
    blurb:
      'Build lists from your own catalogue of items, tick them off in the shop on your phone, then uncheck everything and use the same list next week.',
    tintVar: colorWarningVar,
    span: '',
  },
  {
    feature: 'vaultCopy',
    eyebrow: 'Every device, one vault',
    title: 'Web, phone, and a copy you control',
    blurb:
      'Open the same vault on the web and the Android app, or add the web app to your iPhone home screen. Keep an encrypted copy of your whole vault in your own Google Drive.',
    tintVar: colorCyanVar,
    span: 'md:col-span-2',
    chip: 'Google Drive',
  },
];

export interface SignupItem {
  title: string;
  detail: string;
}

export const SIGNUP_INCLUDES: SignupItem[] = [
  {
    title: 'Your own encrypted vault',
    detail: 'Tasks, groceries, subscriptions, addresses, and numbers.',
  },
  {
    title: 'A checklist for every move',
    detail: 'Never forget who needs your new address or mobile number.',
  },
  {
    title: 'Web and mobile',
    detail: 'Same vault on your laptop and your phone.',
  },
  {
    title: 'A copy you control',
    detail: 'Keep an encrypted copy of your vault in your Google Drive.',
  },
  {
    title: 'Free to start',
    detail: 'No card required to create an account.',
  },
];

export const SIGNUP_STEPS: SignupItem[] = [
  {
    title: 'Create your account',
    detail: 'Choose an email address and a password.',
  },
  {
    title: 'Verify your email',
    detail: 'One click in the email we send you.',
  },
  {
    title: 'Set your vault passphrase',
    detail: 'This is your key. Only you know it. Save your Recovery Key too.',
  },
  {
    title: 'Start organising',
    detail: 'Add your first task, list, or address.',
  },
];

export const FREE_PLAN_CHIP = 'Free to sign up';
export const FREE_PLAN_INCLUDES_HEADING = 'What you get';
export const FREE_PLAN_STEPS_HEADING = 'Up and running in two minutes';
export const FREE_PLAN_CTA = 'Create Your Account';

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'Can MyOrganiser read my data?',
    answer:
      'No. Your vault is encrypted in your browser before it is uploaded. Our servers store ciphertext they cannot decrypt, and not even a platform administrator can open it.',
  },
  {
    question: 'Can I check how my data is encrypted?',
    answer:
      "Yes. MyOrganiser's source code is public on GitHub, including the encryption that runs in your browser.",
  },
  {
    question: 'What happens if I forget my passphrase?',
    answer:
      'When you create your vault you get a Recovery Key. It is shown once and only you keep it. It opens your vault if you forget your passphrase, and then you can set a new one. Without either, nobody — including us — can open your vault.',
  },
  {
    question: 'I rent and move often. How does it help?',
    answer:
      'Add your address or phone number, then list every organisation that uses it: bank, employer, doctor, utilities, and anyone else. When you move, work down the list, urgent ones first, and tick off each one as you notify it.',
  },
  {
    question: 'I changed my phone number. Can it help with that too?',
    answer:
      'Yes. Each mobile number keeps its own list of the organisations that use it — banks that text security codes, your doctor, your employer, delivery accounts. When the number changes, you tick them off one by one.',
  },
  {
    question: 'Is there a mobile app?',
    answer:
      'Yes. There is an Android app that opens the same vault your browser uses. On iPhone, you can add the web app to your home screen.',
  },
  {
    question: 'Can I keep my own copy of my data?',
    answer:
      'Yes. You can keep an encrypted copy of your whole vault in your own Google Drive. It can be opened without us, so your data outlives MyOrganiser if it ever has to.',
  },
  {
    question: 'Do you show ads or track me?',
    answer: 'No. MyOrganiser has no advertising and no analytics.',
  },
  {
    question: 'How much does it cost?',
    answer: 'Creating an account is free, and no card is needed.',
  },
];

export interface FooterLink {
  label: string;
  href: string;
  /** Opens in a new tab with `rel="noopener noreferrer"`; rendered as a plain anchor. */
  external?: boolean;
}

export interface FooterColumnCopy {
  heading: string;
  links: FooterLink[];
}

export const FOOTER_TAGLINE =
  'Tasks, lists, renewals, and the people who need your new address — organised, and readable only by you.';

export const FOOTER_COLUMNS: FooterColumnCopy[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'Security', href: '#privacy' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Mobile app', href: '/download' },
      { label: 'GitHub', href: GITHUB_REPO_URL, external: true },
    ],
  },
  {
    heading: 'Account',
    links: [
      { label: 'Create account', href: '/signup' },
      { label: 'Log in', href: '/login' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
];
