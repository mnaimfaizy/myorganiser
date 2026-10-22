import type { Meta, StoryObj } from '@storybook/react';
import { expect, waitFor, within } from '@storybook/test';

import { AppSidebar } from './app-sidebar';
import {
  DESKTOP_PARAMETERS,
  withShell,
  type ShellParameters,
} from './shell-story-fixtures';

/** The desktop sidebar as the dashboard layout mounts it. */
function SidebarInShell() {
  return (
    <div className="flex min-h-svh">
      <AppSidebar />
    </div>
  );
}

const meta: Meta<typeof SidebarInShell> = {
  component: SidebarInShell,
  title: 'Dashboard/Shell/Sidebar',
  tags: ['autodocs'],
  decorators: [withShell],
  parameters: {
    layout: 'fullscreen',
    ...DESKTOP_PARAMETERS,
  },
};

export default meta;
type Story = StoryObj<typeof SidebarInShell>;

function shell(overrides: ShellParameters): { shell: ShellParameters } {
  return { shell: overrides };
}

/** The one link in the Sections nav marked as the current page. */
function expectActiveLink(canvasElement: HTMLElement, href: string): void {
  const nav = within(canvasElement).getByRole('navigation', {
    name: 'Sections',
  });
  expect(within(nav).getByRole('link', { current: 'page' })).toHaveAttribute(
    'href',
    href,
  );
}

function vaultRegion(canvasElement: HTMLElement): HTMLElement {
  return within(canvasElement).getByRole('region', { name: 'Vault status' });
}

/** Artboard AppSidebar: active Home, vault unlocked, synced. */
export const ExpandedHomeUnlocked: Story = {
  parameters: { shell: { pathname: '/dashboard' } },
  play: async ({ canvasElement }) => {
    expectActiveLink(canvasElement, '/dashboard');
    const region = vaultRegion(canvasElement);
    expect(within(region).getByText('Vault unlocked')).toBeVisible();
    // The sync reading is async; the card shows "Synced" once it resolves.
    await waitFor(() => {
      expect(within(region).getByText('Synced')).toBeVisible();
    });
    expect(
      within(region).getByRole('button', { name: 'Lock vault' }),
    ).toBeVisible();
  },
};

/** Artboard AppSidebar, vaultLocked: the card offers Unlock, not Lock vault. */
export const ExpandedVaultLocked: Story = {
  parameters: shell({ pathname: '/dashboard', vault: 'locked' }),
  play: async ({ canvasElement }) => {
    const region = vaultRegion(canvasElement);
    expect(within(region).getByText('Vault locked')).toBeVisible();
    expect(
      within(region).getByRole('link', { name: 'Unlock' }),
    ).toHaveAttribute('href', '/dashboard/vault');
    expect(
      within(region).queryByRole('button', { name: 'Lock vault' }),
    ).toBeNull();
  },
};

/**
 * The vault card's meta line carries the sync reading when it is not healthy:
 * here "Changes not yet sent" in place of the artboard's "Synced" line. Lock
 * vault stays, because the vault is unlocked.
 */
export const ExpandedSyncPending: Story = {
  parameters: shell({ pathname: '/dashboard', sync: 'pending' }),
  play: async ({ canvasElement }) => {
    const region = vaultRegion(canvasElement);
    await waitFor(() => {
      expect(within(region).getByText('Changes not yet sent')).toBeVisible();
    });
    expect(within(region).queryByText('Synced')).toBeNull();
    expect(
      within(region).getByRole('button', { name: 'Lock vault' }),
    ).toBeVisible();
  },
};

/** Artboard AppSidebar, active = tasks. */
export const ActiveTasks: Story = {
  parameters: { shell: { pathname: '/dashboard/tasks' } },
  play: async ({ canvasElement }) => {
    expectActiveLink(canvasElement, '/dashboard/tasks');
  },
};

/** Artboard AppSidebar, active = groceries. */
export const ActiveGroceries: Story = {
  parameters: { shell: { pathname: '/dashboard/groceries' } },
  play: async ({ canvasElement }) => {
    expectActiveLink(canvasElement, '/dashboard/groceries');
  },
};

/** A sub-route keeps its section active, as the Navigation artboard shows. */
export const ActiveGroceriesDetail: Story = {
  parameters: { shell: { pathname: '/dashboard/groceries/list-1' } },
  play: async ({ canvasElement }) => {
    expectActiveLink(canvasElement, '/dashboard/groceries');
  },
};

/** Artboard AppSidebar, active = subscriptions. */
export const ActiveSubscriptions: Story = {
  parameters: { shell: { pathname: '/dashboard/subscriptions' } },
  play: async ({ canvasElement }) => {
    expectActiveLink(canvasElement, '/dashboard/subscriptions');
  },
};

/** Artboard AppSidebar, active = addresses. */
export const ActiveAddresses: Story = {
  parameters: { shell: { pathname: '/dashboard/addresses' } },
  play: async ({ canvasElement }) => {
    expectActiveLink(canvasElement, '/dashboard/addresses');
  },
};

/** Artboard AppSidebar, active = mobile. */
export const ActiveMobileNumbers: Story = {
  parameters: { shell: { pathname: '/dashboard/mobile-numbers' } },
  play: async ({ canvasElement }) => {
    expectActiveLink(canvasElement, '/dashboard/mobile-numbers');
  },
};

/** Artboard AppSidebar, active = vault. */
export const ActiveVault: Story = {
  parameters: { shell: { pathname: '/dashboard/vault' } },
  play: async ({ canvasElement }) => {
    expectActiveLink(canvasElement, '/dashboard/vault');
  },
};

/**
 * Artboard AppSidebar, active = none. Account is not a nav item, so no link
 * carries aria-current.
 */
export const NoActiveItem: Story = {
  parameters: { shell: { pathname: '/dashboard/account' } },
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', {
      name: 'Sections',
    });
    expect(within(nav).queryByRole('link', { current: 'page' })).toBeNull();
  },
};

/**
 * Artboard Navigation, collapsed rail: 76px, tiles carry aria-label and a
 * tooltip. The groceries tile is the current page.
 */
export const CollapsedRail: Story = {
  parameters: {
    shell: { pathname: '/dashboard/groceries', sidebarOpen: false },
  },
  play: async ({ canvasElement }) => {
    expectActiveLink(canvasElement, '/dashboard/groceries');
    const nav = within(canvasElement).getByRole('navigation', {
      name: 'Sections',
    });
    expect(
      within(nav).getByRole('link', { name: 'Groceries' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(canvasElement).getByRole('button', { name: 'Send feedback' }),
    ).toBeVisible();
  },
};
