'use client';

import type {
  AdminUserIdentity,
  YouTubeAccessUsageResponse,
  YouTubeDisconnectOutcome,
} from '@myorganiser/app-api-client';
import { cn, ConfirmDialog, useToast } from '@myorganiser/web-ui';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatUserDisplayName } from '../lib/formatUserIdentity';
import {
  CONFIRM_AUDIT_NOTE,
  emailVerificationDescription,
  LIFECYCLE_ACTION_COPY,
  lifecycleRowDescription,
  type LifecycleAction,
  type LifecycleActionCopy,
  platformAdminDescription,
  SELF_GUARD_NOTE,
  type UserDetailVariant,
  youtubeAccessDescription,
} from '../lib/userDetail';
import { UserActionRow } from './user-detail/UserActionRow';

interface UserLifecycleActionsProps {
  user: AdminUserIdentity;
  onUserUpdated: (user: AdminUserIdentity) => void;
  /** The signed-in admin is this User. Disable and demote are then blocked. */
  isSelf: boolean;
  youtubeUsage: YouTubeAccessUsageResponse | null;
  /** The usage call failed. With no usage and no failure, the row reads as loading. */
  youtubeUsageFailed: boolean;
  variant: UserDetailVariant;
  /** Called after each action's API call succeeds. Lets the page refresh what the action changed. */
  onActionCompleted?: (action: LifecycleAction) => void;
}

const WITHDRAW_YOUTUBE_ACCESS_TOAST = {
  completed: {
    title: 'YouTube Access withdrawn',
    description: 'Their YouTube data was deleted.',
  },
  pending: {
    title: 'YouTube Access withdrawn',
    description:
      'A YouTube sync is running. Their YouTube data will be deleted when it finishes.',
  },
  not_connected: {
    title: 'YouTube Access withdrawn',
  },
} as const satisfies Record<
  YouTubeDisconnectOutcome,
  { title: string; description?: string }
>;

function getResendSuccessMessage(data: unknown): string {
  if (
    data &&
    typeof data === 'object' &&
    'message' in data &&
    typeof data.message === 'string'
  ) {
    return data.message;
  }

  return 'Verification email sent';
}

interface LifecycleGroupProps {
  headingId: string;
  title: string;
  /** Sign-in actions carry the danger border and the destructive heading ink. */
  danger?: boolean;
  variant: UserDetailVariant;
  /** The self-guard note. Inside the card on desktop, under it on phone. */
  footer?: ReactNode;
  children: ReactNode;
}

/** A labelled group of rows. Desktop is a card with its heading inside; phone is a caps heading over a card. */
function LifecycleGroup({
  headingId,
  title,
  danger = false,
  variant,
  footer,
  children,
}: LifecycleGroupProps) {
  if (variant === 'desktop') {
    return (
      <section
        aria-labelledby={headingId}
        className={cn(
          'flex flex-col rounded-panel border bg-raised-surface',
          danger ? 'border-destructive-edge' : 'border-border',
        )}
      >
        <h2
          id={headingId}
          className={cn(
            'px-6 pt-5 pb-2 font-display text-title',
            danger ? 'text-destructive-text' : 'text-foreground',
          )}
        >
          {title}
        </h2>
        {/* The last row carries 20px bottom padding: 14px from the row plus 6px here.
            With the self-note present, the note is last and keeps its own padding. */}
        {footer ? children : <div className="pb-1.5">{children}</div>}
        {footer}
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h2
        id={headingId}
        className="text-label-caps uppercase text-muted-foreground"
      >
        {title}
      </h2>
      <div
        className={cn(
          'flex flex-col overflow-hidden rounded-xl border bg-raised-surface',
          danger ? 'border-destructive-edge' : 'border-border',
        )}
      >
        {children}
      </div>
      {footer}
    </section>
  );
}

interface LifecycleRowProps {
  action: LifecycleAction;
  variant: UserDetailVariant;
  /** Omit for the rows whose text is in the copy table. */
  description?: string;
  tone?: 'default' | 'danger';
  disabled: boolean;
  describedBy?: string;
  pendingAction: LifecycleAction | null;
  onOpen: (action: LifecycleAction) => void;
}

/** One action's row, with its copy taken from the table. */
function LifecycleRow({
  action,
  variant,
  description,
  tone = 'default',
  disabled,
  describedBy,
  pendingAction,
  onOpen,
}: LifecycleRowProps) {
  const copy: LifecycleActionCopy = LIFECYCLE_ACTION_COPY[action];
  const isPending = pendingAction === action;

  return (
    <UserActionRow
      title={copy.rowTitle}
      description={
        description ?? lifecycleRowDescription(action, variant) ?? ''
      }
      actionLabel={variant === 'phone' ? copy.phoneLabel : copy.desktopLabel}
      actionAriaLabel={copy.ariaLabel}
      tone={tone}
      disabled={disabled}
      describedBy={describedBy}
      busyLabel={isPending ? copy.loadingLabel : undefined}
      onAction={() => onOpen(action)}
      variant={variant}
    />
  );
}

export function UserLifecycleActions({
  user,
  onUserUpdated,
  isSelf,
  youtubeUsage,
  youtubeUsageFailed,
  variant,
  onActionCompleted,
}: UserLifecycleActionsProps) {
  const { toast } = useToast();
  const isPhone = variant === 'phone';
  const accessHeadingId = useId();
  const signInHeadingId = useId();
  const noteId = useId();
  const [pendingAction, setPendingAction] = useState<LifecycleAction | null>(
    null,
  );
  const [openAction, setOpenAction] = useState<LifecycleAction | null>(null);

  const displayName = formatUserDisplayName(user);
  const openCopy: LifecycleActionCopy | null = openAction
    ? LIFECYCLE_ACTION_COPY[openAction]
    : null;
  const isBusy = pendingAction !== null;

  // Which action a row offers is decided by the User's state.
  const signInAction: LifecycleAction = user.disabled ? 'enable' : 'disable';
  const youtubeAction: LifecycleAction = user.youtubeAccess
    ? 'withdrawYouTubeAccess'
    : 'grantYouTubeAccess';
  const adminAction: LifecycleAction =
    user.role === 'platform_admin' ? 'demote' : 'promote';

  // The self-guard covers disable and demote. Enable never applies to a signed-in self.
  const disableBlockedBySelf = isSelf && signInAction === 'disable';
  const demoteBlockedBySelf = isSelf && adminAction === 'demote';
  const selfNote = isSelf ? (
    <p
      id={noteId}
      className={
        isPhone
          ? 'px-1 text-caption text-muted-foreground'
          : 'border-t border-border-subtle px-6 pt-3 pb-4.5 text-caption text-muted-foreground'
      }
    >
      {SELF_GUARD_NOTE}
    </p>
  ) : null;

  const handleCloseDialog = useCallback(() => {
    if (pendingAction) {
      return;
    }

    setOpenAction(null);
  }, [pendingAction]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleCloseDialog();
      }
    },
    [handleCloseDialog],
  );

  const handleOpenAction = useCallback((action: LifecycleAction) => {
    setOpenAction(action);
  }, []);

  const executeAction = useCallback(
    async (action: LifecycleAction) => {
      setPendingAction(action);

      const api = createPlatformAdminApi();
      const userId = user.id;

      try {
        switch (action) {
          case 'disable': {
            const response = await api.disableUser({ userId });
            onUserUpdated(response.data);
            toast({ title: 'User disabled' });
            break;
          }
          case 'enable': {
            const response = await api.enableUser({ userId });
            onUserUpdated(response.data);
            toast({ title: 'User enabled' });
            break;
          }
          case 'forceLogout': {
            const response = await api.forceLogoutUser({ userId });
            onUserUpdated(response.data);
            toast({ title: 'User sessions revoked' });
            break;
          }
          case 'resendVerification': {
            const response = await api.resendVerification({ userId });
            toast({ title: getResendSuccessMessage(response.data) });
            break;
          }
          case 'promote': {
            const response = await api.promoteUser({ userId });
            onUserUpdated(response.data);
            toast({ title: 'User promoted to Platform Admin' });
            break;
          }
          case 'demote': {
            const response = await api.demoteUser({ userId });
            onUserUpdated(response.data);
            toast({ title: 'User demoted' });
            break;
          }
          case 'grantYouTubeAccess': {
            const response = await api.grantYouTubeAccess({ userId });
            onUserUpdated(response.data);
            toast({ title: 'YouTube Access granted' });
            break;
          }
          case 'withdrawYouTubeAccess': {
            const response = await api.withdrawYouTubeAccess({ userId });
            const { youtubeDisconnect, ...identity } = response.data;
            onUserUpdated(identity);
            toast(WITHDRAW_YOUTUBE_ACCESS_TOAST[youtubeDisconnect]);
            break;
          }
        }

        onActionCompleted?.(action);
        setOpenAction(null);
      } catch (err) {
        // The dialog stays open: it closes only on success.
        toast({
          title: 'Action failed',
          description: getApiErrorMessage(err),
          variant: 'destructive',
        });
      } finally {
        setPendingAction(null);
      }
    },
    [onActionCompleted, onUserUpdated, toast, user.id],
  );

  const handleConfirmAction = useCallback(async () => {
    if (!openAction) {
      return;
    }

    await executeAction(openAction);
  }, [executeAction, openAction]);

  return (
    <>
      <LifecycleGroup
        headingId={accessHeadingId}
        title="Access"
        variant={variant}
      >
        <div className="flex flex-col">
          <LifecycleRow
            action={youtubeAction}
            variant={variant}
            description={youtubeAccessDescription(
              user.youtubeAccess,
              youtubeUsage,
              youtubeUsageFailed,
              variant,
            )}
            disabled={isBusy}
            pendingAction={pendingAction}
            onOpen={handleOpenAction}
          />
          <LifecycleRow
            action={adminAction}
            variant={variant}
            description={platformAdminDescription(user.role, variant)}
            disabled={isBusy || demoteBlockedBySelf}
            describedBy={demoteBlockedBySelf ? noteId : undefined}
            pendingAction={pendingAction}
            onOpen={handleOpenAction}
          />
          <LifecycleRow
            action="resendVerification"
            variant={variant}
            description={emailVerificationDescription(user.emailVerified)}
            disabled={isBusy || user.emailVerified}
            pendingAction={pendingAction}
            onOpen={handleOpenAction}
          />
        </div>
      </LifecycleGroup>

      <LifecycleGroup
        headingId={signInHeadingId}
        title={isPhone ? 'Sign-in' : 'Sign-in actions'}
        danger
        variant={variant}
        footer={selfNote}
      >
        <div className="flex flex-col">
          <LifecycleRow
            action="forceLogout"
            variant={variant}
            tone={isPhone ? 'danger' : 'default'}
            disabled={isBusy}
            pendingAction={pendingAction}
            onOpen={handleOpenAction}
          />
          <LifecycleRow
            action={signInAction}
            variant={variant}
            tone={user.disabled ? 'default' : 'danger'}
            disabled={isBusy || disableBlockedBySelf}
            describedBy={disableBlockedBySelf ? noteId : undefined}
            pendingAction={pendingAction}
            onOpen={handleOpenAction}
          />
        </div>
      </LifecycleGroup>

      {openCopy ? (
        <ConfirmDialog
          open
          onOpenChange={handleOpenChange}
          title={openCopy.confirmTitle(displayName)}
          description={openCopy.confirmDescription}
          confirmLabel={openCopy.confirmLabel}
          tone={openCopy.tone}
          onConfirm={handleConfirmAction}
        >
          <p className="text-caption text-muted-foreground">
            {CONFIRM_AUDIT_NOTE}
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
