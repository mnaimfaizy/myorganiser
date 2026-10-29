import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';
import * as React from 'react';
import { Input } from './Input';
import { Label } from '../Label/Label';
import { isDesktopWidth, isPhoneWidth } from '../../storybook/viewport';

/**
 * Every field in a real page has a visible label (STORYBOOK-PATTERNS §9), and
 * Input has no CVA variants to hang one on. This wrapper supplies the label,
 * the helper or error text, and the aria wiring, and forwards everything else
 * to Input so the Controls panel still drives the native props.
 */
type InputFieldProps = React.ComponentProps<typeof Input> & {
  label: string;
  helper?: string;
  error?: string;
};

function InputField({
  label,
  helper,
  error,
  id = 'field',
  ...inputProps
}: InputFieldProps) {
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : helper ? helperId : undefined;

  return (
    <div className="grid w-full max-w-sm items-center gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
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
    </div>
  );
}

const meta: Meta<typeof InputField> = {
  component: InputField,
  title: 'Components/Input',
  tags: ['autodocs'],
  args: {
    label: 'List name',
    helper: 'Up to 100 characters',
    type: 'text',
  },
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'file'],
      description: 'The native input type',
    },
    disabled: {
      control: 'boolean',
      description: 'Whether the input is disabled',
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
  },
};

export default meta;
type Story = StoryObj<typeof InputField>;

export const Default: Story = {
  args: {
    id: 'list-name',
    placeholder: 'e.g. Weekly shop',
  },
};

export const Filled: Story = {
  args: {
    id: 'list-name-filled',
    defaultValue: 'Weekly shop',
  },
};

export const Focus: Story = {
  args: {
    id: 'list-name-focus',
    defaultValue: 'Weekly sh',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('List name');
    input.focus();
    await expect(input).toHaveFocus();
  },
};

export const Error: Story = {
  args: {
    id: 'postcode',
    label: 'Postcode',
    helper: undefined,
    error: 'Use 2 to 16 letters or numbers.',
    defaultValue: '2O0',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Postcode');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription(
      'Use 2 to 16 letters or numbers.',
    );
  },
};

export const Disabled: Story = {
  args: {
    id: 'account-email',
    label: 'Email',
    helper: 'This address comes from your account and cannot be changed here.',
    type: 'email',
    defaultValue: 'sam@example.com',
    disabled: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Email');
    await expect(input).toBeDisabled();
    await expect(input).toHaveAccessibleDescription(
      'This address comes from your account and cannot be changed here.',
    );
  },
};

export const Password: Story = {
  args: {
    id: 'passphrase',
    label: 'Passphrase',
    helper: 'Never leaves this device.',
    type: 'password',
    defaultValue: 'correct horse',
  },
};

export const Phone: Story = {
  args: {
    id: 'phone-list-name',
    defaultValue: 'Oat milk',
  },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  play: async ({ canvasElement }) => {
    // The dev Storybook has no viewport addon; see storybook/viewport.ts.
    if (!isPhoneWidth()) return;
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('List name');
    const style = getComputedStyle(input);
    await expect(style.height).toBe('48px');
    await expect(style.fontSize).toBe('17px');
  },
};

export const Desktop: Story = {
  args: {
    id: 'desktop-list-name',
    defaultValue: 'Oat milk',
  },
  parameters: {
    viewport: {
      defaultViewport: 'desktop',
      viewports: {
        desktop: {
          name: 'Desktop',
          styles: { width: '1280px', height: '800px' },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    // The dev Storybook has no viewport addon; see storybook/viewport.ts.
    if (!isDesktopWidth()) return;
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('List name');
    const style = getComputedStyle(input);
    await expect(style.height).toBe('44px');
    await expect(style.fontSize).toBe('16px');
  },
};

export const LongContent: Story = {
  args: {
    id: 'long-list-name',
    label:
      'Name the list for the quarterly stakeholder review across product, design, and engineering',
    helper:
      'Helper copy stays under the field and wraps with it when the column is narrow.',
    defaultValue:
      'Prepare agenda for quarterly review with stakeholders across product, design, and engineering',
  },
  decorators: [
    (Story) => (
      <div className="w-[16rem]">
        <Story />
      </div>
    ),
  ],
};
