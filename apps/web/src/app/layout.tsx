import type { Metadata } from 'next';

import {
  InstallPromptCapture,
  ServiceWorkerRegistration,
} from '@myorganiser/web-pages/offline';

import './global.css';

// Staging's deploy depends on this (ADR 0128): it reads the build id out of
// the HTML of /login to tell which build the running process serves. A
// prerendered page would be read from disk and report the uploaded build
// instead. `tools/scripts/lib/staging-web-deploy.test.ts` fails if this
// export goes.
export const dynamic = 'force-dynamic';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://myorganiser.app';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),

  title: {
    default: 'MyOrganiser – Organise Your Life, Secure Your Data',
    template: '%s | MyOrganiser',
  },
  description:
    'The all-in-one workspace for your tasks, addresses, contacts, and personal info—protected by client-side end-to-end encryption. Keep everything organized and private.',
  keywords: [
    'organizer',
    'task manager',
    'encrypted vault',
    'privacy',
    'secure notes',
    'personal data',
    'todos',
    'contacts',
    'end-to-end encryption',
    'e2ee',
  ],
  authors: [{ name: 'MyOrganiser', url: APP_URL }],
  creator: 'MyOrganiser',
  publisher: 'MyOrganiser',

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  openGraph: {
    type: 'website',
    locale: 'en_AU',
    url: '/',
    siteName: 'MyOrganiser',
    title: 'MyOrganiser – Organise Your Life, Secure Your Data',
    description:
      'The all-in-one workspace for tasks, addresses, contacts, and personal info—protected by client-side end-to-end encryption.',
    images: [
      {
        url: '/images/og-image.png',
        width: 1200,
        height: 630,
        alt: 'MyOrganiser – Secure Personal Organiser',
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    title: 'MyOrganiser – Organise Your Life, Secure Your Data',
    description:
      'The all-in-one workspace for tasks, addresses, contacts, and personal info—protected by client-side end-to-end encryption.',
    images: ['/images/og-image.png'],
  },

  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apiBaseUrl =
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

  const routerPrefix =
    process.env.ROUTER_PREFIX ?? process.env.NEXT_PUBLIC_ROUTER_PREFIX ?? '';

  const runtimeConfigJson = JSON.stringify({
    API_BASE_URL: apiBaseUrl,
    ROUTER_PREFIX: routerPrefix,
  }).replace(/[<>&\u2028\u2029]/g, (c) => {
    switch (c) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return c;
    }
  });

  return (
    <html lang="en">
      <head>
        <meta name="myorganiser-api-base-url" content={apiBaseUrl} />
        <meta name="myorganiser-router-prefix" content={routerPrefix} />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__MYORGANISER_RUNTIME__=${runtimeConfigJson};window.MYORGANISER_RUNTIME=window.__MYORGANISER_RUNTIME__;`,
          }}
        />
      </head>
      <body>
        {children}
        {/*
         * Registers the service worker in production builds only (ADR 0127).
         * In the root layout, not the dashboard's, so the offline page also
         * covers a signed-out User opening the Installed Web App.
         */}
        <ServiceWorkerRegistration />
        {/*
         * Holds the browser's one early install prompt until the dashboard's
         * install card asks for it. Here, not in the dashboard layout, because
         * the browser can fire it on whichever page loads first.
         */}
        <InstallPromptCapture />
      </body>
    </html>
  );
}
