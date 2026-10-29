import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Calendar } from './Calendar';

/** Pinned June 2024 — deterministic for the test-runner. */
const PINNED_YEAR = 2024;
const PINNED_MONTH_INDEX = 5;
const PINNED_DAY = 15;
const PINNED_MONTH = new Date(PINNED_YEAR, PINNED_MONTH_INDEX, 1);
const PINNED_SELECTED = new Date(PINNED_YEAR, PINNED_MONTH_INDEX, PINNED_DAY);
const PINNED_DISABLED_DATES = [
  new Date(PINNED_YEAR, PINNED_MONTH_INDEX, 10),
  new Date(PINNED_YEAR, PINNED_MONTH_INDEX, 20),
];

const meta: Meta<typeof Calendar> = {
  component: Calendar,
  title: 'Components/Calendar',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Calendar>;

export const Default: Story = {
  args: {
    mode: 'single',
    defaultMonth: PINNED_MONTH,
  },
};

export const Selected: Story = {
  args: {
    mode: 'single',
    selected: PINNED_SELECTED,
    defaultMonth: PINNED_MONTH,
  },
};

export const DisabledDates: Story = {
  args: {
    mode: 'single',
    defaultMonth: PINNED_MONTH,
    disabled: PINNED_DISABLED_DATES,
  },
};

export const Interactive: Story = {
  render: function Render() {
    const [selected, setSelected] = useState<Date | undefined>(PINNED_SELECTED);
    return (
      <Calendar
        mode="single"
        selected={selected}
        onSelect={setSelected}
        defaultMonth={PINNED_MONTH}
      />
    );
  },
};
