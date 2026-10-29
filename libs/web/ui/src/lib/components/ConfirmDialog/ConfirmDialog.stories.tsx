import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { useState } from 'react';

import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
import { isPhoneWidth } from '../../storybook/viewport';

type ConfirmDialogExampleProps = Omit<
  ConfirmDialogProps,
  'open' | 'onOpenChange'
>;

const COSTCO_TITLE = 'Delete “Costco run”?';
const COSTCO_CONSEQUENCE =
  'Its 20 lines go with it, on every device. Your staples stay.';

// A synthetic stress string. It checks wrapping and height, not the copy.
const LONG_CONSEQUENCE =
  'Its 20 lines go with it, on every device you are signed in on, and from every copy of this list that is stored on this account. Your staples stay. Anything you have added to it since the last sync goes too, and this cannot be undone.';

/*
 * Holds the open state that ConfirmDialog is controlled by. It starts open,
 * because the confirmation is the state under review.
 */
function ConfirmDialogExample(props: ConfirmDialogExampleProps) {
  const [open, setOpen] = useState(true);

  return <ConfirmDialog open={open} onOpenChange={setOpen} {...props} />;
}

const meta: Meta<typeof ConfirmDialogExample> = {
  component: ConfirmDialogExample,
  title: 'Components/ConfirmDialog',
  tags: ['autodocs'],
  args: {
    title: COSTCO_TITLE,
    description: COSTCO_CONSEQUENCE,
    confirmLabel: 'Delete list',
    tone: 'destructive',
    onConfirm: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof ConfirmDialogExample>;

export const Destructive: Story = {
  play: async () => {
    await waitFor(() => {
      expect(
        within(document.body).getByRole('alertdialog', { name: COSTCO_TITLE }),
      ).toBeVisible();
    });
    const dialog = within(document.body).getByRole('alertdialog', {
      name: COSTCO_TITLE,
    });
    await expect(dialog).toHaveAccessibleName(COSTCO_TITLE);
    await expect(dialog).toHaveAccessibleDescription(COSTCO_CONSEQUENCE);

    // Initial focus goes to Cancel, so Enter cannot confirm by accident.
    await waitFor(() => {
      expect(
        within(document.body).getByRole('button', { name: 'Cancel' }),
      ).toHaveFocus();
    });
  },
};

export const DefaultTone: Story = {
  args: {
    tone: 'default',
    title: 'Restore “Costco run”?',
    description: 'Its 20 lines come back on this device. Your staples stay.',
    confirmLabel: 'Restore list',
  },
};

export const Phone: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  play: async () => {
    // The dev Storybook has no viewport addon; see storybook/viewport.ts.
    if (!isPhoneWidth()) return;
    await waitFor(() => {
      expect(
        within(document.body).getByRole('alertdialog', { name: COSTCO_TITLE }),
      ).toBeVisible();
    });
    const dialog = within(document.body).getByRole('alertdialog', {
      name: COSTCO_TITLE,
    });
    const confirm = within(dialog).getByRole('button', { name: 'Delete list' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });

    // The confirm sheet puts the destructive button first and Cancel second.
    // The desktop dialog puts Cancel first, so this order proves the phone
    // layout rendered.
    expect(
      confirm.compareDocumentPosition(cancel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
};

export const Pending: Story = {
  // Never settles, so the pending state is what this story renders and
  // snapshots. A promise that resolves in a microtask would flip back before
  // React commits the pending render.
  args: {
    onConfirm: () => new Promise<void>(() => undefined),
  },
  play: async () => {
    await waitFor(() => {
      expect(
        within(document.body).getByRole('alertdialog', { name: COSTCO_TITLE }),
      ).toBeVisible();
    });
    const confirm = within(document.body).getByRole('button', {
      name: 'Delete list',
    });

    await userEvent.click(confirm);

    await waitFor(() => {
      expect(confirm).toHaveAttribute('aria-busy', 'true');
    });
  },
};

export const LongConsequence: Story = {
  args: {
    description: LONG_CONSEQUENCE,
  },
};
