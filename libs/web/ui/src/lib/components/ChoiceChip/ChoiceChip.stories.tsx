import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor, within } from '@storybook/test';
import { useState } from 'react';

import { ChoiceChip } from './ChoiceChip';

// ChoiceChip is controlled: the caller owns `pressed` and answers
// `onPressedChange`. Static `pressed` stories show the two visual states; the
// Controlled and FilterRow stories hold state so a play function can prove a
// click reaches the owner (STORYBOOK-PATTERNS §5).

const meta: Meta<typeof ChoiceChip> = {
  component: ChoiceChip,
  title: 'Components/ChoiceChip',
  tags: ['autodocs'],
  args: {
    children: 'Open · 7',
    pressed: false,
    onPressedChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ChoiceChip>;

const TOGGLE_LABEL = 'Today';

// Chip labels are plain strings built the same way Tasks builds them, so the
// accessible name is "Open · 7", not a fragment split across text nodes.
interface FilterOption {
  value: string;
  label: string;
  count: number;
}

const STATUS_FILTERS: readonly FilterOption[] = [
  { value: 'open', label: 'Open', count: 7 },
  { value: 'in-progress', label: 'In progress', count: 2 },
  { value: 'blocked', label: 'Blocked', count: 1 },
  { value: 'done', label: 'Done', count: 14 },
  { value: 'archived', label: 'Archived', count: 3 },
];

function countLabel({ label, count }: FilterOption): string {
  return `${label} · ${count}`;
}

// One chip, owned state, and a readout that proves onPressedChange arrived.
function ToggleExample() {
  const [pressed, setPressed] = useState(false);
  return (
    <div className="grid gap-2">
      <ChoiceChip pressed={pressed} onPressedChange={setPressed}>
        {TOGGLE_LABEL}
      </ChoiceChip>
      <p aria-live="polite" className="text-body-sm text-foreground-secondary">
        {`${TOGGLE_LABEL} is ${pressed ? 'on' : 'off'}.`}
      </p>
    </div>
  );
}

// Single-select by hand, as Tasks does it: the chip ignores `next` and writes
// its own value into the owner's state. Pressing the chip that is already on
// keeps it on. The wrapping row is the point: it is capped at max-w-xs so the
// five chips break onto a second line.
function FilterRowExample() {
  const [selected, setSelected] = useState(STATUS_FILTERS[0].value);
  const selectedOption = STATUS_FILTERS.find((o) => o.value === selected);
  return (
    <div className="grid max-w-xs gap-3">
      <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((option) => (
          <ChoiceChip
            key={option.value}
            pressed={selected === option.value}
            onPressedChange={() => setSelected(option.value)}
          >
            {countLabel(option)}
          </ChoiceChip>
        ))}
      </div>
      <p aria-live="polite" className="text-body-sm text-foreground-secondary">
        {`Showing: ${selectedOption?.label ?? ''}`}
      </p>
    </div>
  );
}

export const Unpressed: Story = {};

export const Pressed: Story = {
  args: { pressed: true },
};

// The disabled button refuses input: the click must not reach onPressedChange.
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement, args }) => {
    const chip = within(canvasElement).getByRole('button', {
      name: 'Open · 7',
    });
    expect(chip).toBeDisabled();
    await userEvent.click(chip);
    expect(args.onPressedChange).not.toHaveBeenCalled();
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  },
};

export const Controlled: Story = {
  render: function Render() {
    return <ToggleExample />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByRole('button', { name: TOGGLE_LABEL });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    await waitFor(() => {
      expect(chip).toHaveAttribute('aria-pressed', 'true');
    });
    await waitFor(() => {
      expect(canvas.getByText(`${TOGGLE_LABEL} is on.`)).toBeVisible();
    });
  },
};

// Keyboard: a native button gives Enter and Space activation for free. The
// play function checks the focus ring is drawn for keyboard focus, then
// toggles with each key. The ring is the focus-visible utility, so it is
// asserted through :focus-visible and a non-empty box-shadow.
export const Keyboard: Story = {
  render: function Render() {
    return <ToggleExample />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByRole('button', { name: TOGGLE_LABEL });
    await userEvent.tab();
    expect(chip).toHaveFocus();
    expect(chip.matches(':focus-visible')).toBe(true);
    expect(getComputedStyle(chip).boxShadow).not.toBe('none');

    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(chip).toHaveAttribute('aria-pressed', 'true');
    });
    await userEvent.keyboard(' ');
    await waitFor(() => {
      expect(chip).toHaveAttribute('aria-pressed', 'false');
    });
  },
};

export const FilterRow: Story = {
  render: function Render() {
    return <FilterRowExample />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const open = canvas.getByRole('button', { name: 'Open · 7' });
    const inProgress = canvas.getByRole('button', { name: 'In progress · 2' });
    expect(open).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(inProgress);
    await waitFor(() => {
      expect(inProgress).toHaveAttribute('aria-pressed', 'true');
    });
    // Single-select: the previously pressed chip is released by the owner.
    expect(open).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      expect(canvas.getByText('Showing: In progress')).toBeVisible();
    });
  },
};
