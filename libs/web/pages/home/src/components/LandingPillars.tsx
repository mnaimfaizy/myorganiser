import {
  colorBorderVar,
  colorCardVar,
  colorMutedVar,
  colorOnPrimaryVar,
  colorPrimaryVar,
  radiusMdVar,
  shadowCard,
} from '@myorganiser/design-tokens';
import { Github } from 'lucide-react';

import {
  GITHUB_REPO_URL,
  PILLARS,
  PUBLIC_CODE_CTA,
  PUBLIC_CODE_HEADING,
  PUBLIC_CODE_TEXT,
} from '../content/landingCopy';

/** Three promises the product makes about what it does not do, then the public-code strip. */
export function LandingPillars() {
  return (
    <section className="px-4 py-24">
      <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-3">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <article
              key={pillar.title}
              className="lp-reveal rounded-[2rem] p-8"
              style={{ background: colorCardVar, boxShadow: shadowCard }}
            >
              <span
                className="inline-flex h-12 w-12 items-center justify-center rounded-2xl text-white"
                style={{ background: colorPrimaryVar }}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 className="mt-6 text-3xl font-bold tracking-tight">
                {pillar.title}
              </h2>
              <p className="mt-2" style={{ color: colorMutedVar }}>
                {pillar.text}
              </p>
            </article>
          );
        })}
      </div>
      <div
        className="lp-reveal mx-auto mt-4 flex max-w-6xl flex-col gap-6 rounded-2xl border p-8 md:flex-row md:items-center md:justify-between"
        style={{ background: colorCardVar, borderColor: colorBorderVar }}
      >
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {PUBLIC_CODE_HEADING}
          </h2>
          <p className="mt-2" style={{ color: colorMutedVar }}>
            {PUBLIC_CODE_TEXT}
          </p>
        </div>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-2 px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{
            background: colorPrimaryVar,
            color: colorOnPrimaryVar,
            borderRadius: radiusMdVar,
          }}
        >
          <Github className="h-4 w-4" aria-hidden="true" />
          {PUBLIC_CODE_CTA}
        </a>
      </div>
    </section>
  );
}
