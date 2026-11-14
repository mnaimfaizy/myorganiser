import type { Metadata } from 'next';

import { HomePage } from '@myorganiser/web-pages/home';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'MyOrganiser',
  description:
    'The all-in-one workspace for tasks, addresses, contacts, and personal info—protected by client-side end-to-end encryption.',
  applicationCategory: 'ProductivityApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  featureList: [
    'End-to-end encrypted vault',
    'Task management',
    'Address book',
    'Cross-device sync',
  ],
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HomePage />
    </>
  );
}
