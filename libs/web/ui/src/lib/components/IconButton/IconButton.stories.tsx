import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from '@storybook/test';
import { Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../Tooltip/Tooltip';
import { IconButton } from './IconButton';

const meta: Meta<typeof IconButton> = {
  component: IconButton,
  title: 'Components/IconButton',
  tags: ['autodocs'],
  argTypes: {
    label: {
      control: 'text',
      description:
        'Accessible name, set as aria-label. Required, because an icon-only control has no visible text.',
    },
    icon: {
      control: false,
      description: 'The lucide glyph. Rendered with aria-hidden.',
    },
    variant: {
      control: 'select',
      options: ['outline', 'ghost', 'destructive', 'brand'],
      description:
        'Colour only. `ghost` is the default. `brand` at the default size is a brand icon button, not a FAB.',
    },
    size: {
      control: 'select',
      options: ['default', 'fab'],
      description: '`default` is 44px. `fab` is 56px with a larger glyph.',
    },
    loading: {
      control: 'boolean',
      description:
        'Replaces the icon with a spinner, sets aria-busy, and disables the button.',
    },
    disabled: {
      control: 'boolean',
    },
  },
  // Every story supplies a label, which the component requires.
  args: {
    label: 'Edit',
    icon: <Pencil aria-hidden="true" />,
  },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {
  args: {
    label: 'Edit',
    icon: <Pencil aria-hidden="true" />,
    variant: 'ghost',
  },
};

// The four colours at the default size, as the design artboard sets them.
// Each control's accessible name is its label.
/* One story per variant (STORYBOOK-PATTERNS.md §3), as the Buttons sheet
 * labels its icon buttons. */
export const Outline: Story = {
  args: {
    label: 'Edit',
    icon: <Pencil aria-hidden="true" />,
    variant: 'outline',
  },
};

export const Ghost: Story = {
  args: {
    label: 'More actions',
    icon: <Ellipsis aria-hidden="true" />,
    variant: 'ghost',
  },
};

export const Destructive: Story = {
  args: {
    label: 'Delete',
    icon: <Trash2 aria-hidden="true" />,
    variant: 'destructive',
  },
};

export const Brand: Story = {
  args: { label: 'Add', icon: <Plus aria-hidden="true" />, variant: 'brand' },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <IconButton
        label="Edit"
        variant="outline"
        icon={<Pencil aria-hidden="true" />}
      />
      <IconButton
        label="More actions"
        variant="ghost"
        icon={<Ellipsis aria-hidden="true" />}
      />
      <IconButton
        label="Delete"
        variant="destructive"
        icon={<Trash2 aria-hidden="true" />}
      />
      <IconButton
        label="Add"
        variant="brand"
        icon={<Plus aria-hidden="true" />}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(
      canvas.getByRole('button', { name: 'More actions' }),
    ).toBeInTheDocument();
    expect(canvas.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(canvas.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  },
};

// The FAB is a size, not a colour. It is brand-coloured by choice of variant.
export const Fab: Story = {
  args: {
    label: 'Quick add',
    icon: <Plus aria-hidden="true" />,
    variant: 'brand',
    size: 'fab',
  },
};

// Desktop tooltip. IconButton does not build the tooltip in, because Radix
// Tooltip needs a TooltipProvider above it. The tooltip text matches `label`.
// Rendered open so the tooltip is visible in the snapshot: its content is
// portalled to document.body.
function EditWithTooltip() {
  return (
    <TooltipProvider>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <IconButton
            label="Edit"
            variant="outline"
            icon={<Pencil aria-hidden="true" />}
          />
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const WithTooltip: Story = {
  render: () => <EditWithTooltip />,
};

export const Disabled: Story = {
  args: {
    label: 'Delete',
    icon: <Trash2 aria-hidden="true" />,
    variant: 'destructive',
    disabled: true,
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Delete',
    });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const Loading: Story = {
  args: {
    label: 'Saving',
    variant: 'outline',
    loading: true,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Saving',
    });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  },
};
