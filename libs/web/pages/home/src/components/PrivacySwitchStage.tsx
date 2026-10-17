import {
  colorSecondaryVar,
  colorSuccessOnDarkVar,
} from '@myorganiser/design-tokens';
import { ArrowDown, ArrowRight } from 'lucide-react';
import Link from 'next/link';

import {
  STAGE_CAPTION,
  STAGE_CHIP,
  STAGE_CTA,
  STAGE_HEADLINE,
  STAGE_HINT,
  STAGE_INTRO,
  STAGE_REVEAL,
} from '../content/landingCopy';
import { CipherHeadline } from './CipherHeadline';
import { FlipCards } from './FlipCards';
import { PrivacySwitch } from './PrivacySwitch';

/**
 * The scroll-driven privacy stage. Scrolling flips the switch on, the page goes
 * dark, the headline scrambles into ciphertext, and three cards flip from what the
 * server stores to what the user sees. Its CSS lives in LandingMotion.
 */
export function PrivacySwitchStage() {
  return (
    <section id="privacy" className="lp-stage">
      <div className="lp-sticky text-center">
        <div className="lp-hero flex flex-col items-center">
          <p className="lp-intro mb-4 rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold backdrop-blur">
            {STAGE_CHIP}
          </p>
          <CipherHeadline text={STAGE_HEADLINE} />
          <p className="lp-intro mt-5 max-w-xl text-lg text-white/85">
            {STAGE_INTRO}
          </p>
          <div className="lp-intro mt-7">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-7 py-3.5 font-semibold"
              style={{ color: colorSecondaryVar }}
            >
              {STAGE_CTA} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <PrivacySwitch />
        </div>

        <div className="lp-stack">
          <p className="lp-caption text-2xl font-semibold md:text-3xl">
            {STAGE_CAPTION}
          </p>
          <FlipCards />
          <p
            className="lp-last mt-8 text-xl font-semibold"
            style={{ color: colorSuccessOnDarkVar }}
          >
            {STAGE_REVEAL}
          </p>
        </div>

        <p className="lp-hint flex flex-col items-center gap-1 text-center text-sm text-white/80">
          {STAGE_HINT}
          <ArrowDown
            className="h-4 w-4 motion-safe:animate-bounce"
            aria-hidden="true"
          />
        </p>
      </div>
    </section>
  );
}
