import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { useState } from 'react';

import { Button } from '../Button/Button';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

function ConfirmDeleteDialogTriggerExample() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete address</Button>
      <ConfirmDeleteDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this address?"
        description="This will permanently delete the address at 123 Main St. This cannot be undone."
        onConfirm={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

function ConfirmDeleteDialogOpenExample() {
  const [open, setOpen] = useState(true);

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={setOpen}
      title="Delete this address?"
      description="This will permanently delete the address at 123 Main St. This cannot be undone."
      onConfirm={() => {
        setOpen(false);
      }}
    />
  );
}

function ConfirmDeleteDialogLongContentExample() {
  const [open, setOpen] = useState(true);

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={setOpen}
      title="Delete archived workspace and all associated data?"
      description="This action cannot be undone. All archived projects, shared folders, collaborator permissions, and linked notification settings will be permanently removed from your organizer workspace. Any active collaborations will be ended. Export anything you may need before continuing. This includes all data, attachments, and shared access history."
      onConfirm={() => {
        setOpen(false);
      }}
    />
  );
}

function ConfirmDeleteDialogPendingExample() {
  const [open, setOpen] = useState(true);

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={setOpen}
      title="Delete this item?"
      description="This action will be processed and cannot be undone."
      // Never settles, so the pending state is what this story renders and
      // snapshots. A promise that resolves in a microtask would flip back
      // before React commits the pending render, leaving nothing to observe.
      onConfirm={() => new Promise<void>(() => undefined)}
    />
  );
}

function ConfirmDeleteDialogWithChildrenExample() {
  const [open, setOpen] = useState(true);
  const [exporting, setExporting] = useState(false);

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={setOpen}
      title="Delete this vault?"
      description="This Vault has never been backed up. Deleting it is permanent and cannot be undone."
      onConfirm={() => {
        setOpen(false);
      }}
    >
      <Button
        type="button"
        variant="secondary"
        disabled={exporting}
        onClick={() => {
          setExporting(true);
          setTimeout(() => setExporting(false), 1000);
        }}
      >
        {exporting ? 'Exporting…' : 'Export vault first'}
      </Button>
    </ConfirmDeleteDialog>
  );
}

const meta: Meta<typeof ConfirmDeleteDialogTriggerExample> = {
  component: ConfirmDeleteDialogTriggerExample,
  title: 'Components/ConfirmDeleteDialog',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          '**Deprecated.** Use `ConfirmDialog` with `tone="destructive"` and a confirm label that names the action and the object, for example "Delete list". This wrapper keeps the bare "Delete" default for existing callers and forwards everything to `ConfirmDialog`.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ConfirmDeleteDialogTriggerExample>;

export const Default: Story = {};

export const Open: Story = {
  render: function Render() {
    return <ConfirmDeleteDialogOpenExample />;
  },
};

export const LongContent: Story = {
  render: function Render() {
    return <ConfirmDeleteDialogLongContentExample />;
  },
};

export const PendingState: Story = {
  render: function Render() {
    return <ConfirmDeleteDialogPendingExample />;
  },
  play: async () => {
    const body = within(document.body);

    const confirmButton = body.getByRole('button', { name: 'Delete' });
    const cancelButton = body.getByRole('button', { name: 'Cancel' });
    await expect(confirmButton).toBeEnabled();
    await expect(cancelButton).toBeEnabled();

    await userEvent.click(confirmButton);

    // The confirm control is disabled for as long as the handler is in flight.
    await waitFor(async () => {
      await expect(
        body.getByRole('button', { name: 'Delete\u2026' }),
      ).toBeDisabled();
    });

    // Cancel stays available so a slow delete never traps the user.
    await expect(body.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  },
};

export const WithChildren: Story = {
  render: function Render() {
    return <ConfirmDeleteDialogWithChildrenExample />;
  },
};
