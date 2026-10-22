/**
 * Mount points for the dashboard shell stories (#1276).
 *
 * The shell reads four things a page normally gets from the Next.js app and
 * from its Vault Session: the route, the router, the Vault Session, and the
 * signed-in user. This file supplies each one directly from a decorator. No
 * module is mocked (STORYBOOK-PATTERNS §1).
 *
 * Only the fields the shell reads are real. The sync fakes answer the reads
 * `computeVaultSyncStatus` makes, each with a healthy answer, so the header
 * and sidebar show their synced reading. Nothing here is a Vault: no
 * ciphertext, no key material beyond a zeroed placeholder.
 */
import type { Decorator } from '@storybook/react';
import { VaultBlobType } from '@myorganiser/app-api-client';
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type {
  VaultHandle,
  VaultPullTrigger,
  VaultSyncQueue,
} from '@myorganiser/web-vault';
import { SidebarProvider } from '@myorganiser/web-ui';
import {
  VaultSessionContext,
  type VaultSessionContextValue,
} from '@myorganiser/web-vault-ui';
import type { CSSProperties, ReactNode } from 'react';

/** The key `@myorganiser/auth` reads the signed-in user from. */
const USER_STORAGE_KEY = 'myorganiser_user';

export const DEFAULT_SHELL_NAME = 'Sam Miller';
export const DEFAULT_SHELL_EMAIL = 'sam@example.com';

/**
 * The sync readings a shell story can show, each one a `VaultSyncStatus` kind
 * the shell renders as a label: `synced` shows the chip, the rest show the
 * SyncStatusWidget in its place.
 */
export type ShellSyncReading =
  | 'synced'
  | 'pending'
  | 'retrying'
  | 'failed'
  | 'session-ended';

export interface ShellParameters {
  /** The route the shell sees, e.g. `/dashboard/groceries`. */
  pathname: string;
  /** `platform_admin` shows the Admin portal row. Defaults to `user`. */
  role?: 'user' | 'platform_admin';
  name?: string;
  email?: string;
  /** Defaults to `unlocked`. */
  vault?: 'locked' | 'unlocked';
  /** The sync reading while unlocked. Defaults to `synced`. */
  sync?: ShellSyncReading;
  /** Desktop sidebar state. Defaults to expanded. */
  sidebarOpen?: boolean;
}

/** A phone frame: 390 by 844, the installed-app viewport from the artboards. */
export const PHONE_PARAMETERS = {
  viewport: {
    defaultViewport: 'shellPhone',
    viewports: {
      shellPhone: {
        name: 'Shell phone 390',
        styles: { width: '390px', height: '844px' },
      },
    },
  },
  chromatic: { viewports: [390] },
};

/** Desktop shell: wide enough for the `md:` header and sidebar. */
export const DESKTOP_PARAMETERS = {
  viewport: {
    defaultViewport: 'shellDesktop',
    viewports: {
      shellDesktop: {
        name: 'Shell desktop 1280',
        styles: { width: '1280px', height: '800px' },
      },
    },
  },
  chromatic: { viewports: [1280] },
};

/**
 * Desktop widths for the navy sidebar, mirrored from
 * `apps/web/src/app/dashboard/layout.tsx`: 272px expanded, 76px rail.
 */
const SHELL_SIDEBAR_STYLE = {
  '--sidebar-width': '17rem',
  '--sidebar-width-icon': '4.75rem',
} as CSSProperties;

function writeCurrentUser(
  role: 'user' | 'platform_admin',
  name: string,
  email: string,
): void {
  // Written on every render of a shell story, so one story's user never
  // leaks into the next.
  window.localStorage.setItem(
    USER_STORAGE_KEY,
    JSON.stringify({
      id: 'user-sam-miller',
      name,
      email,
      firstName: 'Sam',
      lastName: 'Miller',
      role,
      disabled: false,
    }),
  );
}

/**
 * The router the shell calls. `useLogOut` pushes to `/login` after sign-out,
 * which a story never triggers. Every method is a no-op so a click cannot
 * navigate the iframe.
 */
const NOOP_ROUTER: AppRouterInstance = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: 'shell-story',
};

/**
 * Sync fakes that give one reading. Each field answers a read that
 * `computeVaultSyncStatus` makes; the rule that wins is the kind shown:
 *   - session-ended: queue.sessionEnded (outranks everything)
 *   - terminal: queue.terminalFailures non-empty (422 on one type)
 *   - pending: handle.hasUnsentChanges true; retryScheduled adds the
 *     "Retrying automatically." detail, not a different label
 *   - synced: all of the above false
 */
function createSyncFakes(
  reading: ShellSyncReading,
): Pick<VaultSessionContextValue, 'handle' | 'syncQueue' | 'pullTrigger'> {
  const unsent = reading === 'pending' || reading === 'retrying';
  const handle = {
    hasUnsentChanges: async () => unsent,
    loadVault: () => null,
    observedVaultIdentity: () => undefined,
  } as unknown as VaultHandle;
  const queueStatus = {
    unsentTypes: unsent ? [VaultBlobType.Tasks] : [],
    sessionEnded: reading === 'session-ended',
    terminalFailures:
      reading === 'failed' ? [{ type: VaultBlobType.Tasks, status: 422 }] : [],
    retryScheduled: reading === 'retrying',
  };
  const syncQueue = {
    status: () => queueStatus,
    subscribe: () => () => undefined,
    retryNow: async () => undefined,
  } as unknown as VaultSyncQueue;
  const pullTrigger = {
    status: () => ({ sessionEnded: false, stalledTypes: [] }),
    subscribe: () => () => undefined,
    check: async () => undefined,
  } as unknown as VaultPullTrigger;
  return { handle, syncQueue, pullTrigger };
}

const noop = (): void => undefined;

function createVaultSession(
  unlocked: boolean,
  reading: ShellSyncReading,
): VaultSessionContextValue {
  return {
    masterKeyBytes: unlocked ? new Uint8Array(32) : null,
    unlockSecret: unlocked ? 'passphrase' : null,
    passphraseResetPromptOwed: false,
    skipPassphraseResetPrompt: noop,
    completePassphraseResetPrompt: noop,
    setMasterKeyBytes: noop,
    lock: noop,
    revision: null,
    // No shell chrome reads either question, so both stay unanswered.
    claimEvidence: { status: 'checking' },
    absentEvidence: { status: 'checking' },
    ...createSyncFakes(reading),
  };
}

// Built once per reading: the fakes are inert, and a stable value keeps the
// sync hook's effect from re-subscribing on every decorator render.
const UNLOCKED_SESSIONS: Record<ShellSyncReading, VaultSessionContextValue> = {
  synced: createVaultSession(true, 'synced'),
  pending: createVaultSession(true, 'pending'),
  retrying: createVaultSession(true, 'retrying'),
  failed: createVaultSession(true, 'failed'),
  'session-ended': createVaultSession(true, 'session-ended'),
};
const LOCKED_SESSION = createVaultSession(false, 'synced');

export interface ShellStoryFixturesProps {
  shell: ShellParameters;
  children: ReactNode;
}

/**
 * The contexts the shell reads — route, router, Vault Session, signed-in
 * user and sidebar — set from one story's `parameters.shell`.
 */
export function ShellStoryFixtures({
  shell,
  children,
}: ShellStoryFixturesProps) {
  writeCurrentUser(
    shell.role ?? 'user',
    shell.name ?? DEFAULT_SHELL_NAME,
    shell.email ?? DEFAULT_SHELL_EMAIL,
  );
  return (
    <PathnameContext.Provider value={shell.pathname}>
      <AppRouterContext.Provider value={NOOP_ROUTER}>
        <VaultSessionContext.Provider
          value={
            shell.vault === 'locked'
              ? LOCKED_SESSION
              : UNLOCKED_SESSIONS[shell.sync ?? 'synced']
          }
        >
          <SidebarProvider
            defaultOpen={shell.sidebarOpen ?? true}
            style={SHELL_SIDEBAR_STYLE}
          >
            {children}
          </SidebarProvider>
        </VaultSessionContext.Provider>
      </AppRouterContext.Provider>
    </PathnameContext.Provider>
  );
}

/**
 * Wraps a shell story in `ShellStoryFixtures`. Reads its settings from
 * `parameters.shell`, which every story sets.
 */
export const withShell: Decorator = (Story, context) => {
  const shell = context.parameters.shell as ShellParameters | undefined;
  if (!shell) {
    throw new Error(
      'withShell: a shell story must set parameters.shell (pathname at least).',
    );
  }
  return (
    <ShellStoryFixtures shell={shell}>
      <Story />
    </ShellStoryFixtures>
  );
};

/**
 * A phone-width column. Its height is a minimum, not a cap, so a story that
 * needs to scroll can put content below the chrome. A class rather than a
 * component, so the file keeps one component, named after it.
 */
export const PHONE_FRAME_CLASS_NAME =
  'flex min-h-[844px] w-[390px] flex-col bg-background';
