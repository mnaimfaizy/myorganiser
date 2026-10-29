import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';
import type { ComponentProps, ReactNode } from 'react';
import { useState } from 'react';

import { Label } from '../Label/Label';
import { Checkbox } from './Checkbox';

const meta: Meta<typeof Checkbox> = {
  component: Checkbox,
  title: 'Components/Checkbox',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

const LEGEND_CLASS = 'pb-2 text-body-sm font-semibold text-foreground';
const ERROR_CLASS = 'text-caption text-destructive-text';

// A checkbox with its visible label. Checkbox is a sibling before Label so the
// Label's peer-disabled styling applies. Every row has a real accessible name
// through htmlFor, the way a page would wire it.
type RowProps = ComponentProps<typeof Checkbox> & {
  id: string;
  label: ReactNode;
};

function Row({ id, label, ...checkboxProps }: RowProps) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox id={id} {...checkboxProps} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

// Fixed ids keep snapshots deterministic.
const TERMS_ID = 'privacy-notice';
const TERMS_ERROR_ID = 'privacy-notice-error';

// Required checkbox in the invalid state. The message sits below the row and
// is linked through aria-describedby. Checkbox has no invalid border of its own,
// so the message carries the error (see the report).
function InvalidExample() {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={TERMS_ID}
          required
          aria-invalid
          aria-describedby={TERMS_ERROR_ID}
        />
        <Label htmlFor={TERMS_ID}>I have read the privacy notice</Label>
      </div>
      <p id={TERMS_ERROR_ID} className={ERROR_CLASS}>
        Confirm the privacy notice to continue.
      </p>
    </div>
  );
}

export const Interactive: Story = {
  render: function Render() {
    const [checked, setChecked] = useState(false);
    return (
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => setChecked(value === true)}
        aria-label="Mark task complete"
      />
    );
  },
};

// Static states use defaultChecked so the control stays clickable. A static
// `checked` on a controlled primitive reads as a broken control.
export const Unchecked: Story = {
  render: () => <Row id="bills-due" label="Bills due" />,
};

export const Checked: Story = {
  render: () => <Row id="birthdays" label="Birthdays" defaultChecked />,
};

export const Indeterminate: Story = {
  render: () => (
    <Row
      id="select-all"
      label="Select all tasks"
      defaultChecked="indeterminate"
    />
  ),
};

export const DisabledUnchecked: Story = {
  render: () => <Row id="trial-ending" label="Trial ending" disabled />,
};

export const DisabledChecked: Story = {
  render: () => (
    <Row
      id="included-plan"
      label="Included in your plan"
      disabled
      defaultChecked
    />
  ),
  play: async ({ canvasElement }) => {
    // A disabled control refuses input. The click must not flip the state.
    const checkbox = within(canvasElement).getByRole('checkbox', {
      name: 'Included in your plan',
    });
    await userEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  },
};

export const FieldsetGroup: Story = {
  render: () => (
    <fieldset className="grid gap-3">
      <legend className={LEGEND_CLASS}>Remind me about</legend>
      <Row id="remind-bills" label="Bills due" />
      <Row id="remind-birthdays" label="Birthdays" defaultChecked />
      <Row id="remind-trial" label="Trial ending" disabled />
    </fieldset>
  ),
};

export const LongLabel: Story = {
  render: () => (
    <div className="max-w-xs">
      <Row
        id="long-label"
        label="Email me a summary of every shared task that changed while I was away, including tasks I was only mentioned in"
      />
    </div>
  ),
};

export const Invalid: Story = {
  render: () => <InvalidExample />,
};

export const WithLabel: Story = {
  render: function Render() {
    const [checked, setChecked] = useState(false);
    return (
      <div className="flex items-center space-x-2">
        <Checkbox
          id="email-notifications"
          checked={checked}
          onCheckedChange={(value) => setChecked(value === true)}
        />
        <Label htmlFor="email-notifications">
          Email me when a shared task is updated
        </Label>
      </div>
    );
  },
};
