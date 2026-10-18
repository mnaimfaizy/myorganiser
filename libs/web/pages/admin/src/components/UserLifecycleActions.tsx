'use client';

import type {
  AdminUserIdentity,
  YouTubeDisconnectOutcome,
} from '@myorganiser/app-api-client';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@myorganiser/web-ui';
import { useCallback, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';

import { createPlatformAdminApi } from '../lib/apiClient';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatUserDisplayName } from '../lib/formatUserIdentity';

type LifecycleAction =
  | 'disable'
  | 'enable'
  | 'forceLogout'
  | 'resendVerification'
  | 'promote'
  | 'demote'
  | 'grantYouTubeAccess'
  | 'withdrawYouTubeAccess';

interface UserLifecycleActionsProps {
  user: AdminUserIdentity;
  onUserUpdated: (user: AdminUserIdentity) => void;
}

interface LifecycleConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  isLoading?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

interface ActionDefinition {
  id: LifecycleAction;
  label: string;
  loadingLabel: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  destructive?: boolean;
  variant: 'default' | 'destructive' | 'outline';
  isVisible: (user: AdminUserIdentity) => boolean;
}

const ACTION_DEFINITIONS: ActionDefinition[] = [
  {
    id: 'disable',
    label: 'Disable',
    loadingLabel: 'Disabling…',
    confirmTitle: 'Disable user?',
    confirmDescription:
      'This will prevent the user from signing in until they are re-enabled.',
    confirmLabel: 'Disable user',
    destructive: true,
    variant: 'destructive',
    isVisible: (targetUser) => !targetUser.disabled,
  },
  {
    id: 'enable',
    label: 'Enable',
    loadingLabel: 'Enabling…',
    confirmTitle: 'Enable user?',
    confirmDescription: 'This will allow the user to sign in again.',
    confirmLabel: 'Enable user',
    variant: 'outline',
    isVisible: (targetUser) => targetUser.disabled,
  },
  {
    id: 'forceLogout',
    label: 'Force logout',
    loadingLabel: 'Revoking…',
    confirmTitle: 'Force logout?',
    confirmDescription:
      'This will revoke all active sessions for this user immediately.',
    confirmLabel: 'Force logout',
    variant: 'outline',
    isVisible: () => true,
  },
  {
    id: 'resendVerification',
    label: 'Resend verification',
    loadingLabel: 'Sending…',
    confirmTitle: 'Resend verification email?',
    confirmDescription: 'This will send a new verification email to the user.',
    confirmLabel: 'Resend email',
    variant: 'outline',
    isVisible: (targetUser) => !targetUser.emailVerified,
  },
  {
    id: 'promote',
    label: 'Promote',
    loadingLabel: 'Promoting…',
    confirmTitle: 'Promote to Platform Admin?',
    confirmDescription:
      'This will grant Platform Admin privileges to this user.',
    confirmLabel: 'Promote user',
    variant: 'outline',
    isVisible: (targetUser) => targetUser.role !== 'platform_admin',
  },
  {
    id: 'demote',
    label: 'Demote',
    loadingLabel: 'Demoting…',
    confirmTitle: 'Demote Platform Admin?',
    confirmDescription:
      'This will remove Platform Admin privileges from this user.',
    confirmLabel: 'Demote user',
    destructive: true,
    variant: 'destructive',
    isVisible: (targetUser) => targetUser.role === 'platform_admin',
  },
  {
    id: 'grantYouTubeAccess',
    label: 'Grant YouTube Access',
    loadingLabel: 'Granting…',
    confirmTitle: 'Grant YouTube Access?',
    confirmDescription:
      'This will let the user connect and use YouTube in MyOrganiser. A first grant uses one of the limited YouTube Access places.',
    confirmLabel: 'Grant access',
    variant: 'outline',
    isVisible: (targetUser) => !targetUser.youtubeAccess,
  },
  {
    id: 'withdrawYouTubeAccess',
    label: 'Withdraw YouTube Access',
    loadingLabel: 'Withdrawing…',
    confirmTitle: 'Withdraw YouTube Access?',
    confirmDescription:
      "This will end the user's YouTube connection and revoke MyOrganiser's access at Google. Their YouTube data will be deleted: followed channels, cached uploads, watched marks and digest settings. Nothing is kept for a later reconnect.",
    confirmLabel: 'Withdraw access',
    destructive: true,
    variant: 'destructive',
    isVisible: (targetUser) => targetUser.youtubeAccess,
  },
];

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

function LifecycleConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel,
  destructive = false,
  isLoading = false,
  onClose,
  onConfirm,
}: LifecycleConfirmDialogProps) {
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  const handleConfirm = useCallback(async () => {
    await onConfirm();
  }, [onConfirm]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 pt-2 sm:gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserLifecycleActions({
  user,
  onUserUpdated,
}: UserLifecycleActionsProps) {
  const { toast } = useToast();
  const [pendingAction, setPendingAction] = useState<LifecycleAction | null>(
    null,
  );
  const [openAction, setOpenAction] = useState<LifecycleAction | null>(null);

  const visibleActions = useMemo(
    () => ACTION_DEFINITIONS.filter((action) => action.isVisible(user)),
    [user],
  );

  const openActionDefinition = useMemo(
    () => ACTION_DEFINITIONS.find((action) => action.id === openAction) ?? null,
    [openAction],
  );

  const handleCloseDialog = useCallback(() => {
    if (pendingAction) {
      return;
    }

    setOpenAction(null);
  }, [pendingAction]);

  const handleOpenAction = useCallback((action: LifecycleAction) => {
    setOpenAction(action);
  }, []);

  const handleActionButtonClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const action = event.currentTarget.dataset.action as
        | LifecycleAction
        | undefined;

      if (action) {
        handleOpenAction(action);
      }
    },
    [handleOpenAction],
  );

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

        setOpenAction(null);
      } catch (err) {
        toast({
          title: 'Action failed',
          description: getApiErrorMessage(err),
          variant: 'destructive',
        });
      } finally {
        setPendingAction(null);
      }
    },
    [onUserUpdated, toast, user.id],
  );

  const handleConfirmAction = useCallback(async () => {
    if (!openAction) {
      return;
    }

    await executeAction(openAction);
  }, [executeAction, openAction]);

  const isBusy = pendingAction !== null;

  return (
    <section className="max-w-xl">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Actions</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Manage lifecycle actions for {formatUserDisplayName(user)}.
      </p>
      <div className="flex flex-wrap gap-2">
        {visibleActions.map((action) => {
          const isActive = pendingAction === action.id;

          return (
            <Button
              key={action.id}
              type="button"
              variant={action.variant}
              data-action={action.id}
              disabled={isBusy}
              onClick={handleActionButtonClick}
            >
              {isActive ? action.loadingLabel : action.label}
            </Button>
          );
        })}
      </div>

      {openActionDefinition ? (
        <LifecycleConfirmDialog
          isOpen={openAction !== null}
          title={openActionDefinition.confirmTitle}
          description={openActionDefinition.confirmDescription}
          confirmLabel={openActionDefinition.confirmLabel}
          destructive={openActionDefinition.destructive}
          isLoading={pendingAction === openActionDefinition.id}
          onClose={handleCloseDialog}
          onConfirm={handleConfirmAction}
        />
      ) : null}
    </section>
  );
}
