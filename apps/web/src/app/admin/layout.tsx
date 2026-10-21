import type { Viewport } from 'next';

import { SidebarInset, SidebarProvider, Toaster } from '@myorganiser/web-ui';

import {
  AdminGuard,
  AdminHeader,
  AdminOverviewProvider,
  AdminPhoneBar,
  AdminSidebar,
  AdminTabBar,
} from '@myorganiser/web-pages/admin';

/*
 * viewport-fit=cover lets env(safe-area-inset-*) report the notch and home
 * indicator in the Installed Web App. Matches the dashboard layout.
 */
export const viewport: Viewport = {
  viewportFit: 'cover',
};

/*
 * Desktop widths for the navy sidebar: the 272px expanded sidebar and the
 * 76px icon rail. Matches the dashboard layout.
 */
const SIDEBAR_STYLE = {
  '--sidebar-width': '17rem',
  '--sidebar-width-icon': '4.75rem',
} as React.CSSProperties;

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminGuard>
      {/*
       * On a phone the tab bar sits above the toasts: the Toast viewport reads
       * --toast-offset from this ancestor, set only while the tab bar is mounted.
       */}
      <SidebarProvider
        style={SIDEBAR_STYLE}
        className="has-[[data-phone-tab-bar]]:[--toast-offset:calc(88px_+_env(safe-area-inset-bottom))]"
      >
        <AdminOverviewProvider>
          <AdminSidebar />
          <SidebarInset>
            <AdminHeader />
            <AdminPhoneBar />
            {children}
            <AdminTabBar />
          </SidebarInset>
          <Toaster />
        </AdminOverviewProvider>
      </SidebarProvider>
    </AdminGuard>
  );
}
