import {
  colorMutedVar,
  colorPrimaryVar,
  colorSuccessVar,
  colorWarningVar,
} from '@myorganiser/design-tokens';
import { Check } from 'lucide-react';

import {
  type ChangeChecklistConfig,
  type ClipBodyProps,
} from '../content/featureClips';
import { ClipRow } from './ClipRow';

interface ChangeChecklistClipProps extends ClipBodyProps {
  config: ChangeChecklistConfig;
}

/**
 * A change-of-details checklist: who still holds the old detail, notified one
 * at a time. Addresses and mobile numbers are two configurations of this clip.
 */
export function ChangeChecklistClip({
  step,
  compact,
  config,
}: ChangeChecklistClipProps) {
  const { icon: Icon, from, to, heading, organisations } = config;
  const total = organisations.length;
  // Steps 0-4 notify each organisation in turn; steps 5+ are all done.
  const notified = Math.min(Math.max(step, 0), total);
  const done = notified === total;
  const rows = compact ? organisations.slice(0, 4) : organisations;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold"
        style={{
          background: `color-mix(in srgb, ${colorPrimaryVar} 8%, transparent)`,
          color: colorPrimaryVar,
        }}
      >
        <span className="shrink-0">
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate">
          <span className="line-through opacity-60">{from}</span> → {to}
        </span>
      </div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold">{heading}</span>
        <span
          className="shrink-0 whitespace-nowrap tabular-nums"
          style={{ color: done ? colorSuccessVar : colorMutedVar }}
        >
          {done ? 'All notified ✓' : `${notified} of ${total} notified`}
        </span>
      </div>
      {rows.map((organisation, index) => {
        const isNotified = index < notified;
        return (
          <ClipRow
            key={organisation.org}
            highlight={index === notified && !done}
          >
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all duration-500 ease-out"
              style={{
                borderColor: isNotified ? colorSuccessVar : colorMutedVar,
                background: isNotified ? colorSuccessVar : 'transparent',
              }}
            >
              {isNotified ? <Check className="h-3 w-3 text-white" /> : null}
            </span>
            <span
              className={`flex-1 truncate transition-all duration-500 ease-out ${isNotified ? 'opacity-50' : ''}`}
            >
              {organisation.org}
            </span>
            {compact ? null : (
              <span
                className="hidden text-[11px] sm:inline"
                style={{ color: colorMutedVar }}
              >
                {organisation.how}
              </span>
            )}
            {organisation.urgent ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: `color-mix(in srgb, ${colorWarningVar} 15%, transparent)`,
                  color: colorWarningVar,
                }}
              >
                urgent
              </span>
            ) : null}
          </ClipRow>
        );
      })}
    </div>
  );
}
