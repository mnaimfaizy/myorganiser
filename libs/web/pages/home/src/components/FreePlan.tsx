import {
  colorCardVar,
  colorMutedVar,
  colorPrimaryVar,
  colorSecondaryVar,
  colorSuccessOnDarkVar,
  shadowCard,
} from '@myorganiser/design-tokens';
import { ArrowRight, Check } from 'lucide-react';
import Link from 'next/link';

import {
  FREE_PLAN_CHIP,
  FREE_PLAN_CTA,
  FREE_PLAN_INCLUDES_HEADING,
  FREE_PLAN_STEPS_HEADING,
  SIGNUP_INCLUDES,
  SIGNUP_STEPS,
} from '../content/landingCopy';

/** What an account includes, and the four steps to get running. */
export function FreePlan() {
  return (
    <section id="pricing" className="px-4 pb-24">
      <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-[1.1fr_1fr]">
        <div
          className="lp-scale rounded-[2.5rem] p-10 text-white"
          style={{ background: colorPrimaryVar }}
        >
          <span
            className="rounded-full px-3 py-1 text-xs font-bold text-black"
            style={{ background: colorSuccessOnDarkVar }}
          >
            {FREE_PLAN_CHIP}
          </span>
          <h2 className="mt-6 text-4xl font-bold tracking-tight">
            {FREE_PLAN_INCLUDES_HEADING}
          </h2>
          <ul className="mt-8 space-y-4">
            {SIGNUP_INCLUDES.map((item) => (
              <li key={item.title} className="flex gap-3">
                <Check
                  className="mt-1 h-5 w-5 shrink-0"
                  style={{ color: colorSuccessOnDarkVar }}
                  aria-hidden="true"
                />
                <span>
                  <span className="font-semibold">{item.title}</span>
                  <span className="block text-sm text-white/65">
                    {item.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div
          className="lp-scale flex flex-col rounded-[2.5rem] p-10"
          style={{ background: colorCardVar, boxShadow: shadowCard }}
        >
          <h2 className="text-2xl font-bold tracking-tight">
            {FREE_PLAN_STEPS_HEADING}
          </h2>
          <ol className="mt-8 space-y-6">
            {SIGNUP_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span
                  className="text-3xl font-black tabular-nums"
                  style={{ color: colorMutedVar }}
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>
                  <span className="font-semibold">{step.title}</span>
                  <span
                    className="block text-sm"
                    style={{ color: colorMutedVar }}
                  >
                    {step.detail}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <Link
            href="/signup"
            className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg px-6 py-4 font-semibold text-white"
            style={{ background: colorSecondaryVar }}
          >
            {FREE_PLAN_CTA}{' '}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
