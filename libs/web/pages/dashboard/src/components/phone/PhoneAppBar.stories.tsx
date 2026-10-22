import type { Meta, StoryObj } from '@storybook/react';
import { expect, waitFor, within } from '@storybook/test';

import {
  PHONE_PARAMETERS,
  PHONE_FRAME_CLASS_NAME,
  withShell,
} from '../shell-story-fixtures';
import { PhoneAppBar } from './PhoneAppBar';

/** The app bar at the top of a phone frame, as the dashboard layout mounts it. */
function AppBarInFrame() {
  return (
    <div className={PHONE_FRAME_CLASS_NAME}>
      <PhoneAppBar />
    </div>
  );
}

const meta: Meta<typeof AppBarInFrame> = {
  component: AppBarInFrame,
  title: 'Dashboard/Shell/Phone app bar',
  tags: ['autodocs'],
  decorators: [withShell],
  parameters: {
    layout: 'fullscreen',
    ...PHONE_PARAMETERS,
  },
};

export default meta;
type Story = StoryObj<typeof AppBarInFrame>;

/** Artboard PhoneNav, TAB ROOT · LARGE TITLE: lock control while unlocked. */
export const TabRootUnlocked: Story = {
  parameters: { shell: { pathname: '/dashboard/groceries' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText('Groceries', { selector: 'p' })).toBeVisible();
    const lock = canvas.getByRole('button', { name: 'Lock vault' });
    expect(lock).toBeVisible();
    // Uncompacted: the lock sits in the header's own row.
    expect(lock.closest('header')).not.toBeNull();
  },
};

/** Tab root while locked: the title shows, and no lock control. */
export const TabRootLocked: Story = {
  parameters: { shell: { pathname: '/dashboard/tasks', vault: 'locked' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText('Tasks', { selector: 'p' })).toBeVisible();
    expect(canvas.queryByRole('button', { name: 'Lock vault' })).toBeNull();
  },
};

/**
 * PhoneNav, AFTER SCROLL: the title row leaves the viewport and the compact
 * bar takes over, with the lock control moved into it. The header's own lock
 * control goes away at the same moment, so there is exactly one.
 */
export const TabRootScrolledPast: Story = {
  parameters: { shell: { pathname: '/dashboard/tasks' } },
  render: function Render() {
    return (
      <div className={PHONE_FRAME_CLASS_NAME}>
        <PhoneAppBar />
        {/* Filler so the window can scroll the title row out of view. */}
        <div aria-hidden="true" className="h-[1400px]" />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const before = canvas.getByRole('button', { name: 'Lock vault' });
    expect(before.closest('header')).not.toBeNull();

    // The observer watches the viewport; scrolling the document moves the
    // title row out of it.
    window.scrollTo(0, 600);
    await waitFor(() => {
      const compact = canvas.getByRole('button', { name: 'Lock vault' });
      expect(compact.closest('header')).toBeNull();
    });
  },
};

/** PhoneNav, PUSHED SCREEN: back link with the parent's label, then a title. */
export const PushedWithBack: Story = {
  parameters: { shell: { pathname: '/dashboard/addresses' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole('link', { name: 'Back to More' })).toHaveAttribute(
      'href',
      '/dashboard/more',
    );
    expect(canvas.getByText('Addresses', { selector: 'p' })).toBeVisible();
    expect(canvas.queryByRole('button', { name: 'Lock vault' })).toBeNull();
  },
};

/**
 * A nested pushed screen whose last segment is an id. It has no title of its
 * own: the page supplies one, as the artboard's "Weekly shop" does.
 */
export const PushedNestedScreen: Story = {
  parameters: { shell: { pathname: '/dashboard/groceries/list-1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole('link', { name: 'Back to Groceries' }),
    ).toHaveAttribute('href', '/dashboard/groceries');
  },
};
