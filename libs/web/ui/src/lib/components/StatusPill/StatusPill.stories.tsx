import type { Meta, StoryObj } from '@storybook/react';

import {
  StatusPill,
  type StatusPillSize,
  type StatusPillTone,
} from './StatusPill';

// The words each tone carries on the Feedback artboard (docs/design/web-v2).
const TONE_WORDS = {
  neutral: ['Old', 'Pending', 'Archived'],
  brand: ['In progress', 'Admin'],
  trust: ['Current', 'Active', 'Encrypted'],
  success: ['Done', 'Changed'],
  warning: ['Due today', 'Renews in 3 d'],
  danger: ['Overdue', 'Blocked', 'Disabled'],
} as const satisfies Record<StatusPillTone, readonly string[]>;

const TONES = Object.keys(TONE_WORDS) as StatusPillTone[];

function PillGroup({
  tone,
  words,
  size = 'default',
}: {
  tone: StatusPillTone;
  words: readonly string[];
  size?: StatusPillSize;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {words.map((word) => (
        <StatusPill key={word} tone={tone} size={size}>
          {word}
        </StatusPill>
      ))}
    </div>
  );
}

const meta: Meta<typeof StatusPill> = {
  component: StatusPill,
  title: 'Components/StatusPill',
  tags: ['autodocs'],
  argTypes: {
    tone: {
      control: 'select',
      options: TONES,
      description: 'The state the pill names. Colour is never the only cue.',
    },
    size: {
      control: 'select',
      options: ['default', 'sm'],
      description: 'default is the 24px header pill; sm is the in-row pill.',
    },
  },
  args: {
    children: 'Old',
    tone: 'neutral',
    size: 'default',
  },
};

export default meta;
type Story = StoryObj<typeof StatusPill>;

export const Neutral: Story = {
  render: () => <PillGroup tone="neutral" words={TONE_WORDS.neutral} />,
};

export const Brand: Story = {
  render: () => <PillGroup tone="brand" words={TONE_WORDS.brand} />,
};

export const Trust: Story = {
  render: () => <PillGroup tone="trust" words={TONE_WORDS.trust} />,
};

export const Success: Story = {
  render: () => <PillGroup tone="success" words={TONE_WORDS.success} />,
};

export const Warning: Story = {
  render: () => <PillGroup tone="warning" words={TONE_WORDS.warning} />,
};

export const Danger: Story = {
  render: () => <PillGroup tone="danger" words={TONE_WORDS.danger} />,
};

export const SizeSm: Story = {
  render: () => <PillGroup tone="brand" size="sm" words={TONE_WORDS.brand} />,
};

export const AllTones: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {TONES.map((tone) => (
        <div key={tone} className="flex flex-col gap-2">
          <PillGroup tone={tone} words={TONE_WORDS[tone]} />
          <PillGroup tone={tone} size="sm" words={TONE_WORDS[tone]} />
        </div>
      ))}
    </div>
  ),
};

export const InRowCaption: Story = {
  render: () => (
    <p className="flex flex-wrap items-center gap-2 text-caption text-foreground-secondary">
      Weekly shop · 12 items
      <StatusPill size="sm" tone="warning">
        Due today
      </StatusPill>
    </p>
  ),
};

// The pill is whitespace-nowrap, so a single long word overflows its box
// rather than wrapping. The narrow container makes that visible on purpose.
export const LongWord: Story = {
  render: () => (
    <div className="w-40">
      <StatusPill tone="danger">Reconciliation-pending-review</StatusPill>
    </div>
  ),
};
