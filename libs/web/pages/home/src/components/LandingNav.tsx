import {
  colorBorderVar,
  colorCardVar,
  colorMutedVar,
  colorPrimary,
  colorSurface,
  colorSecondary,
  colorBorder,
  colorMuted,
  shadowPopover,
} from '@myorganiser/design-tokens';
import { AppLogo } from '@myorganiser/web-ui';
import { Github } from 'lucide-react';
import Link from 'next/link';

import {
  GITHUB_NAV_LABEL,
  GITHUB_REPO_URL,
  NAV_LINKS,
} from '../content/landingCopy';
import { LandingNavActions } from './LandingNavActions';
import MobileMenu from './MobileMenu';

/** The floating top bar: logo, section anchors, and the auth actions. */
export function LandingNav() {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 top-2 z-50 px-3">
      <div
        className="mx-auto flex h-14 max-w-5xl items-center justify-between rounded-2xl border px-3 pl-5 backdrop-blur-md"
        style={{
          borderColor: colorBorderVar,
          background: `color-mix(in srgb, ${colorCardVar} 85%, transparent)`,
          boxShadow: shadowPopover,
        }}
      >
        <Link href="/" aria-label="MyOrganiser home">
          <AppLogo variant="full" height={26} aria-hidden />
        </Link>
        <div className="hidden gap-6 text-sm font-medium md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-opacity hover:opacity-70"
              style={{ color: colorMutedVar }}
            >
              {link.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={GITHUB_NAV_LABEL}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-[color:var(--color-muted)] transition-colors hover:text-[color:var(--color-primary)] md:inline-flex"
          >
            <Github className="h-5 w-5" aria-hidden="true" />
          </a>
          <LandingNavActions />
          <MobileMenu
            links={NAV_LINKS}
            palette={{
              primary: colorPrimary,
              surface: colorSurface,
              border: colorBorder,
              muted: colorMuted,
              secondary: colorSecondary,
            }}
          />
        </div>
      </div>
    </nav>
  );
}
