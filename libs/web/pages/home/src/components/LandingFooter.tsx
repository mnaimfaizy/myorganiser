import {
  colorBorderVar,
  colorMutedVar,
  colorPrimaryVar,
  colorSuccessVar,
  colorSurfaceContainerVar,
} from '@myorganiser/design-tokens';
import { AppLogo } from '@myorganiser/web-ui';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { FOOTER_COLUMNS, FOOTER_TAGLINE } from '../content/landingCopy';

/** The footer: logo, tagline, encryption status, and the link columns. */
export function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer
      className="border-t"
      style={{
        background: colorSurfaceContainerVar,
        borderColor: colorBorderVar,
        color: colorPrimaryVar,
      }}
    >
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-4 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="col-span-2 md:col-span-1">
          <AppLogo variant="full" height={28} aria-hidden />
          <p className="mt-4 max-w-xs text-sm" style={{ color: colorMutedVar }}>
            {FOOTER_TAGLINE}
          </p>
          <span
            className="mt-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
            style={{ borderColor: colorBorderVar, color: colorSuccessVar }}
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{' '}
            End-to-end encrypted
          </span>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.heading} aria-label={column.heading}>
            <h2
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: colorMutedVar }}
            >
              {column.heading}
            </h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-opacity hover:opacity-70"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="transition-opacity hover:opacity-70"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t" style={{ borderColor: colorBorderVar }}>
        <div
          className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs md:flex-row"
          style={{ color: colorMutedVar }}
        >
          <span>© {year} MyOrganiser. All rights reserved.</span>
          <span>
            Your vault is encrypted on your device. We only ever store
            ciphertext.
          </span>
        </div>
      </div>
    </footer>
  );
}
