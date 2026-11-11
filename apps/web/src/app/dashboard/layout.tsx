import type { Viewport } from 'next';

import {
  BreadcrumbLabelProvider,
  SidebarInset,
  SidebarProvider,
  Toaster,
} from '@myorganiser/web-ui';

import {
  DashboardGuard,
  DashboardHeader,
  DashboardSidebar,
  FeedbackDialog,
  OfflineNotice,
  PhoneAppBar,
  PhoneTabBar,
} from '@myorganiser/web-pages/dashboard';

import {
  PasskeyUnlockOfferRunner,
  PassphraseResetPrompt,
  VaultMetaConvergeRunner,
  VaultMountSettleProvider,
  VaultPullRunner,
  VaultReconcileRunner,
  VaultSessionProvider,
} from '@myorganiser/web-vault-ui';

/*
 * viewport-fit=cover lets env(safe-area-inset-*) report the notch and home
 * indicator in the Installed Web App. Scoped to the dashboard on purpose:
 * public pages have no safe-area handling.
 */
export const viewport: Viewport = {
  viewportFit: 'cover',
};

/*
 * Desktop widths for the navy sidebar: the 272px expanded sidebar and the
 * 76px icon rail. The provider's own default (16rem) is overridden here.
 */
const SIDEBAR_STYLE = {
  '--sidebar-width': '17rem',
  '--sidebar-width-icon': '4.75rem',
} as React.CSSProperties;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardGuard>
      {/*
       * On a phone the tab bar and a page's floating action button both sit
       * above the toasts: the Toast viewport reads --toast-offset and
       * --toast-fab-reserve from this ancestor, each set only while its own
       * obstruction is mounted. The FAB clause builds on --toast-offset, so
       * toasts clear both the tab bar and the FAB at once; see Toast.tsx. It
       * matches the FAB's own top edge exactly (--toast-offset plus the FAB's
       * 1rem gap above the tab bar, plus its 56px height, IconButton's
       * size="fab"). The toast viewport's own p-4 padding supplies the 1rem of
       * clearance above that on its own.
       */}
      <SidebarProvider
        style={SIDEBAR_STYLE}
        className="has-[[data-phone-tab-bar]]:[--toast-offset:calc(88px_+_env(safe-area-inset-bottom))] has-[[data-phone-fab]]:[--toast-fab-reserve:calc(var(--toast-offset,0px)_+_1rem_+_56px)]"
      >
        <VaultSessionProvider>
          {/*
           * Watches VaultReconcileRunner, VaultMetaConvergeRunner, and
           * VaultPullRunner's first pass and renders a data-testid marker
           * E2E waits on before hard-navigating away from a fresh login —
           * closes the WebKit mount-teardown race from issue #858.
           */}
          <VaultMountSettleProvider>
            <VaultReconcileRunner />
            {/*
             * Mounted beside the reconcile runner, not inside it. Vault Meta
             * converges on its own terms and cannot gate Vault Blob merging
             * (ADR 0057), so a passphrase changed on another device raises its
             * own prompt while every blob keeps merging normally.
             *
             * The three runners stay independent, but each one's api comes
             * from `createSharedVaultApi(owner)`. An unconditional GET /vault
             * or GET /vault/blobs that is identical to one already in flight
             * shares that wire request (#1489). Nothing is kept after it
             * settles, and any PUT forgets it. So one load reads GET /vault
             * once: reconcile and meta converge ask at the same moment.
             * GET /vault/blobs is read twice on purpose, about 500 ms apart:
             * reconcile reads it at mount, and the pull's first pass reads it
             * after its ADR 0066 debounce, by which time reconcile's request
             * has settled. That is accepted in #1489's Maintainer Review.
             * GET /vault/backups/latest is not one of these: Home asks it once
             * per load, and only after unlock (the extra calls in #1358 were
             * dev StrictMode and lock/unlock), so it has no duplicate.
             */}
            <VaultMetaConvergeRunner />
            <VaultPullRunner />
            {/*
             * First paint of a recovery-unlocked session, after the gate has
             * handed the dashboard through. Not inside VaultGate: the gate
             * stays an unlock (ADR 0095).
             */}
            <PassphraseResetPrompt />
            {/*
             * The one-time Passkey Unlock offer, after a passphrase unlock
             * from any surface — the gate or the Vault page (ADR 0136).
             */}
            <PasskeyUnlockOfferRunner />
            <DashboardSidebar />
            <SidebarInset>
              <BreadcrumbLabelProvider>
                <DashboardHeader />
                <PhoneAppBar />
                {/*
                 * Explains why a save fails while the browser reports no
                 * connection. It changes no save path and queues nothing, and
                 * it is a browser signal, not a server reachability check.
                 */}
                <OfflineNotice />
                {children}
                <PhoneTabBar />
              </BreadcrumbLabelProvider>
            </SidebarInset>
            {/* Feedback Dialog is mounted once here because both the sidebar
                footer and the account menu in the header open it. */}
            <FeedbackDialog />
            <Toaster />
          </VaultMountSettleProvider>
        </VaultSessionProvider>
      </SidebarProvider>
    </DashboardGuard>
  );
}
