import {
  Separator,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  Toaster,
} from '@myorganiser/web-ui';

import {
  DashboardGuard,
  DashboardSidebar,
  DynamicBreadcrumb,
  FeedbackDialog,
  OfflineNotice,
} from '@myorganiser/web-pages/dashboard';

import {
  PassphraseResetPrompt,
  SyncStatusWidget,
  VaultMetaConvergeRunner,
  VaultMountSettleProvider,
  VaultPullRunner,
  VaultReconcileRunner,
  VaultSessionProvider,
} from '@myorganiser/web-vault-ui';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardGuard>
      <SidebarProvider>
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
              <header className="flex h-16 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
                <div className="flex items-center gap-2 px-4">
                  <SidebarTrigger className="-ml-1" />
                  <Separator orientation="vertical" className="mr-2 h-4" />
                  <DynamicBreadcrumb />
                </div>
                <div className="px-4">
                  <SyncStatusWidget />
                </div>
              </header>
              {/*
               * Explains why a save fails while the browser reports no
               * connection. It changes no save path and queues nothing, and
               * it is a browser signal, not a server reachability check.
               */}
              <OfflineNotice />
              {children}
            </SidebarInset>
            {/* Feedback Dialog is mounted once here because both the sidebar
                footer and the user menu open it. */}
            <FeedbackDialog />
            <Toaster />
          </VaultMountSettleProvider>
        </VaultSessionProvider>
      </SidebarProvider>
    </DashboardGuard>
  );
}
