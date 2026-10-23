import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';

import {
  PHONE_PARAMETERS,
  PHONE_FRAME_CLASS_NAME,
  shell,
  withShell,
} from '../shell-story-fixtures';
import { PhoneTabBar } from './PhoneTabBar';

/** The bar at the foot of a phone frame, as the dashboard layout mounts it. */
function TabBarInFrame() {
  return (
    <div className={PHONE_FRAME_CLASS_NAME}>
      <PhoneTabBar />
    </div>
  );
}

const meta: Meta<typeof TabBarInFrame> = {
  component: TabBarInFrame,
  title: 'Dashboard/Shell/Phone tab bar',
  tags: ['autodocs'],
  decorators: [withShell],
  parameters: {
    layout: 'fullscreen',
    ...PHONE_PARAMETERS,
  },
};

export default meta;
type Story = StoryObj<typeof TabBarInFrame>;

/** The one link marked as the current tab, by its visible label. */
function expectCurrentTab(canvasElement: HTMLElement, label: string): void {
  const nav = within(canvasElement).getByRole('navigation', {
    name: 'App sections',
  });
  expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent(
    label,
  );
}

/** Artboard TabBar, active = home. */
export const HomeTab: Story = {
  parameters: shell({ pathname: '/dashboard' }),
  play: async ({ canvasElement }) => {
    expectCurrentTab(canvasElement, 'Home');
  },
};

/** Artboard TabBar, active = tasks. */
export const TasksTab: Story = {
  parameters: shell({ pathname: '/dashboard/tasks' }),
  play: async ({ canvasElement }) => {
    expectCurrentTab(canvasElement, 'Tasks');
  },
};

/** Artboard TabBar, active = groceries. */
export const GroceriesTab: Story = {
  parameters: shell({ pathname: '/dashboard/groceries' }),
  play: async ({ canvasElement }) => {
    expectCurrentTab(canvasElement, 'Groceries');
  },
};

/** Artboard TabBar, active = vault. */
export const VaultTab: Story = {
  parameters: shell({ pathname: '/dashboard/vault' }),
  play: async ({ canvasElement }) => {
    expectCurrentTab(canvasElement, 'Vault');
  },
};

/** Artboard TabBar, active = more. Sections off the bar also mark More. */
export const MoreTab: Story = {
  parameters: shell({ pathname: '/dashboard/more' }),
  play: async ({ canvasElement }) => {
    expectCurrentTab(canvasElement, 'More');
  },
};

/**
 * A pushed route that keeps the bar (`PUSHED_ROUTES_KEEPING_TAB_BAR`). The
 * bar stays, and More stays current because Account belongs to More.
 */
export const AccountKeepsTabBar: Story = {
  parameters: shell({ pathname: '/dashboard/account' }),
  play: async ({ canvasElement }) => {
    expectCurrentTab(canvasElement, 'More');
  },
};
