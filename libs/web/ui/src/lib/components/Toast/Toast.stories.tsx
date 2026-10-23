import type { Meta, StoryObj } from '@storybook/react';
import { Check, Lock } from 'lucide-react';

import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './Toast';

/*
 * Radix closes a toast after its `duration` (5 s by default). Infinity arms no
 * close timer, so the snapshot does not depend on when it was taken.
 */
const HELD_OPEN = Infinity;

/*
 * ToastClose renders an icon-only button with no accessible name of its own,
 * so every story passes one. See the Recommended additional scenarios in the
 * story report.
 */
const DISMISS_LABEL = 'Dismiss notification';

function ToastDefaultExample() {
  return (
    <ToastProvider>
      <Toast defaultOpen duration={HELD_OPEN}>
        <div className="grid gap-1">
          <ToastTitle>Task saved</ToastTitle>
          <ToastDescription>
            Your changes were saved to the workspace.
          </ToastDescription>
        </div>
        <ToastClose aria-label={DISMISS_LABEL} />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}

function ToastWithActionExample() {
  return (
    <ToastProvider>
      <Toast defaultOpen duration={HELD_OPEN}>
        <div className="grid gap-1">
          <ToastTitle>4 checked items removed</ToastTitle>
        </div>
        <ToastAction altText="Undo removing 4 checked items">Undo</ToastAction>
        <ToastClose aria-label={DISMISS_LABEL} />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}

function ToastWithLeadingIconExample() {
  return (
    <ToastProvider>
      <Toast defaultOpen duration={HELD_OPEN}>
        <Check aria-hidden="true" className="size-4" />
        <div className="grid gap-1">
          <ToastTitle>Copied — clears in 60 s</ToastTitle>
        </div>
        <ToastClose aria-label={DISMISS_LABEL} />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}

function ToastTrustIconExample() {
  return (
    <ToastProvider>
      <Toast
        defaultOpen
        duration={HELD_OPEN}
        className="[&>svg]:text-navy-trust"
      >
        <Lock aria-hidden="true" className="size-4" />
        <div className="grid gap-1">
          <ToastTitle>Vault unlocked · up to date with the server</ToastTitle>
        </div>
        <ToastClose aria-label={DISMISS_LABEL} />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}

function ToastLongMessageExample() {
  return (
    <ToastProvider>
      <Toast defaultOpen duration={HELD_OPEN}>
        <div className="grid gap-1">
          <ToastTitle>Change not synced yet</ToastTitle>
          <ToastDescription>
            Your change to the Weekly groceries list could not reach the server
            because the connection dropped during the update. It is kept on this
            device and will be sent again when you are back online.
          </ToastDescription>
        </div>
        <ToastClose aria-label={DISMISS_LABEL} />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}

function ToastDestructiveWithActionExample() {
  return (
    <ToastProvider>
      <Toast defaultOpen duration={HELD_OPEN} variant="destructive">
        <div className="grid gap-1">
          <ToastTitle>
            {"Couldn't save. Your change is kept on this device."}
          </ToastTitle>
        </div>
        <ToastAction altText="Retry saving your change">Retry</ToastAction>
        <ToastClose aria-label={DISMISS_LABEL} />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}

function ToastDestructiveExample() {
  return (
    <ToastProvider>
      <Toast defaultOpen duration={HELD_OPEN} variant="destructive">
        <div className="grid gap-1">
          <ToastTitle>Unable to delete task</ToastTitle>
          <ToastDescription>
            This task is linked to an active shared folder and cannot be
            removed.
          </ToastDescription>
        </div>
        <ToastClose aria-label={DISMISS_LABEL} />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}

function ToastPhoneSnackbarExample() {
  return (
    <ToastProvider>
      <Toast defaultOpen duration={HELD_OPEN}>
        <div className="grid gap-1">
          <ToastTitle>Bananas removed from this list</ToastTitle>
        </div>
        <ToastAction altText="Undo removing bananas">Undo</ToastAction>
        <ToastClose aria-label={DISMISS_LABEL} />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}

const meta: Meta<typeof ToastDefaultExample> = {
  component: ToastDefaultExample,
  title: 'Components/Toast',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The default variant is the navy toast, and destructive is the white error toast with a red edge. ' +
          'The viewport sits bottom-right from md up, and bottom full-width on phone. ' +
          'On phone its bottom inset is `--toast-offset`, a CSS length the phone shell sets on an ancestor ' +
          'to clear the bottom tab bar. It defaults to 0, which is what these stories show.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ToastDefaultExample>;

export const Default: Story = {};

export const WithAction: Story = {
  render: function Render() {
    return <ToastWithActionExample />;
  },
};

export const WithLeadingIcon: Story = {
  render: function Render() {
    return <ToastWithLeadingIconExample />;
  },
};

export const TrustLeadingIcon: Story = {
  render: function Render() {
    return <ToastTrustIconExample />;
  },
};

export const LongMessage: Story = {
  render: function Render() {
    return <ToastLongMessageExample />;
  },
};

export const Destructive: Story = {
  render: function Render() {
    return <ToastDestructiveExample />;
  },
};

export const DestructiveWithAction: Story = {
  render: function Render() {
    return <ToastDestructiveWithActionExample />;
  },
};

export const PhoneSnackbar: Story = {
  render: function Render() {
    return <ToastPhoneSnackbarExample />;
  },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    chromatic: { viewports: [320] },
  },
};
