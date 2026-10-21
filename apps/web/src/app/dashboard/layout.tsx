import { SidebarInset, SidebarProvider, Toaster } from '@myorganiser/web-ui';

import {
  DashboardGuard,
  DashboardHeader,
  DashboardSidebar,
  FeedbackDialog,
  OfflineNotice,
} from '@myorganiser/web-pages/dashboard';

import {
  PassphraseResetPrompt,
  VaultMetaConvergeRunner,
  VaultMountSettleProvider,
  VaultPullRunner,
  VaultReconcileRunner,
  VaultSessionProvider,
} from '@myorganiser/web-vault-ui';

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
      <SidebarProvider style={SIDEBAR_STYLE}>
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
             */}
            <VaultMetaConvergeRunner />
            <VaultPullRunner />
            {/*
             * First paint of a recovery-unlocked session, after the gate has
             * handed the dashboard through. Not inside VaultGate: the gate
             * stays an unlock (ADR 0095).
             */}
            <PassphraseResetPrompt />
            <DashboardSidebar />
            <SidebarInset>
              <DashboardHeader />
              {/*
               * Explains why a save fails while the browser reports no
               * connection. It changes no save path and queues nothing, and
               * it is a browser signal, not a server reachability check.
               */}
              <OfflineNotice />
              {children}
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
