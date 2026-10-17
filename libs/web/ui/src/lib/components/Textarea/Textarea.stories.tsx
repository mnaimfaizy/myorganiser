import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from './Textarea';
import { Label } from '../Label/Label';

const meta: Meta<typeof Textarea> = {
  component: Textarea,
  title: 'Components/Textarea',
  tags: ['autodocs'],
  argTypes: {
    disabled: {
      control: 'boolean',
      description: 'Whether the textarea is disabled',
    },
    'aria-invalid': {
      control: 'boolean',
      description: 'Whether the textarea is in an invalid state',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: {
    placeholder: 'Enter your feedback...',
  },
};

function WithLabelExample() {
  return (
    <div className="grid w-full max-w-sm items-center gap-1.5">
      <Label htmlFor="feedback">Feedback</Label>
      <Textarea id="feedback" placeholder="Share your thoughts..." />
    </div>
  );
}

export const WithLabel: Story = {
  render: () => <WithLabelExample />,
};

export const Filled: Story = {
  args: {
    defaultValue:
      'This feature has been incredibly useful for organizing my weekly tasks.',
  },
};

export const LongContent: Story = {
  args: {
    defaultValue:
      'When I use this application to plan my week, I appreciate how intuitive the interface is. The ability to organize tasks by priority and deadline has significantly improved my productivity. I especially like the quick access to archived items, which helps me review completed work.',
    className: 'max-w-md',
  },
};

export const Disabled: Story = {
  args: {
    defaultValue: 'This textarea is disabled and cannot be edited.',
    disabled: true,
  },
};

function InvalidExample() {
  return (
    <div className="grid w-full max-w-sm items-center gap-1.5">
      <Label htmlFor="feedback-required">Feedback</Label>
      <Textarea
        id="feedback-required"
        defaultValue="Entered text"
        aria-invalid
        placeholder="Please enter your feedback"
      />
    </div>
  );
}

export const Invalid: Story = {
  render: () => <InvalidExample />,
};

export const WithRows: Story = {
  args: {
    rows: 8,
    placeholder:
      'Enter your detailed feedback here. This example shows an expanded textarea with 8 visible lines.',
  },
};
