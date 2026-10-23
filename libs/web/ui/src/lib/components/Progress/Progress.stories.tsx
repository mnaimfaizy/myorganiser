import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';

import { Progress } from './Progress';

// Progress needs an accessible name, so every story passes aria-label or
// aria-labelledby. No meta args: a shared name would clash with aria-labelledby.
const meta: Meta<typeof Progress> = {
  component: Progress,
  title: 'Components/Progress',
  tags: ['autodocs'],
  argTypes: {
    tone: {
      control: 'select',
      options: ['brand', 'success', 'navy'],
      description: 'navy is for a navy ground only.',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Progress>;

export const Brand: Story = {
  args: {
    value: 8,
    max: 12,
    tone: 'brand',
    'aria-label': 'Weekly shop progress',
  },
};

export const Empty: Story = {
  args: {
    value: 0,
    max: 12,
    tone: 'brand',
    'aria-label': 'Weekly shop progress',
  },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  },
};

export const Full: Story = {
  args: {
    value: 12,
    max: 12,
    tone: 'brand',
    'aria-label': 'Weekly shop progress',
  },
};

// Over the maximum, the fill stops at full and aria-valuenow is clamped to
// max. The fill looks the same as Full; the play function is the check.
export const OverMax: Story = {
  args: {
    value: 15,
    max: 12,
    tone: 'brand',
    'aria-label': 'Weekly shop progress',
  },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('12');
  },
};

// The Complete caption is design copy beside the bar, so the row is composed
// here and the bar carries its own name.
export const SuccessComplete: Story = {
  render: () => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-body">
        <span>
          <span className="font-semibold tabular-nums">5 of 5</span>{' '}
          <span className="text-foreground-secondary">changed</span>
        </span>
        <span className="text-caption font-semibold text-success-text">
          Complete
        </span>
      </div>
      <Progress
        value={5}
        max={5}
        tone="success"
        aria-label="Usage locations changed"
      />
    </div>
  ),
};

export const LabelledBy: Story = {
  render: () => (
    <div className="flex flex-col gap-1.5">
      <span id="weekly-shop-progress-label" className="text-body">
        <span className="font-semibold tabular-nums">8 of 12</span>{' '}
        <span className="text-foreground-secondary">checked</span>
      </span>
      <Progress
        value={8}
        max={12}
        aria-labelledby="weekly-shop-progress-label"
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('progressbar', {
        name: '8 of 12 checked',
      }),
    ).toBeVisible();
  },
};

// The navy tone sits on a navy ground: the raised track and cyan fill only
// read against the navy box.
export const OnNavy: Story = {
  render: () => (
    <div className="rounded-xl bg-navy p-3.5">
      <Progress value={1} max={4} tone="navy" aria-label="Tasks done today" />
    </div>
  ),
};
