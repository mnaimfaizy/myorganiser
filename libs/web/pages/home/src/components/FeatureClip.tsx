'use client';

import {
  colorBorderVar,
  colorCardVar,
  colorMutedVar,
  colorPrimaryVar,
  colorSurfaceContainerVar,
} from '@myorganiser/design-tokens';
import { Pause, Play } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';

import {
  ADDRESS_CHECKLIST,
  CLIP_PATHS,
  CLIP_STEPS,
  type ClipBodyProps,
  type FeatureKey,
  MOBILE_NUMBER_CHECKLIST,
} from '../content/featureClips';
import { useClipStep } from '../hooks/use-clip-step';
import { ChangeChecklistClip } from './ChangeChecklistClip';
import { GroceriesClip } from './GroceriesClip';
import { SubscriptionsClip } from './SubscriptionsClip';
import { TasksClip } from './TasksClip';
import { VaultCopyClip } from './VaultCopyClip';

const CLIP_BODIES = {
  tasks: (props: ClipBodyProps) => <TasksClip {...props} />,
  subscriptions: (props: ClipBodyProps) => <SubscriptionsClip {...props} />,
  groceries: (props: ClipBodyProps) => <GroceriesClip {...props} />,
  vaultCopy: (props: ClipBodyProps) => <VaultCopyClip {...props} />,
  addresses: (props: ClipBodyProps) => (
    <ChangeChecklistClip {...props} config={ADDRESS_CHECKLIST} />
  ),
  mobileNumbers: (props: ClipBodyProps) => (
    <ChangeChecklistClip {...props} config={MOBILE_NUMBER_CHECKLIST} />
  ),
} as const satisfies Record<FeatureKey, (props: ClipBodyProps) => ReactNode>;

interface FeatureClipProps {
  feature: FeatureKey;
  /** Drop the window chrome (border, address bar) for a clip inside a device frame. */
  bare?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * A looping mock-UI clip standing in for a feature video. It plays on its own,
 * with a pause control for WCAG 2.2.2, and the mock UI itself is hidden from
 * assistive technology because the feature copy beside it carries the meaning.
 */
export function FeatureClip({
  feature,
  bare = false,
  compact = false,
  className = '',
}: FeatureClipProps) {
  const [playing, setPlaying] = useState(true);
  const steps = CLIP_STEPS[feature];
  const step = useClipStep(steps, playing);
  const renderBody = CLIP_BODIES[feature];
  const togglePlaying = useCallback(
    () => setPlaying((current) => !current),
    [],
  );

  return (
    <div
      className={`relative flex flex-col overflow-hidden ${bare ? '' : 'rounded-2xl border shadow-xl'} ${className}`}
      style={{
        background: colorCardVar,
        borderColor: bare ? undefined : colorBorderVar,
      }}
    >
      {bare ? null : (
        <div
          aria-hidden="true"
          className="flex items-center gap-1.5 border-b px-3 py-2"
          style={{ borderColor: colorBorderVar }}
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: colorBorderVar }}
          />
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: colorBorderVar }}
          />
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: colorBorderVar }}
          />
          <span
            className="ml-3 truncate text-[11px] font-medium"
            style={{ color: colorMutedVar }}
          >
            /dashboard/{CLIP_PATHS[feature]}
          </span>
        </div>
      )}
      <div
        aria-hidden="true"
        className={`relative flex-1 ${compact ? 'p-3' : 'p-5'}`}
        style={{ color: colorPrimaryVar }}
      >
        {renderBody({ step, compact })}
      </div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <button
          type="button"
          onClick={togglePlaying}
          aria-label={playing ? 'Pause demo' : 'Play demo'}
          className="rounded-full p-1"
          style={{ color: colorMutedVar }}
        >
          {playing ? (
            <Pause className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Play className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
        <div
          aria-hidden="true"
          className="h-1 flex-1 overflow-hidden rounded-full"
          style={{ background: colorSurfaceContainerVar }}
        >
          <div
            className="h-full rounded-full transition-all duration-1000 ease-linear"
            style={{
              width: `${((step + 1) / steps) * 100}%`,
              background: colorPrimaryVar,
            }}
          />
        </div>
      </div>
    </div>
  );
}
