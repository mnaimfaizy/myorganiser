import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';

import {
  PHONE_PARAMETERS,
  PHONE_FRAME_CLASS_NAME,
  shell,
  withShell,
} from '../shell-story-fixtures';
import { PhoneTabBar } from './PhoneTabBar';
import { MoreScreen } from './MoreScreen';

/** The More tab as the phone shell shows it: the screen above the tab bar. */
function MoreInFrame() {
  return (
    <div className={PHONE_FRAME_CLASS_NAME}>
      <MoreScreen />
      <PhoneTabBar />
    </div>
  );
}

const meta: Meta<typeof MoreInFrame> = {
  component: MoreInFrame,
  title: 'Dashboard/Shell/More',
  tags: ['autodocs'],
  decorators: [withShell],
  parameters: {
    layout: 'fullscreen',
    ...PHONE_PARAMETERS,
  },
};

export default meta;
type Story = StoryObj<typeof MoreInFrame>;

/**
 * Artboard MorePhone: the More root with the ORGANISE and YOU groups, the
 * log-out row, and the tab bar with More current.
 *
 * The YouTube row is not asserted: the nav item is hidden whenever the
 * availability check resolves unavailable, which it does in Storybook. The
 * "Updated" badge is not asserted either: it needs the reports call to succeed.
 */
export const MemberRoot: Story = {
  parameters: shell({ pathname: '/dashboard/more' }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole('heading', { level: 1, name: 'More' }),
    ).toBeVisible();
    expect(canvas.getByRole('link', { name: 'Account' })).toHaveAttribute(
      'href',
      '/dashboard/account',
    );
    expect(canvas.getByRole('link', { name: 'Your reports' })).toHaveAttribute(
      'href',
      '/dashboard/account/reports',
    );
    expect(canvas.getByRole('button', { name: 'Log out' })).toBeVisible();
    expect(canvas.queryByRole('link', { name: 'Admin portal' })).toBeNull();
    const tabs = canvas.getByRole('navigation', { name: 'App sections' });
    expect(
      within(tabs).getByRole('link', { current: 'page' }),
    ).toHaveTextContent('More');
  },
};

/**
 * A platform admin's More root. The Admin portal row is the only phone route
 * to /admin, a deliberate departure from the artboard (PRD #1241).
 */
export const PlatformAdminRoot: Story = {
  parameters: shell({ pathname: '/dashboard/more', role: 'platform_admin' }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole('link', { name: 'Admin portal' })).toHaveAttribute(
      'href',
      '/admin',
    );
  },
};
