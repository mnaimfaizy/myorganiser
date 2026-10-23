import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { MoreVertical } from 'lucide-react';

import { Button } from '../Button/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu';

const ROW_MENU_TRIGGER_LABEL = 'Actions for Weekly groceries';

function DropdownMenuExample() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Task actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Task options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Mark complete</DropdownMenuItem>
        <DropdownMenuItem>Assign collaborator</DropdownMenuItem>
        <DropdownMenuItem>Move to folder</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DropdownMenuOpenExample() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Task actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Task options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Mark complete</DropdownMenuItem>
        <DropdownMenuItem>Assign collaborator</DropdownMenuItem>
        <DropdownMenuItem>Move to folder</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DropdownMenuWithDisabledItemExample() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Task actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Task options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Mark complete</DropdownMenuItem>
        <DropdownMenuItem disabled>Archive (locked)</DropdownMenuItem>
        <DropdownMenuItem>Move to folder</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DropdownMenuIconTriggerExample() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Open task actions">
          <MoreVertical aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuLabel>Task options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Mark complete</DropdownMenuItem>
        <DropdownMenuItem>Assign collaborator</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/*
 * The row menu's items, shared by the open and closed wrappers so the two
 * stories cannot drift apart. The destructive item sits last, after a
 * separator, as in the Data row menu.
 */
function RowMenuItems() {
  return (
    <>
      <DropdownMenuItem>Rename list</DropdownMenuItem>
      <DropdownMenuItem>Uncheck All</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive">
        Delete Grocery List…
      </DropdownMenuItem>
    </>
  );
}

function DropdownMenuRowOpenExample() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={ROW_MENU_TRIGGER_LABEL}>
          <MoreVertical aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <RowMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DropdownMenuRowClosedExample() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={ROW_MENU_TRIGGER_LABEL}>
          <MoreVertical aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <RowMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const meta: Meta<typeof DropdownMenuExample> = {
  component: DropdownMenuExample,
  title: 'Components/DropdownMenu',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof DropdownMenuExample>;

export const Default: Story = {};

export const Open: Story = {
  render: function Render() {
    return <DropdownMenuOpenExample />;
  },
};

export const WithDisabledItem: Story = {
  render: function Render() {
    return <DropdownMenuWithDisabledItemExample />;
  },
};

export const IconTrigger: Story = {
  render: function Render() {
    return <DropdownMenuIconTriggerExample />;
  },
};

export const RowMenuOpen: Story = {
  render: function Render() {
    return <DropdownMenuRowOpenExample />;
  },
};

export const OpensOnClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Task actions' }));
    await waitFor(() => {
      expect(within(document.body).getByText('Mark complete')).toBeVisible();
    });
  },
};

export const OpensRowMenu: Story = {
  render: function Render() {
    return <DropdownMenuRowClosedExample />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: ROW_MENU_TRIGGER_LABEL }),
    );
    // The menu portals to document.body, so query there rather than the canvas.
    await waitFor(() => {
      expect(
        within(document.body).getByRole('menuitem', {
          name: 'Delete Grocery List…',
        }),
      ).toBeVisible();
    });
  },
};
