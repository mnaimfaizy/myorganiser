import { AdminAccountMenu } from './AdminAccountMenu';

/**
 * The phone admin bar at the top of every admin page: the ADMIN PORTAL chip
 * and the account menu. Hidden from md up, where AdminHeader takes over. The
 * top safe-area inset is reserved here because the viewport is viewport-fit
 * cover.
 */
export function AdminPhoneBar() {
  return (
    <div className="pt-[env(safe-area-inset-top)] md:hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-raised-surface px-4 py-2.5">
        <span className="rounded-full bg-brand px-2.5 py-0.5 text-label-caps text-brand-foreground">
          ADMIN PORTAL
        </span>
        <AdminAccountMenu variant="phone" />
      </div>
    </div>
  );
}
