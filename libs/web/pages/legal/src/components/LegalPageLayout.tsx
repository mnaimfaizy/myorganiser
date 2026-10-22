import {
  AppLogo,
  cn,
  Illustration,
  type IllustrationKind,
} from '@myorganiser/web-ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LegalBackLink } from './LegalBackLink';

export interface LegalPageLayoutProps {
  children: ReactNode;
}

export interface LegalPageHeaderProps {
  /** The document this page shows, so its nav link can be marked current. */
  current?: 'privacy' | 'terms';
}

export interface LegalPageHeroProps {
  title: string;
  illustration: IllustrationKind;
  /** Shown as "Last updated: …" under the title when given. */
  lastUpdated?: string;
}

export interface LegalPageTocEntry {
  id: string;
  title: string;
}

export interface LegalPageBodyProps {
  /** Renders the "On this page" card when given and not empty. */
  toc?: ReadonlyArray<LegalPageTocEntry>;
  children: ReactNode;
}

export interface LegalPageActionsProps {
  children: ReactNode;
}

const NAV_LINK =
  'inline-flex h-10 items-center rounded-control-sm px-3 text-control-sm text-foreground-secondary hover:bg-muted';

function LegalPageLayoutHeader({ current }: LegalPageHeaderProps) {
  return (
    <header className="flex items-center gap-4 border-b border-border bg-card px-6 py-3.5">
      <Link
        href="/"
        aria-label="MyOrganiser home"
        className="flex flex-1 items-center rounded-control-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <AppLogo variant="full" height={32} aria-hidden />
      </Link>
      <nav aria-label="Legal" className="flex flex-wrap gap-1">
        <Link
          href="/privacy"
          aria-current={current === 'privacy' ? 'page' : undefined}
          className={cn(
            NAV_LINK,
            current === 'privacy' && 'bg-brand-soft text-brand-text',
          )}
        >
          Privacy Policy
        </Link>
        <Link
          href="/terms"
          aria-current={current === 'terms' ? 'page' : undefined}
          className={cn(
            NAV_LINK,
            current === 'terms' && 'bg-brand-soft text-brand-text',
          )}
        >
          Terms of Service
        </Link>
      </nav>
    </header>
  );
}

function LegalPageLayoutHero({
  title,
  illustration,
  lastUpdated,
}: LegalPageHeroProps) {
  return (
    <div className="bg-primary px-6 py-10 text-primary-foreground">
      <div className="mx-auto flex max-w-[1040px] flex-wrap items-center gap-6">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col items-start">
          <LegalBackLink />
          <h1 className="font-display text-[36px] font-extrabold leading-[44px] tracking-[-0.02em]">
            {title}
          </h1>
          {lastUpdated && (
            <p className="mt-2 text-sm text-navy-muted-foreground">
              Last updated: {lastUpdated}
            </p>
          )}
        </div>
        <Illustration kind={illustration} size={96} />
      </div>
    </div>
  );
}

function LegalPageLayoutBody({ toc, children }: LegalPageBodyProps) {
  return (
    <main className="mx-auto flex w-full max-w-[1040px] flex-wrap items-start gap-8 px-6 pb-12 pt-8">
      {toc && toc.length > 0 && (
        <nav
          aria-label="On this page"
          className="flex min-w-[220px] flex-[0_1_240px] flex-col gap-0.5 rounded-xl border border-border bg-card p-4"
        >
          <span className="px-2.5 pb-1.5 text-label-caps uppercase text-muted-foreground">
            On this page
          </span>
          {toc.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              className="block rounded-lg px-2.5 py-2 text-sm font-medium text-foreground-secondary hover:bg-muted"
            >
              {entry.title}
            </a>
          ))}
        </nav>
      )}
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
        {children}
      </div>
    </main>
  );
}

function LegalPageLayoutActions({ children }: LegalPageActionsProps) {
  return <div className="flex flex-wrap gap-2.5 pt-2">{children}</div>;
}

function LegalPageLayoutFooter() {
  return (
    <footer className="border-t border-border bg-card px-6 py-5 text-caption text-muted-foreground">
      <div className="mx-auto flex max-w-[1040px] flex-wrap justify-between gap-x-6 gap-y-2">
        <span>
          © {new Date().getFullYear()} MyOrganiser. All rights reserved.
        </span>
        <span>
          Your vault is encrypted on your device. We only ever store ciphertext.
        </span>
      </div>
    </footer>
  );
}

/**
 * Shell shared by the standalone legal pages: a bar with the two legal links, a
 * navy hero, a body with an optional "On this page" card, and a footer. The
 * sub-parts are attached as properties so a page arranges them itself.
 */
export function LegalPageLayout({ children }: LegalPageLayoutProps) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background text-foreground">
      {children}
    </div>
  );
}

LegalPageLayout.Header = LegalPageLayoutHeader;
LegalPageLayout.Hero = LegalPageLayoutHero;
LegalPageLayout.Body = LegalPageLayoutBody;
LegalPageLayout.Actions = LegalPageLayoutActions;
LegalPageLayout.Footer = LegalPageLayoutFooter;
