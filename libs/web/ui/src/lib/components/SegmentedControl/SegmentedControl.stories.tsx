import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { useState } from 'react';

import type { SegmentedControlOption } from './SegmentedControl';
import { SegmentedControl } from './SegmentedControl';
import { isPhoneWidth } from '../../storybook/viewport';

// SegmentedControl is controlled: the caller owns `value`. The harness below
// holds that state for every story and renders the value as a readout, so a
// play function can prove the selection changed, not only the radio (the
// component itself renders no readout). Meta is typed against the harness, not
// the primitive (STORYBOOK-PATTERNS §4, §5).

interface SegmentedControlHarnessProps {
  name: string;
  legend: string;
  options: readonly SegmentedControlOption<string>[];
  initialValue: string;
  disabled?: boolean;
}

function SegmentedControlHarness({
  name,
  legend,
  options,
  initialValue,
  disabled,
}: SegmentedControlHarnessProps) {
  const [value, setValue] = useState(initialValue);
  const selected = options.find((option) => option.value === value);
  return (
    <div className="grid gap-3">
      <SegmentedControl
        name={name}
        legend={legend}
        options={options}
        value={value}
        onValueChange={setValue}
        disabled={disabled}
      />
      <p aria-live="polite" className="text-body-sm text-foreground-secondary">
        Selected: {selected?.label}
      </p>
    </div>
  );
}

// Returns the row (the label) around a radio input. The phone play function
// measures the row, because the row is the touch target, not the hidden input.
function rowOf(input: HTMLElement): HTMLElement {
  const row = input.closest('label');
  if (!row) {
    throw new Error('SegmentedControl input is not inside its label segment');
  }
  return row;
}

const FILTER_OPTIONS: readonly SegmentedControlOption<string>[] = [
  { value: 'all', label: 'All' },
  { value: 'personal', label: 'Personal' },
  { value: 'work', label: 'Work' },
];

// Design of record: PlaceDialog "How to update", with Online selected.
const HOW_TO_UPDATE_OPTIONS: readonly SegmentedControlOption<string>[] = [
  { value: 'online', label: 'Online' },
  { value: 'phone', label: 'Phone' },
  { value: 'mail', label: 'Mail' },
  { value: 'in-person', label: 'In person' },
];

// Design of record: PlaceDialog "Priority", with High selected.
const PRIORITY_OPTIONS: readonly SegmentedControlOption<string>[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const TWO_OPTIONS: readonly SegmentedControlOption<string>[] = [
  { value: 'private', label: 'Private' },
  { value: 'shared', label: 'Shared' },
];

const LONG_LABEL_OPTIONS: readonly SegmentedControlOption<string>[] = [
  {
    value: 'everything',
    label: 'Everything in my account, including archived items',
  },
  { value: 'personal', label: 'Personal lists only' },
  { value: 'shared', label: 'Lists shared with my household and team' },
];

const meta: Meta<typeof SegmentedControlHarness> = {
  component: SegmentedControlHarness,
  title: 'Components/SegmentedControl',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof SegmentedControlHarness>;

// Design of record: Inputs "Segmented control", with All selected.
export const Default: Story = {
  args: {
    name: 'show',
    legend: 'Show',
    options: FILTER_OPTIONS,
    initialValue: 'all',
  },
};

// Design of record: PlaceDialog "How to update", with Online selected.
export const FourOptionsHowToUpdate: Story = {
  args: {
    name: 'how-to-update',
    legend: 'How to update',
    options: HOW_TO_UPDATE_OPTIONS,
    initialValue: 'online',
  },
};

// Design of record: PlaceDialog "Priority", with High selected.
export const FourOptionsPriority: Story = {
  args: {
    name: 'priority',
    legend: 'Priority',
    options: PRIORITY_OPTIONS,
    initialValue: 'high',
  },
};

export const TwoOptions: Story = {
  args: {
    name: 'visibility',
    legend: 'Visibility',
    options: TWO_OPTIONS,
    initialValue: 'private',
  },
};

// The fieldset's disabled mutes the legend and blocks every segment. The
// selected segment reads as disabled, not as an active choice.
export const Disabled: Story = {
  args: {
    name: 'show-disabled',
    legend: 'Show',
    options: FILTER_OPTIONS,
    initialValue: 'all',
    disabled: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const radios = canvas.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    radios.forEach((radio) => {
      expect(radio).toBeDisabled();
    });
    // A disabled group refuses input. The click must not change the selection.
    await userEvent.click(canvas.getByText('Work'));
    expect(canvas.getByRole('radio', { name: 'Work' })).not.toBeChecked();
    expect(canvas.getByRole('radio', { name: 'All' })).toBeChecked();
  },
};

// Long labels wrap inside the narrow track instead of overflowing it. The
// container is the narrow part; the segments share the width equally.
export const LongLabels: Story = {
  render: (args) => (
    <div className="max-w-xs">
      <SegmentedControlHarness {...args} />
    </div>
  ),
  args: {
    name: 'scope',
    legend: 'Scope',
    options: LONG_LABEL_OPTIONS,
    initialValue: 'personal',
  },
};

// Phone: the segments are 44px tall below md. The viewport parameter is read by
// the test-runner preVisit hook. The play function asserts the touch-target
// height itself.
export const Phone: Story = {
  args: {
    name: 'how-to-update-phone',
    legend: 'How to update',
    options: HOW_TO_UPDATE_OPTIONS,
    initialValue: 'online',
  },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  play: async ({ canvasElement }) => {
    // The dev Storybook has no viewport addon; see storybook/viewport.ts.
    if (!isPhoneWidth()) return;
    const canvas = within(canvasElement);
    const radios = canvas.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    radios.forEach((radio) => {
      expect(rowOf(radio).getBoundingClientRect().height).toBe(44);
    });
  },
};

// Keyboard: the group is one Tab stop, not one per segment. Arrow-key movement
// between segments is native radio behaviour and is documented here rather
// than asserted: the simulated arrow key in user-event does not fire the change
// that a controlled radio needs, so a play assertion on it fails in simulation
// even though a real browser moves the selection.
export const KeyboardTabStop: Story = {
  args: {
    name: 'show-keyboard',
    legend: 'Show',
    options: FILTER_OPTIONS,
    initialValue: 'all',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Tab enters the group once. In a browser, ArrowLeft and ArrowRight move the selection and focus between segments, and the value readout follows.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const all = canvas.getByRole('radio', { name: 'All' });
    const personal = canvas.getByRole('radio', { name: 'Personal' });
    all.focus();
    expect(all).toHaveFocus();
    await userEvent.tab();
    // Focus leaves the group in one step: it does not land on Personal or
    // Work, which would mean each segment is its own tab stop.
    expect(all).not.toHaveFocus();
    expect(personal).not.toHaveFocus();
    expect(all).toBeChecked();
  },
};

// Click: pointer input on the segment text, which is inside the label that is
// the hit area.
export const ClickSelect: Story = {
  args: {
    name: 'how-to-update-click',
    legend: 'How to update',
    options: HOW_TO_UPDATE_OPTIONS,
    initialValue: 'online',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Phone'));
    await waitFor(() => {
      expect(canvas.getByRole('radio', { name: 'Phone' })).toBeChecked();
    });
    expect(canvas.getByRole('radio', { name: 'Online' })).not.toBeChecked();
    await waitFor(() => {
      expect(canvas.getByText('Selected: Phone')).toBeVisible();
    });
  },
};
