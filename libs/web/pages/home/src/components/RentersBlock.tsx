import {
  colorPrimaryVar,
  colorSuccessOnDarkVar,
} from '@myorganiser/design-tokens';
import { Check, Lock } from 'lucide-react';

import {
  RENTERS_BODY,
  RENTERS_CHIP,
  RENTERS_HEADING,
  RENTERS_POINTS,
} from '../content/landingCopy';
import { FeatureClip } from './FeatureClip';
import { PhoneFrame } from './PhoneFrame';

/** The renters block: a navy colour panel with a phone clip and an overlapping address clip. */
export function RentersBlock() {
  return (
    <section id="moving" className="px-4">
      <div
        className="lp-scale mx-auto grid max-w-6xl items-center gap-10 overflow-hidden rounded-[2.5rem] p-8 text-white md:grid-cols-2 md:p-14"
        style={{ background: colorPrimaryVar }}
      >
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-black/25 px-3 py-1 text-xs font-bold">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {RENTERS_CHIP}
          </span>
          <h2 className="mt-5 text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            {RENTERS_HEADING}
          </h2>
          <p className="mt-5 text-lg text-white/85">{RENTERS_BODY}</p>
          <ul className="mt-6 space-y-2">
            {RENTERS_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <Check
                  className="h-5 w-5 shrink-0"
                  style={{ color: colorSuccessOnDarkVar }}
                  aria-hidden="true"
                />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex justify-center">
          <div className="lp-float">
            <PhoneFrame>
              <FeatureClip
                feature="mobileNumbers"
                bare
                compact
                className="h-[440px]"
              />
            </PhoneFrame>
          </div>
          <div className="absolute -bottom-6 -left-4 hidden w-72 rotate-[-4deg] lg:block">
            <FeatureClip feature="addresses" compact />
          </div>
        </div>
      </div>
    </section>
  );
}
