import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { useState } from 'react';

import { RadioCard } from '../RadioCard/RadioCard';
import { RadioGroup, RadioGroupItem } from './RadioGroup';
import { isPhoneWidth } from '../../storybook/viewport';

// Meta is typed against the Priority wrapper, not the primitives, because a
// RadioGroup is a fieldset with items inside it (STORYBOOK-PATTERNS §4). Every
// story shows the group the option sits in.

const PRIORITY_LEGEND = 'Priority';
const PRIORITY_NAME = 'priority';
const HIGH = 'High';
const MEDIUM = 'Medium';

const FEEDBACK_LEGEND = 'What kind of feedback is this?';
const FEEDBACK_NAME = 'feedback-kind';
const BUG_TITLE = 'Bug report';
const BUG_DESCRIPTION = "Something isn't working as it should.";
const SUGGESTION_TITLE = 'Suggestion';
const SUGGESTION_DESCRIPTION = 'An improvement or a new feature.';

const LONG_MEDIUM_LABEL =
  'Medium, and flag it for review every Monday morning before the weekly planning meeting starts';

// Returns the row (the label) around a radio input. The phone play function
// measures the row, because the row is the 44px touch target, not the input.
function rowOf(input: HTMLElement): HTMLElement {
  const row = input.closest('label');
  if (!row) {
    throw new Error('RadioGroupItem input is not inside its label row');
  }
  return row;
}

// Design of record: the Priority group with High checked. The Medium option is
// the second choice the reviewer compares against. Two options are enough to
// show the group, so there is no Low option.
function PriorityExample() {
  return (
    <RadioGroup legend={PRIORITY_LEGEND}>
      <RadioGroupItem name={PRIORITY_NAME} value="high" defaultChecked>
        {HIGH}
      </RadioGroupItem>
      <RadioGroupItem name={PRIORITY_NAME} value="medium">
        {MEDIUM}
      </RadioGroupItem>
    </RadioGroup>
  );
}

function PriorityNoneSelected() {
  return (
    <RadioGroup legend={PRIORITY_LEGEND}>
      <RadioGroupItem name={PRIORITY_NAME} value="high">
        {HIGH}
      </RadioGroupItem>
      <RadioGroupItem name={PRIORITY_NAME} value="medium">
        {MEDIUM}
      </RadioGroupItem>
    </RadioGroup>
  );
}

// A single disabled option: Medium cannot be chosen, High is still active.
function PriorityDisabledItem() {
  return (
    <RadioGroup legend={PRIORITY_LEGEND}>
      <RadioGroupItem name={PRIORITY_NAME} value="high" defaultChecked>
        {HIGH}
      </RadioGroupItem>
      <RadioGroupItem name={PRIORITY_NAME} value="medium" disabled>
        {MEDIUM}
      </RadioGroupItem>
    </RadioGroup>
  );
}

// The fieldset's disabled cascades to every radio and mutes the legend.
function PriorityDisabledGroup() {
  return (
    <RadioGroup legend={PRIORITY_LEGEND} disabled>
      <RadioGroupItem name={PRIORITY_NAME} value="high" defaultChecked>
        {HIGH}
      </RadioGroupItem>
      <RadioGroupItem name={PRIORITY_NAME} value="medium">
        {MEDIUM}
      </RadioGroupItem>
    </RadioGroup>
  );
}

function PriorityLongLabel() {
  return (
    <div className="max-w-xs">
      <RadioGroup legend={PRIORITY_LEGEND}>
        <RadioGroupItem name={PRIORITY_NAME} value="high" defaultChecked>
          {HIGH}
        </RadioGroupItem>
        <RadioGroupItem name={PRIORITY_NAME} value="medium">
          {LONG_MEDIUM_LABEL}
        </RadioGroupItem>
      </RadioGroup>
    </div>
  );
}

// RadioGroup wrapping RadioCards: the group's className takes over the layout,
// one column on phone and two from md.
function FeedbackKindGroup() {
  return (
    <RadioGroup
      legend={FEEDBACK_LEGEND}
      className="grid grid-cols-1 gap-2.5 md:grid-cols-2"
    >
      <RadioCard
        name={FEEDBACK_NAME}
        value="bug"
        title={BUG_TITLE}
        description={BUG_DESCRIPTION}
        defaultChecked
      />
      <RadioCard
        name={FEEDBACK_NAME}
        value="suggestion"
        title={SUGGESTION_TITLE}
        description={SUGGESTION_DESCRIPTION}
      />
    </RadioGroup>
  );
}

const meta: Meta<typeof PriorityExample> = {
  component: PriorityExample,
  title: 'Components/RadioGroup',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof PriorityExample>;

export const Default: Story = {};

export const NoneSelected: Story = {
  render: () => <PriorityNoneSelected />,
};

export const DisabledItem: Story = {
  render: () => <PriorityDisabledItem />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const medium = canvas.getByRole('radio', { name: MEDIUM });
    expect(medium).toBeDisabled();
    // A disabled option refuses input. The click must not select it.
    await userEvent.click(medium);
    expect(medium).not.toBeChecked();
  },
};

export const DisabledGroup: Story = {
  render: () => <PriorityDisabledGroup />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const radios = canvas.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    radios.forEach((radio) => {
      expect(radio).toBeDisabled();
    });
  },
};

// Controlled: the parent owns the selection and shows it in a readout, so the
// play function can prove the state changed, not just the input.
export const Controlled: Story = {
  render: function Render() {
    const [priority, setPriority] = useState<'high' | 'medium'>('high');
    const label = priority === 'high' ? HIGH : MEDIUM;
    return (
      <div className="grid gap-3">
        <RadioGroup legend={PRIORITY_LEGEND}>
          <RadioGroupItem
            name={PRIORITY_NAME}
            value="high"
            checked={priority === 'high'}
            onChange={() => setPriority('high')}
          >
            {HIGH}
          </RadioGroupItem>
          <RadioGroupItem
            name={PRIORITY_NAME}
            value="medium"
            checked={priority === 'medium'}
            onChange={() => setPriority('medium')}
          >
            {MEDIUM}
          </RadioGroupItem>
        </RadioGroup>
        <p aria-live="polite" className="text-body-sm text-foreground">
          Selected priority: {label}
        </p>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: MEDIUM }));
    await waitFor(() => {
      expect(canvas.getByText('Selected priority: Medium')).toBeVisible();
    });
    expect(canvas.getByRole('radio', { name: MEDIUM })).toBeChecked();
    expect(canvas.getByRole('radio', { name: HIGH })).not.toBeChecked();
  },
};

// Keyboard: no pointer input. Focus High, press ArrowDown, and the native
// group moves the selection and focus to Medium.
export const KeyboardSelect: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const high = canvas.getByRole('radio', { name: HIGH });
    const medium = canvas.getByRole('radio', { name: MEDIUM });
    expect(high).toBeChecked();
    high.focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(medium).toBeChecked();
    });
    expect(high).not.toBeChecked();
    expect(medium).toHaveFocus();
  },
};

export const LongLabel: Story = {
  render: () => <PriorityLongLabel />,
};

// Phone: the row is 44px below md. The viewport parameter is read by the
// test-runner preVisit hook. The play function asserts the touch-target height
// itself.
export const Phone: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  play: async ({ canvasElement }) => {
    // The dev Storybook has no viewport addon; see storybook/viewport.ts.
    if (!isPhoneWidth()) return;
    const canvas = within(canvasElement);
    const row = rowOf(canvas.getByRole('radio', { name: HIGH }));
    expect(row.getBoundingClientRect().height).toBe(44);
  },
};

export const WithRadioCards: Story = {
  render: () => <FeedbackKindGroup />,
};
