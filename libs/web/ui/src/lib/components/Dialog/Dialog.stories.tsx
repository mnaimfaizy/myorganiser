import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';

import { Button } from '../Button/Button';
import { Input } from '../Input/Input';
import { Label } from '../Label/Label';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './Dialog';

/*
 * The New list form from the Data artboard. Radix portals DialogContent to
 * document.body, so only the trigger sits inside the canvas. `defaultOpen`
 * shows the open state for a visual snapshot; the play function opens it
 * from the trigger instead.
 */
function NewListDialog({
  defaultOpen = false,
  showCloseButton = true,
}: {
  defaultOpen?: boolean;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger asChild>
        <Button>New list</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={showCloseButton}>
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>
            Name it for the shop or the occasion.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="new-list-name">List name</Label>
          <Input id="new-list-name" defaultValue="Saturday market" />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button>Create list</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogLongContentExample() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button>Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Confirm permanent deletion of your archived workspace projects and
            shared folders
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. All archived projects, shared folders,
            collaborator permissions, and linked notification settings will be
            permanently removed from your organizer workspace. Export anything
            you may need before continuing.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive">Delete permanently</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const meta: Meta<typeof NewListDialog> = {
  component: NewListDialog,
  title: 'Components/Dialog',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof NewListDialog>;

export const Default: Story = {};

export const Open: Story = {
  args: { defaultOpen: true },
};

export const WithoutCloseButton: Story = {
  args: { defaultOpen: true, showCloseButton: false },
};

export const LongContent: Story = {
  render: function Render() {
    return <DialogLongContentExample />;
  },
};

export const OpensOnClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'New list' }));
    await waitFor(() => {
      expect(
        within(document.body).getByRole('dialog', { name: 'New list' }),
      ).toBeVisible();
    });
    const dialog = within(document.body).getByRole('dialog', {
      name: 'New list',
    });
    await expect(dialog).toHaveAccessibleName('New list');
    await expect(dialog).toHaveAccessibleDescription(
      'Name it for the shop or the occasion.',
    );
  },
};
