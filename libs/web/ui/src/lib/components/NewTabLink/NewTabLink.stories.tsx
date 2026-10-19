import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';

import { NewTabLink } from './NewTabLink';

const meta: Meta<typeof NewTabLink> = {
  component: NewTabLink,
  title: 'Components/NewTabLink',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'An anchor that always opens in a new tab. `target="_blank"` and `rel="noreferrer"` are set by the component and cannot be overridden. ' +
          'Accessibility: the accessible name includes a screen-reader-only "(opens in a new tab)" cue, so the link reads as "#42 (opens in a new tab)". ' +
          'The external-link icon is `aria-hidden="true"` and contributes nothing to the name.',
      },
    },
  },
  argTypes: {
    href: {
      control: 'text',
      description: 'Destination URL',
    },
    iconClassName: {
      control: 'text',
      description:
        'Classes applied to the external-link icon (default `h-3.5 w-3.5`)',
    },
  },
};

export default meta;
type Story = StoryObj<typeof NewTabLink>;

export const Default: Story = {
  args: {
    href: 'https://github.com/example/repo/issues/42',
    children: '#42',
    className: 'text-primary hover:underline',
  },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', {
      name: '#42 (opens in a new tab)',
    });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  },
};

export const SmallInline: Story = {
  args: {
    href: 'https://github.com/example/repo/blob/main/CHANGELOG.md',
    children: 'Fixed in v1.2.0 → View CHANGELOG',
    className: 'text-xs text-primary underline',
    iconClassName: 'h-3 w-3',
  },
};

export const InlineInSentence: Story = {
  args: {
    href: 'https://github.com/example/repo/issues/42',
    children: 'tracking issue #42',
    className: 'text-primary underline',
  },
  render: (args) => (
    <p className="max-w-prose text-sm">
      The fix is tracked in the <NewTabLink {...args} />, and the status updates
      there as the work lands.
    </p>
  ),
};

export const LongContent: Story = {
  args: {
    href: 'https://github.com/example/repo/issues/42',
    children:
      'Reopened after the fix shipped in a later build because the sync conflict still reproduces on Safari with two devices signed in',
    className: 'max-w-[16rem] text-primary underline',
  },
};
