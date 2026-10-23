import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';
import { Wifi, WifiOff } from 'lucide-react';

import { Button } from '../Button/Button';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  type AlertTone,
} from './Alert';

// Alert is compound, so the story composition lives in wrappers. The banner
// wrapper is the one Components/Alert documents; the other arrangements are
// their own wrappers below.
interface BannerExampleProps {
  tone: AlertTone;
  title: string;
  body: string;
  actionLabel?: string;
}

function BannerExample({ tone, title, body, actionLabel }: BannerExampleProps) {
  return (
    <Alert variant="banner" tone={tone}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{body}</AlertDescription>
      {actionLabel ? (
        <AlertAction>
          <Button size="sm" variant="outline">
            {actionLabel}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

const meta: Meta<typeof BannerExample> = {
  component: BannerExample,
  title: 'Components/Alert',
  tags: ['autodocs'],
  argTypes: {
    tone: {
      control: 'select',
      options: ['trust', 'warning', 'danger', 'success'],
      description:
        'danger renders role="alert"; every other tone renders role="status".',
    },
  },
  args: {
    tone: 'warning',
    title: 'Changes not yet sent',
    body: 'Groceries and Tasks are waiting. Retrying automatically.',
  },
};

export default meta;
type Story = StoryObj<typeof BannerExample>;

export const VaultLocked: Story = {
  args: {
    tone: 'trust',
    title: 'Vault locked',
    body: 'Unlock to see your tasks. Nothing leaves this device unencrypted.',
    actionLabel: 'Unlock',
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toBeVisible();
  },
};

export const ChangesNotSent: Story = {
  args: {
    actionLabel: 'Retry now',
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toBeVisible();
  },
};

export const CouldntLoadLists: Story = {
  args: {
    tone: 'danger',
    title: "Couldn't load your lists",
    body: 'Your data is safe. Check your connection and try again.',
    actionLabel: 'Try again',
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('alert')).toBeVisible();
  },
};

// The success banner has no action, which is the banner-without-action case.
export const RecoveryKeySaved: Story = {
  args: {
    tone: 'success',
    title: 'Recovery key saved',
    body: 'Keep it somewhere other than this device.',
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toBeVisible();
  },
};

export const LongBody: Story = {
  args: {
    actionLabel: 'Retry now',
    body: 'Groceries, Tasks and Usage locations are waiting to reach the server. Nothing has been lost and nothing has been sent in plain text. The app keeps retrying in the background while this device is online, and the list you see is the last copy saved on this device.',
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toBeVisible();
  },
};

// The notice is the compact in-row form, from the phone lists artboard.
export const Notice: Story = {
  render: () => (
    <Alert variant="notice" tone="warning">
      <AlertDescription>
        {"Not saved — you're offline. Showing the last saved copy."}
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline">
          Retry
        </Button>
      </AlertAction>
    </Alert>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toBeVisible();
  },
};

export const BarOffline: Story = {
  render: () => (
    <Alert variant="bar" tone="warning">
      <WifiOff aria-hidden="true" className="size-4.5" />
      {"You're offline — vault changes save here and sync later"}
    </Alert>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toBeVisible();
  },
};

export const BarBackOnline: Story = {
  render: () => (
    <Alert variant="bar" tone="success">
      <Wifi aria-hidden="true" className="size-4.5" />
      Back online · syncing
    </Alert>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toBeVisible();
  },
};

// The offline bar at phone width, with the phone overlay copy. The bar is a
// fixed h-10 with no wrapping, so a long line is where this layout would show.
export const Phone: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    chromatic: { viewports: [320] },
  },
  render: () => (
    <Alert variant="bar" tone="warning">
      <WifiOff aria-hidden="true" className="size-4.5" />
      {"You're offline — changes save on this phone"}
    </Alert>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toBeVisible();
  },
};
