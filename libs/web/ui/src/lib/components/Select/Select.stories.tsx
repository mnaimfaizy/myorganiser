import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { useState } from 'react';

import { Label } from '../Label/Label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './Select';
import { isPhoneWidth } from '../../storybook/viewport';

// Fixed ids keep snapshots deterministic. The Label htmlFor/id pair
// gives the trigger its accessible name; aria-describedby points at the helper
// or error text below it.
const TRIGGER_ID = 'billing-cycle';
const HELPER_ID = 'billing-cycle-helper';
const ERROR_ID = 'billing-cycle-error';
const LISTBOX_NAME = 'Billing cycle';

const FIELD_CLASS = 'grid w-full max-w-sm items-center gap-1.5';
const HELPER_CLASS = 'text-caption text-muted-foreground';
const ERROR_CLASS = 'text-caption text-destructive-text';

// Radix portals the listbox to document.body. Anything inside SelectContent is
// queried with within(document.body) in play functions.
function CycleItems() {
  return (
    <>
      <SelectItem value="weekly">Weekly</SelectItem>
      <SelectItem value="fortnightly">Fortnightly</SelectItem>
      <SelectItem value="monthly">Monthly</SelectItem>
      <SelectItem value="quarterly">Quarterly</SelectItem>
      <SelectItem value="yearly">Yearly</SelectItem>
    </>
  );
}

// The Default arrangement also shows the Selected state: Monthly is the value.
function SelectExample() {
  return (
    <div className={FIELD_CLASS}>
      <Label htmlFor={TRIGGER_ID}>Billing cycle</Label>
      <Select defaultValue="monthly">
        <SelectTrigger id={TRIGGER_ID} aria-describedby={HELPER_ID}>
          <SelectValue placeholder="Choose a billing cycle" />
        </SelectTrigger>
        <SelectContent aria-label={LISTBOX_NAME}>
          <CycleItems />
        </SelectContent>
      </Select>
      <p id={HELPER_ID} className={HELPER_CLASS}>
        How often you are billed.
      </p>
    </div>
  );
}

function PlaceholderExample() {
  return (
    <div className={FIELD_CLASS}>
      <Label htmlFor={TRIGGER_ID}>Billing cycle</Label>
      <Select>
        <SelectTrigger id={TRIGGER_ID} aria-describedby={HELPER_ID}>
          <SelectValue placeholder="Choose a billing cycle" />
        </SelectTrigger>
        <SelectContent aria-label={LISTBOX_NAME}>
          <CycleItems />
        </SelectContent>
      </Select>
      <p id={HELPER_ID} className={HELPER_CLASS}>
        How often you are billed.
      </p>
    </div>
  );
}

function OpenExample() {
  return (
    <div className={FIELD_CLASS}>
      <Label htmlFor={TRIGGER_ID}>Billing cycle</Label>
      <Select defaultOpen defaultValue="monthly">
        <SelectTrigger id={TRIGGER_ID} aria-describedby={HELPER_ID}>
          <SelectValue placeholder="Choose a billing cycle" />
        </SelectTrigger>
        <SelectContent aria-label={LISTBOX_NAME}>
          <CycleItems />
        </SelectContent>
      </Select>
      <p id={HELPER_ID} className={HELPER_CLASS}>
        How often you are billed.
      </p>
    </div>
  );
}

function ErrorExample() {
  return (
    <div className={FIELD_CLASS}>
      <Label htmlFor={TRIGGER_ID}>Billing cycle</Label>
      <Select>
        <SelectTrigger
          id={TRIGGER_ID}
          aria-invalid="true"
          aria-describedby={ERROR_ID}
        >
          <SelectValue placeholder="Choose a billing cycle" />
        </SelectTrigger>
        <SelectContent aria-label={LISTBOX_NAME}>
          <CycleItems />
        </SelectContent>
      </Select>
      <p id={ERROR_ID} className={ERROR_CLASS}>
        Choose a billing cycle to continue.
      </p>
    </div>
  );
}

function DisabledExample() {
  return (
    <div className={FIELD_CLASS}>
      <Label htmlFor={TRIGGER_ID}>Billing cycle</Label>
      <Select disabled defaultValue="monthly">
        <SelectTrigger id={TRIGGER_ID} aria-describedby={HELPER_ID}>
          <SelectValue placeholder="Choose a billing cycle" />
        </SelectTrigger>
        <SelectContent aria-label={LISTBOX_NAME}>
          <CycleItems />
        </SelectContent>
      </Select>
      <p id={HELPER_ID} className={HELPER_CLASS}>
        Locked for this plan. Contact support to change it.
      </p>
    </div>
  );
}

// Long option label, constrained container, so the trigger truncates the value.
const LONG_CYCLE_LABEL =
  'Every four weeks, billed in advance on the first working day';

function LongContentExample() {
  return (
    <div className="grid w-full max-w-[16rem] items-center gap-1.5">
      <Label htmlFor={TRIGGER_ID}>Billing cycle</Label>
      <Select defaultValue="long">
        <SelectTrigger id={TRIGGER_ID} aria-describedby={HELPER_ID}>
          <SelectValue placeholder="Choose a billing cycle" />
        </SelectTrigger>
        <SelectContent aria-label={LISTBOX_NAME}>
          <SelectItem value="long">{LONG_CYCLE_LABEL}</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
        </SelectContent>
      </Select>
      <p id={HELPER_ID} className={HELPER_CLASS}>
        How often you are billed.
      </p>
    </div>
  );
}

// Group names are placeholders: the design of record shows no groups.
function GroupsExample() {
  return (
    <div className={FIELD_CLASS}>
      <Label htmlFor={TRIGGER_ID}>Billing cycle</Label>
      <Select defaultOpen defaultValue="monthly">
        <SelectTrigger id={TRIGGER_ID} aria-describedby={HELPER_ID}>
          <SelectValue placeholder="Choose a billing cycle" />
        </SelectTrigger>
        <SelectContent aria-label={LISTBOX_NAME}>
          <SelectGroup>
            <SelectLabel>Short cycles</SelectLabel>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="fortnightly">Fortnightly</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Long cycles</SelectLabel>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="quarterly">Quarterly</SelectItem>
            <SelectItem value="yearly">Yearly</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <p id={HELPER_ID} className={HELPER_CLASS}>
        How often you are billed.
      </p>
    </div>
  );
}

const meta: Meta<typeof SelectExample> = {
  component: SelectExample,
  title: 'Components/Select',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof SelectExample>;

export const Default: Story = {};

export const Placeholder: Story = {
  render: () => <PlaceholderExample />,
};

export const Open: Story = {
  render: () => <OpenExample />,
};

// Named Invalid, not Error: an export called Error would shadow the global
// Error used in the LongContent play function.
export const Invalid: Story = {
  render: () => <ErrorExample />,
};

export const Disabled: Story = {
  render: () => <DisabledExample />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox');
    expect(trigger).toBeDisabled();
    await userEvent.click(trigger);
    expect(within(document.body).queryByRole('listbox')).toBeNull();
  },
};

// Phone width: the trigger is 48px below md and 44px from md. This story is
// the phone side. The md+ 44px height is not asserted by any story.
export const Phone: Story = {
  render: () => <SelectExample />,
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  play: async ({ canvasElement }) => {
    // The dev Storybook has no viewport addon; see storybook/viewport.ts.
    if (!isPhoneWidth()) return;
    const trigger = within(canvasElement).getByRole('combobox');
    expect(getComputedStyle(trigger).height).toBe('48px');
  },
};

export const LongContent: Story = {
  render: () => <LongContentExample />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox');
    const value = trigger.querySelector('span');
    if (!value) {
      throw new Error('SelectValue span not found in the trigger');
    }
    expect(value.scrollWidth).toBeGreaterThan(value.clientWidth);
  },
};

export const Groups: Story = {
  render: () => <GroupsExample />,
};

export const Interactive: Story = {
  render: function Render() {
    const [value, setValue] = useState('monthly');

    return (
      <div className={FIELD_CLASS}>
        <Label htmlFor={TRIGGER_ID}>Billing cycle</Label>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger id={TRIGGER_ID} aria-describedby={HELPER_ID}>
            <SelectValue placeholder="Choose a billing cycle" />
          </SelectTrigger>
          <SelectContent aria-label={LISTBOX_NAME}>
            <CycleItems />
          </SelectContent>
        </Select>
        <p id={HELPER_ID} className={HELPER_CLASS}>
          How often you are billed.
        </p>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('combobox'));
    await userEvent.click(
      within(document.body).getByRole('option', { name: 'Weekly' }),
    );
    await waitFor(() => {
      expect(canvas.getByRole('combobox')).toHaveTextContent('Weekly');
    });
  },
};
