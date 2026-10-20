import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';
import * as React from 'react';
import { Textarea } from './Textarea';
import { Label } from '../Label/Label';

const NOTES_LIMIT = 1000;

/**
 * Labelled wrapper for Textarea (STORYBOOK-PATTERNS §9). The counter is a
 * story-only composition: Textarea has no counter prop, and the count must
 * follow what the reader types, so it is tracked here.
 */
type TextareaFieldProps = React.ComponentProps<typeof Textarea> & {
  label: string;
  helper?: string;
  error?: string;
  counter?: boolean;
};

function TextareaField({
  label,
  helper,
  error,
  counter = false,
  id = 'notes',
  defaultValue,
  onChange,
  ...textareaProps
}: TextareaFieldProps) {
  const [length, setLength] = React.useState(String(defaultValue ?? '').length);
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const counterId = `${id}-counter`;
  const describedBy =
    [error ? errorId : helper ? helperId : null, counter ? counterId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="grid w-full max-w-md items-center gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        defaultValue={defaultValue}
        maxLength={counter ? NOTES_LIMIT : undefined}
        onChange={(event) => {
          setLength(event.currentTarget.value.length);
          onChange?.(event);
        }}
        {...textareaProps}
      />
      {error ? (
        <p id={errorId} className="text-caption text-destructive-text">
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="text-caption text-muted-foreground">
          {helper}
        </p>
      ) : null}
      {counter ? (
        <p
          id={counterId}
          className="text-right text-caption text-muted-foreground"
        >
          {length} / {NOTES_LIMIT}
        </p>
      ) : null}
    </div>
  );
}

const meta: Meta<typeof TextareaField> = {
  component: TextareaField,
  title: 'Components/Textarea',
  tags: ['autodocs'],
  args: {
    label: 'Notes',
    counter: true,
  },
  argTypes: {
    disabled: {
      control: 'boolean',
      description: 'Whether the textarea is disabled',
    },
    label: {
      control: 'text',
      description: 'Visible label, always rendered',
    },
    helper: {
      control: 'text',
      description: 'Helper text, shown when there is no error',
    },
    error: {
      control: 'text',
      description:
        'Error message. Sets aria-invalid and replaces the helper text',
    },
    counter: {
      control: 'boolean',
      description: 'Shows a live character count against a 1000 limit',
    },
  },
};

export default meta;
type Story = StoryObj<typeof TextareaField>;

export const Default: Story = {
  args: {
    id: 'notes-default',
    placeholder: 'Brand, size or dietary needs',
  },
};

export const Filled: Story = {
  args: {
    id: 'notes-filled',
    defaultValue:
      'Oat milk, unsweetened. Two cartons if the large size is out.',
  },
};

export const Focus: Story = {
  args: {
    id: 'notes-focus',
    defaultValue: 'Oat milk, unsweetened.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText('Notes');
    field.focus();
    await expect(field).toHaveFocus();
  },
};

export const Error: Story = {
  args: {
    id: 'notes-error',
    defaultValue: 'Milk',
    // Sample copy for the story only, not shipped product copy.
    error: 'Enter at least 10 characters.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText('Notes');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    // The counter is also described, so match the error sentence as a part.
    await expect(field).toHaveAccessibleDescription(
      /Enter at least 10 characters\./,
    );
  },
};

export const Disabled: Story = {
  args: {
    id: 'notes-disabled',
    defaultValue: 'Oat milk, unsweetened.',
    // Sample copy for the story only, not shipped product copy.
    helper: 'Locked while this list is being synced.',
    disabled: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText('Notes');
    await expect(field).toBeDisabled();
    await expect(field).toHaveAccessibleDescription(
      /Locked while this list is being synced\./,
    );
  },
};

export const LongContent: Story = {
  args: {
    id: 'notes-long',
    defaultValue:
      'When I plan the weekly shop I like to note brand preferences, package sizes, and dietary needs for everyone in the house. Oat milk with no added sugar, the large eggs, and the wholegrain bread from the bakery counter. If a size is out, please pick the next one up rather than a different brand.',
  },
};

export const Phone: Story = {
  args: {
    id: 'notes-phone',
    placeholder: 'Brand, size or dietary needs',
  },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    chromatic: { viewports: [320] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText('Notes');
    await expect(getComputedStyle(field).fontSize).toBe('17px');
  },
};
