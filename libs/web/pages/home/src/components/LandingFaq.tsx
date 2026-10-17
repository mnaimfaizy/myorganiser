import {
  colorBorderVar,
  colorCardVar,
  colorMutedVar,
} from '@myorganiser/design-tokens';
import { ChevronDown } from 'lucide-react';

import { FAQ_ITEMS } from '../content/landingCopy';

/**
 * The FAQ accordion. Native details elements sharing one name, so opening one
 * closes the others. The open and close animation is in LandingMotion.
 */
export function LandingFaq() {
  return (
    <section id="faq" className="px-4 py-24">
      <div className="mx-auto max-w-3xl">
        <h2 className="lp-reveal text-center text-3xl font-bold tracking-tight md:text-4xl">
          Questions, answered
        </h2>
        <div className="mt-10 space-y-3">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.question}
              name="landing-faq"
              className="lp-reveal rounded-2xl border px-5 py-4"
              style={{
                borderColor: colorBorderVar,
                background: colorCardVar,
              }}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 font-semibold">
                {item.question}
                <ChevronDown
                  className="lp-chevron h-5 w-5 shrink-0"
                  style={{ color: colorMutedVar }}
                  aria-hidden="true"
                />
              </summary>
              <p
                className="pt-3 text-sm leading-relaxed"
                style={{ color: colorMutedVar }}
              >
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
