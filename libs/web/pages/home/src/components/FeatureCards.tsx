import { colorMutedVar, colorSuccessVar } from '@myorganiser/design-tokens';
import { Lock } from 'lucide-react';

import { FEATURE_CARDS } from '../content/landingCopy';
import { FeatureClip } from './FeatureClip';

/** The four feature cards, each on a soft tint with its own animated clip. */
export function FeatureCards() {
  return (
    <section id="features" className="px-4 py-24">
      <div className="mx-auto max-w-6xl">
        <h2 className="lp-reveal max-w-2xl text-4xl font-bold tracking-tight md:text-5xl">
          Everything else in your life, sealed the same way.
        </h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {FEATURE_CARDS.map((card) => (
            <article
              key={card.feature}
              className={`lp-scale flex flex-col gap-6 rounded-[2rem] p-7 ${card.span}`}
              style={{
                background: `color-mix(in srgb, ${card.tintVar} 10%, white)`,
              }}
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className="text-xs font-bold uppercase tracking-widest"
                    style={{ color: colorMutedVar }}
                  >
                    {card.eyebrow}
                  </span>
                  <span className="flex items-center gap-2">
                    {card.chip ? (
                      <span
                        className="rounded-full border border-black/5 bg-white px-2 py-0.5 text-[11px] font-bold"
                        style={{ color: colorMutedVar }}
                      >
                        {card.chip}
                      </span>
                    ) : null}
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold"
                      style={{ color: colorSuccessVar }}
                    >
                      <Lock className="h-3 w-3" aria-hidden="true" /> encrypted
                    </span>
                  </span>
                </div>
                <h3 className="mt-3 text-2xl font-bold tracking-tight">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm" style={{ color: colorMutedVar }}>
                  {card.blurb}
                </p>
              </div>
              <FeatureClip feature={card.feature} compact className="mt-auto" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
