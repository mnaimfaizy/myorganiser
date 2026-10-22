import { AppLogo, cn } from '@myorganiser/web-ui';
import Link from 'next/link';
import type { LegalDocumentKind } from '../lib/legal-sections';

export interface LegalPageHeaderProps {
  /** The document this page shows, so its nav link can be marked current. */
  current?: LegalDocumentKind;
}

const NAV_LINK_CLASS =
  'inline-flex h-10 items-center rounded-control-sm px-3 text-control-sm text-foreground-secondary hover:bg-muted';

const LEGAL_NAV_LINKS = [
  { kind: 'privacy', href: '/privacy', label: 'Privacy Policy' },
  { kind: 'terms', href: '/terms', label: 'Terms of Service' },
] as const satisfies ReadonlyArray<{
  kind: LegalDocumentKind;
  href: string;
  label: string;
}>;

/** Slim bar with the home logo and the Legal nav. */
export function LegalPageHeader({ current }: LegalPageHeaderProps) {
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
        {LEGAL_NAV_LINKS.map((link) => {
          const isCurrent = current === link.kind;
          return (
            <Link
              key={link.kind}
              href={link.href}
              aria-current={isCurrent ? 'page' : undefined}
              className={cn(
                NAV_LINK_CLASS,
                isCurrent && 'bg-brand-soft text-brand-text',
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
