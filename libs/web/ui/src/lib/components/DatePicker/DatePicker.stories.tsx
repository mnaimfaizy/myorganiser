import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';

import { Label } from '../Label/Label';
import { DatePicker } from './DatePicker';

/** Pinned yyyy-MM-dd string — never use live dates in stories. */
const PINNED_DATE = '2024-06-15';
/** How `DatePicker` renders PINNED_DATE on the trigger: date-fns `PPP`. */
const PINNED_LABEL = 'June 15th, 2024';

const meta: Meta<typeof DatePicker> = {
  component: DatePicker,
  title: 'Components/DatePicker',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof DatePicker>;

export const Interactive: Story = {
  render: function Render() {
    const [value, setValue] = useState('');
    return (
      <DatePicker
        value={value}
        onChange={setValue}
        placeholder="Pick a due date"
      />
    );
  },
};

export const WithValue: Story = {
  render: function Render() {
    const [value, setValue] = useState(PINNED_DATE);
    return <DatePicker value={value} onChange={setValue} />;
  },
};

export const Disabled: Story = {
  render: function Render() {
    const [value, setValue] = useState(PINNED_DATE);
    return <DatePicker value={value} onChange={setValue} disabled />;
  },
};

/**
 * Required field left empty. The error is derived from the value, so picking a
 * date clears both `aria-invalid` and the `aria-describedby` link, as a real
 * form would. The error copy is sample text for the story only.
 */
export const Invalid: Story = {
  render: function Render() {
    const [value, setValue] = useState('');
    const error = value ? undefined : 'Start date is required.';
    return (
      <div className="grid w-full max-w-md items-center gap-1.5">
        <Label htmlFor="start-date">Start date</Label>
        <DatePicker
          id="start-date"
          value={value}
          onChange={setValue}
          placeholder="Pick a start date"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'start-date-error' : undefined}
        />
        {error ? (
          <p
            id="start-date-error"
            className="inline-flex items-start gap-1.5 text-caption text-destructive-text"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-px h-4 w-4 shrink-0"
            />
            {error}
          </p>
        ) : null}
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button');
    await expect(trigger).toHaveAttribute('aria-invalid', 'true');
    await expect(trigger).toHaveAccessibleDescription(
      /Start date is required\./,
    );
  },
};

/**
 * Opens from a pinned value on purpose. `DatePicker` passes no `defaultMonth`
 * to `Calendar`, so with an empty value react-day-picker falls back to the
 * current month and marks today — which would change what the story renders
 * every day and every month rollover. A selected date fixes the displayed month, so the
 * open calendar is deterministic. The empty placeholder state stays covered by
 * `Interactive`, which never opens the popover.
 */
export const OpensOnClick: Story = {
  render: function Render() {
    const [value, setValue] = useState(PINNED_DATE);
    return (
      <DatePicker
        value={value}
        onChange={setValue}
        placeholder="Pick a due date"
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The trigger shows the formatted value once one is set, not the placeholder.
    await userEvent.click(canvas.getByRole('button', { name: PINNED_LABEL }));
    await waitFor(() => {
      expect(within(document.body).getByRole('grid')).toBeVisible();
    });
  },
};
