import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';

import { DashboardHeader } from './DashboardHeader';
import { DESKTOP_PARAMETERS, shell, withShell } from './shell-story-fixtures';

/** The header as the dashboard layout mounts it, at desktop width. */
function HeaderInShell() {
  return (
    <div className="w-full">
      <DashboardHeader />
    </div>
  );
}

const meta: Meta<typeof HeaderInShell> = {
  component: HeaderInShell,
  title: 'Dashboard/Shell/Header',
  tags: ['autodocs'],
  decorators: [withShell],
  parameters: {
    layout: 'fullscreen',
    // The header is `hidden md:flex`: the desktop viewport is load-bearing.
    ...DESKTOP_PARAMETERS,
  },
};

export default meta;
type Story = StoryObj<typeof HeaderInShell>;

/** Opens the account menu. Radix opens on pointer down, so this clicks. */
async function openAccountMenu(
  canvasElement: HTMLElement,
): Promise<HTMLElement> {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: /Sam Miller/ }));
  // The menu is a Radix portal: it lives on document.body, not the canvas.
  // The enter animation starts at opacity 0, so visibility waits too.
  return waitFor(() => {
    const menu = within(document.body).getByRole('menu');
    expect(menu).toBeVisible();
    return menu;
  });
}

/** Artboard AppHeader, state = synced, title Home at the dashboard root. */
export const SyncedHome: Story = {
  parameters: shell({ pathname: '/dashboard' }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole('button', { name: 'Collapse sidebar' }),
    ).toBeVisible();
    expect(canvas.getByText('Home', { selector: 'p' })).toBeVisible();
    // The chip appears once the first sync reading resolves.
    await waitFor(() => {
      expect(canvas.getByText('Synced')).toBeVisible();
    });
    expect(canvas.queryByText('Vault locked')).toBeNull();
  },
};

/** Artboard AppHeader, state = locked: the chip replaces the sync reading. */
export const VaultLocked: Story = {
  parameters: shell({ pathname: '/dashboard', vault: 'locked' }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText('Vault locked')).toBeVisible();
    expect(canvas.queryByText('Synced')).toBeNull();
  },
};

/**
 * Asserts the SyncStatusWidget stands in for the chip: its visible label is
 * on screen, and neither the chip nor "Synced" is. Desktop width shows the
 * label (`sm:inline`), so the visible text is what gets checked.
 */
async function expectSyncLabel(
  canvasElement: HTMLElement,
  label: string,
): Promise<void> {
  const canvas = within(canvasElement);
  await waitFor(() => {
    expect(canvas.getByText(label)).toBeVisible();
  });
  expect(canvas.queryByText('Synced')).toBeNull();
  expect(canvas.queryByText('Vault locked')).toBeNull();
}

/** Artboard AppHeader has no state for this; the kind comes from the rules. */
export const SyncChangesPending: Story = {
  parameters: shell({ pathname: '/dashboard', sync: 'pending' }),
  play: async ({ canvasElement }) => {
    await expectSyncLabel(canvasElement, 'Changes not yet sent');
  },
};

/**
 * Pending with an automatic retry scheduled. The label is the same as the
 * plain pending story; the difference is the detail, read from the popover.
 */
export const SyncRetryScheduled: Story = {
  parameters: shell({ pathname: '/dashboard', sync: 'retrying' }),
  play: async ({ canvasElement }) => {
    await expectSyncLabel(canvasElement, 'Changes not yet sent');
    await userEvent.click(
      within(canvasElement).getByRole('button', {
        name: /Changes not yet sent/,
      }),
    );
    await waitFor(() => {
      expect(
        within(document.body).getByTestId('sync-status-detail'),
      ).toHaveTextContent(/Retrying automatically\./);
    });
  },
};

/** The server refused one type outright (422). Terminal outranks pending. */
export const SyncTerminalFailure: Story = {
  parameters: shell({ pathname: '/dashboard', sync: 'failed' }),
  play: async ({ canvasElement }) => {
    await expectSyncLabel(canvasElement, 'Some changes could not be saved');
  },
};

/** The session ended on a 401/403. Outranks every other reading. */
export const SyncSessionEnded: Story = {
  parameters: shell({ pathname: '/dashboard', sync: 'session-ended' }),
  play: async ({ canvasElement }) => {
    await expectSyncLabel(canvasElement, 'Sync stopped — sign in again');
  },
};

/**
 * Three-level breadcrumb. An unregistered segment is titled "Details", which
 * differs from the artboard's page-supplied "Weekly shop": see the report.
 */
export const DetailBreadcrumb: Story = {
  parameters: shell({ pathname: '/dashboard/groceries/list-1' }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const crumbs = canvas.getByRole('navigation', { name: /breadcrumb/i });
    expect(
      within(crumbs).getByRole('link', { name: 'Groceries' }),
    ).toHaveAttribute('href', '/dashboard/groceries');
    expect(canvas.getByText('Details', { selector: 'p' })).toBeVisible();
  },
};

/** Account menu for a member: no Admin portal row, Lock vault while unlocked. */
export const AccountMenuMember: Story = {
  parameters: shell({ pathname: '/dashboard' }),
  play: async ({ canvasElement }) => {
    const menu = await openAccountMenu(canvasElement);
    const scoped = within(menu);
    expect(
      scoped.getByRole('menuitem', { name: 'Account settings' }),
    ).toBeVisible();
    expect(scoped.getByRole('menuitem', { name: 'Lock vault' })).toBeVisible();
    expect(scoped.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
    expect(scoped.queryByRole('menuitem', { name: 'Admin portal' })).toBeNull();
  },
};

/** Account menu for a platform admin: the Admin portal row links to /admin. */
export const AccountMenuPlatformAdmin: Story = {
  parameters: shell({ pathname: '/dashboard', role: 'platform_admin' }),
  play: async ({ canvasElement }) => {
    const menu = await openAccountMenu(canvasElement);
    const scoped = within(menu);
    expect(
      scoped.getByRole('menuitem', { name: 'Admin portal' }),
    ).toHaveAttribute('href', '/admin');
    expect(scoped.getByRole('menuitem', { name: 'Lock vault' })).toBeVisible();
  },
};

/** Account menu while locked: the Lock vault item is absent. */
export const AccountMenuLocked: Story = {
  parameters: shell({ pathname: '/dashboard', vault: 'locked' }),
  play: async ({ canvasElement }) => {
    const menu = await openAccountMenu(canvasElement);
    const scoped = within(menu);
    expect(scoped.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
    expect(scoped.queryByRole('menuitem', { name: 'Lock vault' })).toBeNull();
  },
};

/** Long user-supplied name and email on the account trigger. */
export const LongAccountName: Story = {
  parameters: shell({
    pathname: '/dashboard',
    name: 'Alexandra Maria Featherstonehaugh-Montgomery-Smythe',
    email: 'alexandra.featherstonehaugh.montgomery@example-long-domain.org',
  }),
};
