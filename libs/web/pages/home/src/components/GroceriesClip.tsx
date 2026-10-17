import { colorMutedVar, colorSuccessVar } from '@myorganiser/design-tokens';
import { Check, Laptop, Smartphone } from 'lucide-react';

import { type ClipBodyProps, GROCERY_ITEMS } from '../content/featureClips';
import { ClipRow } from './ClipRow';

/** A shopping list built on the laptop, then ticked off on the phone in the shop. */
export function GroceriesClip({ step }: ClipBodyProps) {
  // Steps 0-3 add items on the laptop; steps 4-6 tick them off on the phone.
  const added = Math.min(step + 1, GROCERY_ITEMS.length);
  const ticked = Math.max(0, step - 3);
  const onPhone = step >= 4;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center gap-2 text-xs font-semibold"
        style={{ color: colorMutedVar }}
      >
        {onPhone ? (
          <Smartphone className="h-4 w-4 shrink-0" />
        ) : (
          <Laptop className="h-4 w-4 shrink-0" />
        )}
        {/* Both captions occupy the same grid cell, so the header keeps the
            taller caption's height whichever one is showing. */}
        <span className="grid min-w-0 text-left">
          <span
            className={`col-start-1 row-start-1 transition-opacity duration-500 ease-out ${onPhone ? 'opacity-0' : 'opacity-100'}`}
          >
            At home, on your laptop
          </span>
          <span
            className={`col-start-1 row-start-1 transition-opacity duration-500 ease-out ${onPhone ? 'opacity-100' : 'opacity-0'}`}
          >
            In the shop, on your phone
          </span>
        </span>
      </div>
      {/* Every row is always mounted so the card keeps its final height; rows
          not yet added are faded and nudged out of place. */}
      {GROCERY_ITEMS.map((item, index) => {
        const isAdded = index < added;
        const isTicked = index < ticked;
        return (
          <div
            key={item}
            className={`transition-all duration-500 ease-out ${isAdded ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'}`}
          >
            <ClipRow highlight={!onPhone && index === added - 1}>
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all duration-500 ease-out"
                style={{
                  borderColor: isTicked ? colorSuccessVar : colorMutedVar,
                  background: isTicked ? colorSuccessVar : 'transparent',
                }}
              >
                {isTicked ? <Check className="h-3 w-3 text-white" /> : null}
              </span>
              <span
                className={`transition-all duration-500 ease-out ${isTicked ? 'line-through opacity-50' : ''}`}
              >
                {item}
              </span>
            </ClipRow>
          </div>
        );
      })}
    </div>
  );
}
