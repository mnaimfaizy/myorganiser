/**
 * The run context a Storyboard's band names (#1558): what kind of change was
 * tested, as which QA Accounts, and on which devices and tabs.
 *
 * Accounts are ids only (`primary`, `secondary`), never emails or secrets.
 * Devices and tabs are read from the steps the Storyboard shows, because the
 * band describes what the Storyboard shows. The context is saved in the
 * step-records file (`context`), so `qa:combine` re-renders the same line; a
 * record without it re-renders without the line.
 *
 * Pure: nothing touches disk, a process or a browser.
 */
import { CHANGE_KINDS, type ChangeKind } from './grade-scenarios.ts';
import { DEFAULT_DEVICE } from './qa-scenario-context.ts';
import type { StepRecord } from './qa-scenario.ts';

export interface RunContext {
  changeKind: ChangeKind;
  /** QA Account ids the scenario signed in with, sorted. */
  accounts: string[];
  /** Devices the steps ran on, in the order they first appear. */
  devices: string[];
  /** Tabs the steps ran on, in the order they first appear. */
  tabs: string[];
}

const CHANGE_KIND_WORDS = {
  fix: 'Fix',
  feature: 'Feature',
} as const satisfies Record<ChangeKind, string>;

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** The context of a run: its change kind, account ids and the devices/tabs its steps used. */
export function runContext(
  changeKind: ChangeKind,
  accountIds: readonly string[],
  steps: readonly Pick<StepRecord, 'device' | 'tab'>[],
): RunContext {
  return {
    changeKind,
    accounts: unique([...accountIds]).sort(),
    devices: unique(steps.map((step) => step.device)),
    tabs: unique(steps.map((step) => step.tab)),
  };
}

/** Whether a value read from a saved file is a well-formed `RunContext`. */
export function isRunContext(value: unknown): value is RunContext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const one = value as Record<string, unknown>;
  const strings = (v: unknown): boolean =>
    Array.isArray(v) && v.every((item) => typeof item === 'string');
  return (
    (CHANGE_KINDS as readonly unknown[]).includes(one.changeKind) &&
    strings(one.accounts) &&
    strings(one.devices) &&
    strings(one.tabs)
  );
}

/** Every string of a context that reaches a reader, named, for the caption check. */
export function contextFields(
  context: RunContext,
): { name: string; text: string }[] {
  return [
    ...context.accounts.map((text, i) => ({ name: `account ${i + 1}`, text })),
    ...context.devices.map((text, i) => ({ name: `device ${i + 1}`, text })),
    ...context.tabs.map((text, i) => ({ name: `tab ${i + 1}`, text })),
  ];
}

/**
 * The band's context line, e.g. `Fix · QA Account primary · devices A, B
 * (tabs B1, B2)`. Devices are left out when the run stayed on the lone
 * default device with no other tab; tabs when any tab is not itself a device
 * name (devices' own default tabs, as `A`, are not repeated).
 */
export function contextLine(context: RunContext): string {
  const parts: string[] = [CHANGE_KIND_WORDS[context.changeKind]];
  if (context.accounts.length > 0) {
    parts.push(
      `QA Account${context.accounts.length > 1 ? 's' : ''} ${context.accounts.join(', ')}`,
    );
  }
  const tabsShown = context.tabs.some((tab) => !context.devices.includes(tab));
  const tabs = `tabs ${context.tabs.join(', ')}`;
  const [first] = context.devices;
  const devicesShown =
    first !== undefined &&
    (context.devices.length > 1 || first !== DEFAULT_DEVICE || tabsShown);
  if (devicesShown) {
    const plural = context.devices.length > 1 ? 's' : '';
    parts.push(
      `device${plural} ${context.devices.join(', ')}${tabsShown ? ` (${tabs})` : ''}`,
    );
  } else if (tabsShown) {
    parts.push(tabs);
  }
  return parts.join(' · ');
}
