import {
  colorCardVar,
  colorMutedVar,
  colorPrimaryVar,
  colorSuccessOnDarkVar,
} from '@myorganiser/design-tokens';
import { Lock } from 'lucide-react';
import type { CSSProperties } from 'react';

import { FLIP_CARDS } from '../content/landingCopy';

/**
 * Three cards that show what the server stores (a ciphertext face) and then flip
 * to what the user sees. The ciphertext face is hidden from assistive technology
 * so the plaintext is the only text read out.
 */
export function FlipCards() {
  const perspective: CSSProperties = { perspective: '1200px' };
  return (
    <div className="lp-cards" style={perspective}>
      <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
        {FLIP_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="lp-card">
              <div
                aria-hidden="true"
                className="lp-face flex flex-col justify-between rounded-3xl border border-white/10 bg-white/5 p-5 text-left"
              >
                <span
                  className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-black"
                  style={{ background: colorSuccessOnDarkVar }}
                >
                  <Lock className="h-3.5 w-3.5" /> Encrypted
                </span>
                <span className="font-mono text-lg text-white/70">
                  {card.cipher}
                </span>
              </div>
              <div
                className="lp-face lp-face-back flex flex-col justify-between rounded-3xl p-5 text-left"
                style={{ background: colorCardVar, color: colorPrimaryVar }}
              >
                <span
                  className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
                  style={{ color: colorMutedVar }}
                >
                  <Icon className="h-4 w-4" /> {card.label}
                </span>
                <span className="text-lg font-semibold">{card.plain}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
