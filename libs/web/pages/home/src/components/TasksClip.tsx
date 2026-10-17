import {
  colorMutedVar,
  colorSuccessVar,
  colorSurfaceContainerVar,
} from '@myorganiser/design-tokens';
import { Check } from 'lucide-react';

import { type ClipBodyProps, TASK_NAMES } from '../content/featureClips';
import { ClipRow } from './ClipRow';

/** Today's task list being worked through, one task ticked per step. */
export function TasksClip({ step }: ClipBodyProps) {
  const total = TASK_NAMES.length;
  const done = Math.min(step, total);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">Today</span>
        <span
          className="whitespace-nowrap text-xs"
          style={{ color: colorMutedVar }}
        >
          {done}/{total} done
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full"
        style={{ background: colorSurfaceContainerVar }}
      >
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{
            width: `${(done / total) * 100}%`,
            background: colorSuccessVar,
          }}
        />
      </div>
      {TASK_NAMES.map((name, index) => {
        const ticked = index < done;
        return (
          <ClipRow key={name} highlight={index === done}>
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all duration-500 ease-out"
              style={{
                borderColor: ticked ? colorSuccessVar : colorMutedVar,
                background: ticked ? colorSuccessVar : 'transparent',
              }}
            >
              {ticked ? <Check className="h-3 w-3 text-white" /> : null}
            </span>
            <span
              className={`transition-all duration-500 ease-out ${ticked ? 'line-through opacity-50' : ''}`}
            >
              {name}
            </span>
          </ClipRow>
        );
      })}
    </div>
  );
}
