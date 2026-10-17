import {
  colorMutedVar,
  colorPrimaryVar,
  colorSurfaceContainerVar,
  colorWarningVar,
} from '@myorganiser/design-tokens';

import {
  type ClipBodyProps,
  SUBSCRIPTION_SAMPLES,
} from '../content/featureClips';
import { ClipRow } from './ClipRow';

/** Subscriptions restated as a monthly equivalent, with upcoming renewals flagged. */
export function SubscriptionsClip({ step }: ClipBodyProps) {
  const shown = Math.min(step + 1, SUBSCRIPTION_SAMPLES.length);
  const monthlyEquivalent = SUBSCRIPTION_SAMPLES.slice(0, shown).reduce(
    (sum, subscription) => sum + subscription.price,
    0,
  );
  const renewalsFlagged = step >= 4;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="whitespace-nowrap font-semibold">
          Monthly equivalent
        </span>
        <span
          className="whitespace-nowrap text-2xl font-bold tabular-nums"
          style={{ color: colorPrimaryVar }}
        >
          £{monthlyEquivalent.toFixed(2)}
        </span>
      </div>
      {SUBSCRIPTION_SAMPLES.map((subscription, index) => {
        const soon = subscription.daysToRenewal <= 3;
        return (
          <div
            key={subscription.name}
            className={`transition-all duration-500 ease-out ${index < shown ? 'opacity-100' : 'translate-x-4 opacity-0'}`}
          >
            <ClipRow highlight={renewalsFlagged && soon}>
              <span className="flex-1 font-medium">{subscription.name}</span>
              <span
                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${renewalsFlagged && soon ? 'motion-safe:animate-pulse' : ''}`}
                style={{
                  background: soon
                    ? `color-mix(in srgb, ${colorWarningVar} 15%, transparent)`
                    : colorSurfaceContainerVar,
                  color: soon ? colorWarningVar : colorMutedVar,
                }}
              >
                renews in {subscription.daysToRenewal}d
              </span>
              <span
                className="text-xs tabular-nums"
                style={{ color: colorMutedVar }}
              >
                £{subscription.price.toFixed(2)}
              </span>
            </ClipRow>
          </div>
        );
      })}
    </div>
  );
}
