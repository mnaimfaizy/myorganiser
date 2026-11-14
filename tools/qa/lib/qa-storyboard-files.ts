/**
 * The steps `qa:run` and `qa:combine` share to make a scenario's QA Artifact
 * (PRD #1544): the checked fields of a `video` scenario's MP4 labels, the
 * Storyboard PNG, and the sides of the annotated MP4. Lifted out of
 * `qa-run-executor.ts` unchanged, so a re-render from saved step records makes
 * the same files by construction.
 */
import { dirname } from 'node:path';

import type { CheckedField } from './caption-privacy.ts';
import { firstLine } from './qa-cli.ts';
import type { VideoSide } from './qa-combine.ts';
import type { Mp4TabChoice } from './qa-run.ts';
import { tabLabel } from './qa-scenario-context.ts';
import type { Side } from './qa-stack.ts';
import { SIDES } from './qa-switch.ts';
import type { Storyboard, StoryboardSideInput } from './storyboard.ts';

/** The recording an MP4 follows on one side, with that tab's label when known. */
export type Mp4SideChoice = Mp4TabChoice & { label?: string };

/** The MP4 shows its tab's label on each side, which no step need carry. */
export function videoLabelFields(
  id: string,
  choices: Partial<Record<Side, Mp4SideChoice>>,
): CheckedField[] {
  return SIDES.flatMap((side) => {
    const mp4Tab = choices[side];
    return mp4Tab?.ok && mp4Tab.label !== undefined
      ? [{ field: `${id} video ${side} label`, text: mp4Tab.label }]
      : [];
  });
}

/** What a Storyboard render needs from the machine. */
export interface StoryboardRenderDeps {
  renderStoryboard(
    storyboard: Storyboard,
    stillRoot: string,
    pngPath: string,
  ): Promise<void>;
  makeDir(path: string): void;
  removePath(path: string): void;
}

/**
 * Renders the Storyboard to `png`, its stills relative to `stillRoot`.
 * Returns the problem (nothing is left at `png`), or `null` when it is made.
 */
export async function renderStoryboardPng(
  deps: StoryboardRenderDeps,
  storyboard: Storyboard,
  stillRoot: string,
  png: string,
): Promise<string | null> {
  deps.makeDir(dirname(png));
  try {
    await deps.renderStoryboard(storyboard, stillRoot, png);
  } catch (error) {
    deps.removePath(png);
    return `the Storyboard could not be rendered: ${firstLine(error)}`;
  }
  return null;
}

/**
 * The sides of a `video` scenario's MP4: each side that ran, on the recording
 * of the tab it names. A side without that recording is a problem, every
 * side's reason is reported, and there is then no MP4.
 */
export function annotatedVideoSides(
  tab: string,
  ran: Partial<Record<Side, StoryboardSideInput>>,
  choices: Partial<Record<Side, Mp4SideChoice>>,
): { sides: VideoSide[]; missing: string[] } {
  const sides: VideoSide[] = [];
  const missing: string[] = [];
  for (const side of SIDES) {
    const run = ran[side];
    if (!run) continue;
    const choice = choices[side];
    if (!choice?.ok) {
      missing.push(
        choice?.problem ??
          `${side}: no recording of tab "${tab}", so no MP4 was made`,
      );
      continue;
    }
    const { device, tab: recordedTab, path, openedAtMs } = choice.recording;
    sides.push({
      side,
      video: path,
      device,
      tab: recordedTab,
      label: choice.label ?? tabLabel(device, recordedTab, 1),
      openedAtMs,
      steps: run.steps,
    });
  }
  return { sides, missing };
}
