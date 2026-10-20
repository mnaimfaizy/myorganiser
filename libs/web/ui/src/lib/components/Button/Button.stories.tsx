import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from '@storybook/test';
import { Copy, Plus, Search } from 'lucide-react';
import type { ButtonProps } from './Button';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  component: Button,
  title: 'Components/Button',
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'brand',
        'secondary',
        'outline',
        'ghost',
        'destructive',
        'link',
      ],
      description:
        'The visual style. `default` is the navy Primary action; `brand` is the one Brand button per screen.',
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
      description:
        'Height and type step. `default` is 48px on a phone and 44px from md.',
    },
    loading: {
      control: 'boolean',
      description:
        'Shows a spinner, sets aria-busy, and disables the button. Pass the busy label as children.',
    },
    disabled: {
      control: 'boolean',
    },
    // asChild is not a control: it needs a single element child, and the
    // Default story passes a string. See the Link story.
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

type Variant = NonNullable<ButtonProps['variant']>;

// Labels follow the Buttons design artboard (docs/design/web-v2/artboards/Buttons.dc.html).
const MATRIX_ROWS: ReadonlyArray<{
  variant: Variant;
  name: string;
  use: string;
  label: string;
  busyLabel: string;
}> = [
  {
    variant: 'brand',
    name: 'Brand',
    use: 'Main create action',
    label: 'New list',
    busyLabel: 'Saving…',
  },
  {
    variant: 'default',
    name: 'Primary',
    use: 'Submit, confirm',
    label: 'Save',
    busyLabel: 'Saving…',
  },
  {
    variant: 'secondary',
    name: 'Secondary',
    use: 'Second action',
    label: 'Uncheck All',
    busyLabel: 'Saving…',
  },
  {
    variant: 'outline',
    name: 'Outline',
    use: 'Cancel, neutral',
    label: 'Cancel',
    busyLabel: 'Saving…',
  },
  {
    variant: 'ghost',
    name: 'Ghost',
    use: 'Low emphasis',
    label: 'Skip',
    busyLabel: 'Saving…',
  },
  {
    variant: 'destructive',
    name: 'Destructive',
    use: 'Irreversible',
    label: 'Delete',
    busyLabel: 'Deleting…',
  },
  {
    variant: 'link',
    name: 'Link',
    use: 'Inline navigation',
    label: 'View all',
    busyLabel: 'Saving…',
  },
];

const MATRIX_STATES = ['Default', 'Focus', 'Disabled', 'Loading'] as const;

function VariantStateMatrix() {
  return (
    <table className="border-separate border-spacing-4">
      <thead>
        <tr>
          <th
            scope="col"
            className="text-left text-caption font-semibold text-muted-foreground"
          >
            Variant
          </th>
          {MATRIX_STATES.map((state) => (
            <th
              key={state}
              scope="col"
              className="text-left text-caption font-semibold text-muted-foreground"
            >
              {state}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {MATRIX_ROWS.map((row) => (
          <tr key={row.variant}>
            <th scope="row" className="text-left align-middle">
              <span className="block text-body-sm font-semibold text-foreground">
                {row.name}
              </span>
              <span className="block text-caption text-muted-foreground">
                {row.use}
              </span>
            </th>
            <td>
              <Button variant={row.variant}>{row.label}</Button>
            </td>
            <td>
              <Button variant={row.variant}>{row.label}</Button>
            </td>
            <td>
              <Button variant={row.variant} disabled>
                {row.label}
              </Button>
            </td>
            <td>
              <Button variant={row.variant} loading>
                {row.busyLabel}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const Default: Story = {
  args: {
    children: 'Save',
    variant: 'default',
    size: 'default',
    loading: false,
    disabled: false,
  },
};

/* One story per variant and per size (STORYBOOK-PATTERNS.md §3), with the
 * Buttons sheet's label for each row. */
export const Brand: Story = {
  args: { variant: 'brand', children: 'New list' },
};

export const Primary: Story = {
  args: { variant: 'default', children: 'Save' },
};

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'Uncheck All' },
};

export const Outline: Story = {
  args: { variant: 'outline', children: 'Cancel' },
};

export const Ghost: Story = { args: { variant: 'ghost', children: 'Skip' } };

export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Delete' },
};

export const Small: Story = { args: { size: 'sm', children: 'Small 36' } };

export const Large: Story = {
  args: { size: 'lg', children: 'Phone full width 48' },
};

export const AllVariants: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Seven variants across Default, Focus, Disabled and Loading. Hover and pressed are not shown here: they come from the :hover and :active roles of each variant, not from a prop, so a static matrix cannot force them. Hover or press a button in the Default story to see them.',
      },
    },
  },
  render: () => <VariantStateMatrix />,
  play: async ({ canvasElement }) => {
    // The Primary row has three buttons named "Save". The second one is its
    // Focus cell. Only this one is focused: play can focus a single element,
    // so the other Focus cells render unfocused.
    const focusCell = within(canvasElement).getAllByRole('button', {
      name: 'Save',
    })[1];
    focusCell.focus();
    expect(focusCell).toHaveFocus();
  },
};

export const Sizes: Story = {
  render: () => (
    <div className="grid w-full max-w-xs gap-3">
      <div className="flex items-center gap-2.5">
        <Button size="sm">Small 36</Button>
        <Button size="default">Default 44</Button>
      </div>
      <Button size="lg" className="w-full">
        Phone full width 48
      </Button>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2.5">
      <Button variant="brand">
        <Plus aria-hidden="true" />
        New list
      </Button>
      <Button variant="outline">
        <Copy aria-hidden="true" />
        Copy all
      </Button>
    </div>
  ),
};

export const Loading: Story = {
  args: {
    children: 'Saving…',
    variant: 'default',
    loading: true,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Saving…',
    });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  },
};

export const Disabled: Story = {
  args: {
    children: 'Save',
    disabled: true,
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Save',
    });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(args.onClick).not.toHaveBeenCalled();
  },
};

// asChild renders the styles onto an anchor. Use it for navigation, not for
// actions: the anchor keeps link semantics and the href.
export const Link: Story = {
  render: () => (
    <Button asChild variant="link">
      <a href="#all-tasks">View all</a>
    </Button>
  ),
};

// The confirm action sits on the right, Cancel comes first, and the
// destructive confirm names its object ("Delete list", not "OK").
export const ButtonOrder: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Confirm on the right, Cancel first. A destructive confirm names its object: "Delete list", never "OK".',
      },
    },
  },
  render: () => (
    <div className="flex justify-end gap-2.5 rounded-panel border border-border-subtle bg-subtle p-3.5">
      <Button variant="outline">Cancel</Button>
      <Button variant="destructive">Delete list</Button>
    </div>
  ),
};

// Below md the default size is 48px. This play asserts that height, so the
// viewport has to be declared for both the test-runner and Chromatic.
export const PhoneViewport: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    chromatic: { viewports: [320] },
  },
  render: () => <Button>Save</Button>,
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Save',
    });
    expect(button.getBoundingClientRect().height).toBe(48);
  },
};

// Button is `whitespace-nowrap`, so the label does not wrap. This story shows
// what a long label does inside a constrained width.
export const LongLabel: Story = {
  args: {
    children:
      'Save all changes to your workspace settings and notification preferences',
    className: 'max-w-[12rem]',
  },
};

export const Icon: Story = {
  args: {
    children: <Search aria-hidden="true" className="h-4 w-4" />,
    size: 'icon',
    'aria-label': 'Search',
  },
};
