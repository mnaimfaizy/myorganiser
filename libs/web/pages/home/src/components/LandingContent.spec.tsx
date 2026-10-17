/* eslint-disable import/first */
import React from 'react';

// jsdom has no Next.js router, no real anchors, and no lucide SVG set, so those
// are mocked at the module boundary. Everything else renders for real.
jest.mock('next/link', () => {
  return ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
});

// A generic icon mock: any named export becomes a stable svg component, so new
// icons in the page do not need this list to change.
jest.mock('lucide-react', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const icons = new Map<string, unknown>();
  const iconFor = (name: string) => {
    let icon = icons.get(name);
    if (!icon) {
      icon = (iconProps: Record<string, unknown>) =>
        ReactActual.createElement('svg', { 'data-icon': name, ...iconProps });
      icons.set(name, icon);
    }
    return icon;
  };
  return new Proxy(
    { __esModule: true },
    {
      get: (target, property) => {
        if (typeof property !== 'string' || property in target) {
          return Reflect.get(target, property);
        }
        return iconFor(property);
      },
    },
  );
});

jest.mock('@myorganiser/web-ui', () => ({
  AppLogo: ({ variant }: { variant?: string }) => (
    <span data-testid="app-logo">{variant}</span>
  ),
}));

import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import LandingContent from './LandingContent';
import { LandingSessionProvider } from './LandingSessionProvider';
import {
  ADDRESS_CHECKLIST,
  MOBILE_NUMBER_CHECKLIST,
} from '../content/featureClips';
import {
  FAQ_ITEMS,
  FREE_PLAN_CTA,
  GITHUB_NAV_LABEL,
  GITHUB_REPO_URL,
  PUBLIC_CODE_CTA,
  RENTERS_HEADING,
  STAGE_CTA,
  STAGE_HEADLINE,
} from '../content/landingCopy';

// The clip hook reads prefers-reduced-motion, and LandingMotion reads
// CSS.supports. jsdom provides neither. Report "motion allowed" and "scroll-driven
// animations supported" so LandingMotion takes its no-op path.
// Out of scope here: the IntersectionObserver fallback path in LandingMotion,
// the reduced-motion paths (hooks/use-clip-step.ts `!playing || reduced` and
// `reduced ? steps - 1 : step`, and LandingMotion.tsx's reduced-motion early
// return). These are animation behaviour, covered in FeatureClip.spec.tsx.
// Do not add reduced-motion tests here.
const globalWithCss = globalThis as typeof globalThis & { CSS?: unknown };
const originalCss = globalWithCss.CSS;
const originalMatchMedia = window.matchMedia;

function installBrowserStubs() {
  window.matchMedia = jest.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  globalWithCss.CSS = {
    supports: jest.fn(() => true),
  } as unknown as typeof CSS;
}

function restoreBrowserStubs() {
  window.matchMedia = originalMatchMedia;
  globalWithCss.CSS = originalCss;
}

function sectionById(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} anchor`);
  }
  return element;
}

describe('LandingContent', () => {
  beforeEach(() => {
    installBrowserStubs();
  });

  afterEach(() => {
    restoreBrowserStubs();
  });

  it('renders the page without a session provider and offers guest nav actions', () => {
    render(<LandingContent />);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Login' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(
      within(nav).getByRole('link', { name: 'Get Started' }),
    ).toHaveAttribute('href', '/signup');
    expect(
      screen.queryByRole('link', { name: 'Open dashboard' }),
    ).not.toBeInTheDocument();
  });

  it('has exactly one level-1 heading, named by the plaintext headline', () => {
    render(<LandingContent />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: STAGE_HEADLINE }),
    ).toBeInTheDocument();
  });

  it('routes the hero and the free-plan calls to action to signup', () => {
    render(<LandingContent />);

    expect(screen.getByRole('link', { name: STAGE_CTA })).toHaveAttribute(
      'href',
      '/signup',
    );
    expect(screen.getByRole('link', { name: FREE_PLAN_CTA })).toHaveAttribute(
      'href',
      '/signup',
    );
  });

  it('exposes the section anchors and points the desktop nav at them', () => {
    render(<LandingContent />);

    for (const id of ['features', 'moving', 'privacy', 'faq', 'pricing']) {
      expect(sectionById(id).tagName).toBe('SECTION');
    }

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Features' })).toHaveAttribute(
      'href',
      '#features',
    );
    expect(within(nav).getByRole('link', { name: 'Moving' })).toHaveAttribute(
      'href',
      '#moving',
    );
    expect(within(nav).getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      '#privacy',
    );
    expect(within(nav).getByRole('link', { name: 'FAQ' })).toHaveAttribute(
      'href',
      '#faq',
    );
    expect(
      within(nav).getByRole('link', { name: 'MyOrganiser home' }),
    ).toHaveAttribute('href', '/');
  });

  it('points the footer legal, account, and product links at their expected hrefs', () => {
    render(<LandingContent />);

    const footer = screen.getByRole('contentinfo');

    expect(
      screen.getAllByRole('link', { name: 'Privacy Policy' }),
    ).toHaveLength(1);
    expect(
      within(footer).getByRole('link', { name: 'Privacy Policy' }),
    ).toHaveAttribute('href', '/privacy');
    expect(
      screen.getAllByRole('link', { name: 'Terms of Service' }),
    ).toHaveLength(1);
    expect(
      within(footer).getByRole('link', { name: 'Terms of Service' }),
    ).toHaveAttribute('href', '/terms');

    expect(
      within(footer).getByRole('link', { name: 'Create account' }),
    ).toHaveAttribute('href', '/signup');
    expect(
      within(footer).getByRole('link', { name: 'Log in' }),
    ).toHaveAttribute('href', '/login');
    expect(
      within(footer).getByRole('link', { name: 'Mobile app' }),
    ).toHaveAttribute('href', '/download');

    for (const label of ['Features', 'Security', 'Pricing', 'FAQ']) {
      const link = within(footer).getByRole('link', { name: label });
      const href = link.getAttribute('href') ?? '';
      expect(href).toMatch(/^#/);
      expect(href).not.toBe('#');
      expect(document.querySelector(href)).not.toBeNull();
    }
  });

  it('links to the public GitHub repository from the nav, the pillars, and the footer without calling it open source', () => {
    render(<LandingContent />);

    const expectOpensSafelyToRepo = (link: HTMLElement) => {
      expect(link).toHaveAttribute('href', GITHUB_REPO_URL);
      expect(link).toHaveAttribute('target', '_blank');
      const rel = (link.getAttribute('rel') ?? '').split(' ');
      expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    };

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expectOpensSafelyToRepo(
      within(nav).getByRole('link', { name: GITHUB_NAV_LABEL }),
    );
    expectOpensSafelyToRepo(
      screen.getByRole('link', { name: PUBLIC_CODE_CTA }),
    );
    expectOpensSafelyToRepo(
      within(screen.getByRole('contentinfo')).getByRole('link', {
        name: 'GitHub',
      }),
    );

    // The licence is Elastic 2.0, source-available, so copy must not say open source.
    expect(document.body.textContent ?? '').not.toMatch(/open[ -]source/i);
  });

  it('lists the encryption-check question in the FAQ', () => {
    render(<LandingContent />);

    expect(
      within(sectionById('faq')).getByText(
        'Can I check how my data is encrypted?',
        { selector: 'summary' },
      ),
    ).toBeInTheDocument();
  });

  it('shows a copyright line for the current year', () => {
    render(<LandingContent />);

    const year = new Date().getFullYear();
    expect(
      screen.getByText(`© ${year} MyOrganiser. All rights reserved.`),
    ).toBeInTheDocument();
  });

  it('renders each FAQ question as a native disclosure sharing the landing-faq name group', () => {
    render(<LandingContent />);

    const disclosures = sectionById('faq').querySelectorAll('details');
    expect(disclosures).toHaveLength(FAQ_ITEMS.length);

    const questions = Array.from(disclosures).map(
      (disclosure) => disclosure.querySelector('summary')?.textContent,
    );
    expect(questions).toEqual(FAQ_ITEMS.map((item) => item.question));

    for (const disclosure of Array.from(disclosures)) {
      expect(disclosure).toHaveAttribute('name', 'landing-faq');
    }

    expect(
      screen.getByText('What happens if I forget my passphrase?').tagName,
    ).toBe('SUMMARY');
  });

  it('presents both mobile numbers and addresses in the renters block', () => {
    render(<LandingContent />);

    const moving = sectionById('moving');
    expect(
      within(moving).getByRole('heading', { level: 2, name: RENTERS_HEADING }),
    ).toBeInTheDocument();
    expect(
      within(moving).getByText(ADDRESS_CHECKLIST.heading),
    ).toBeInTheDocument();
    expect(
      within(moving).getByText(MOBILE_NUMBER_CHECKLIST.heading),
    ).toBeInTheDocument();
  });

  it('offers Open dashboard in place of sign-in links for a kept session', () => {
    render(
      <LandingSessionProvider view="session_kept">
        <LandingContent />
      </LandingSessionProvider>,
    );

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav).getByRole('link', { name: 'Open dashboard' }),
    ).toHaveAttribute('href', '/dashboard');
    expect(
      within(nav).queryByRole('link', { name: 'Get Started' }),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole('link', { name: 'Login' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the copy guardrails: no YouTube mention, no Support link, no feedback prompt', () => {
    render(<LandingContent />);

    expect(screen.queryAllByText(/youtube/i)).toHaveLength(0);
    expect(screen.queryAllByRole('link', { name: /support/i })).toHaveLength(0);
    expect(screen.queryAllByText(/send feedback/i)).toHaveLength(0);
  });

  it('shows Google Drive as a single standalone label in the feature cards', () => {
    render(<LandingContent />);

    expect(screen.getAllByText('Google Drive')).toHaveLength(1);
    expect(
      within(sectionById('features')).getByText('Google Drive'),
    ).toBeInTheDocument();
  });

  it('gives each auto-playing clip a pause control outside its hidden mock UI', () => {
    render(<LandingContent />);

    // Two renters-block clips plus the four feature-card clips.
    const pauseButtons = screen.getAllByRole('button', { name: 'Pause demo' });
    expect(pauseButtons).toHaveLength(6);
    for (const button of pauseButtons) {
      expect(button.closest('[aria-hidden="true"]')).toBeNull();
    }

    expect(
      screen.getByText('Renew passport').closest('[aria-hidden="true"]'),
    ).not.toBeNull();

    fireEvent.click(pauseButtons[0]);
    expect(pauseButtons[0]).toHaveAccessibleName('Play demo');
    expect(screen.getAllByRole('button', { name: 'Play demo' })).toHaveLength(
      1,
    );
  });
});
