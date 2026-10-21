'use client';

import { ConfirmDialog, useIsMobileState } from '@myorganiser/web-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultGate } from '@myorganiser/web-vault-ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSubscriptionsPage } from '../hooks/use-subscriptions-page';
import type { SubscriptionsPageController } from '../hooks/use-subscriptions-page';
import type { SubscriptionFormValues } from '../schemas/subscription';
import {
  emptySubscriptionFormValues,
  subscriptionToFormValues,
} from '../utils/subscription-form-values';
import { SubscriptionDetailScreen } from './subscription-detail-screen';
import { SubscriptionFormSheet } from './subscription-form-sheet';
import { SubscriptionsBoard } from './subscriptions-board';

const SUBSCRIPTIONS_HREF = '/dashboard/subscriptions';

export interface SubscriptionDetailPageClientProps {
  subscriptionId: string;
}

interface SubscriptionDetailInnerProps extends SubscriptionDetailPageClientProps {
  handle: VaultHandle;
}

interface SubscriptionDetailPhoneProps {
  page: SubscriptionsPageController;
  subscriptionId: string;
}

/** The phone detail: the subscription pushed over the list, with each exit back to the list. */
function SubscriptionDetailPhone({
  page,
  subscriptionId,
}: SubscriptionDetailPhoneProps) {
  const router = useRouter();
  const {
    items,
    loading,
    preferredCurrency,
    updateSubscription,
    markCancelled,
    deleteSubscription,
  } = page;
  const subscription = items.find((s) => s.id === subscriptionId);
  const today = new Date();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Set while the subscription is being deleted, so the not-found redirect does
  // not race the explicit navigation back to the list.
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!loading && !subscription && !leavingRef.current) {
      router.replace(SUBSCRIPTIONS_HREF);
    }
  }, [loading, router, subscription]);

  const formInitialValues = useMemo<SubscriptionFormValues>(
    () =>
      subscription
        ? subscriptionToFormValues(subscription)
        : emptySubscriptionFormValues(preferredCurrency),
    [subscription, preferredCurrency],
  );

  const handleRequestEdit = useCallback(() => {
    setEditing(true);
  }, []);

  const handleEditOpenChange = useCallback((open: boolean) => {
    setEditing(open);
  }, []);

  const handleSubmitEdit = useCallback(
    (values: SubscriptionFormValues) =>
      updateSubscription(subscriptionId, values),
    [subscriptionId, updateSubscription],
  );

  const handleMarkCancelled = useCallback(() => {
    void markCancelled(subscriptionId);
  }, [markCancelled, subscriptionId]);

  const handleRequestDelete = useCallback(() => {
    setDeleting(true);
  }, []);

  const handleDeleteOpenChange = useCallback((open: boolean) => {
    setDeleting(open);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!subscription) return;
    leavingRef.current = true;
    const deleted = await deleteSubscription(subscription.id);
    if (deleted) {
      setDeleting(false);
      router.push(SUBSCRIPTIONS_HREF);
    } else {
      // Stay on the detail with the dialog open, so the user can retry.
      leavingRef.current = false;
    }
  }, [deleteSubscription, router, subscription]);

  if (loading || !subscription) {
    return null;
  }

  return (
    <>
      <SubscriptionDetailScreen
        subscription={subscription}
        today={today}
        onEdit={handleRequestEdit}
        onMarkCancelled={handleMarkCancelled}
        onDelete={handleRequestDelete}
      />
      <SubscriptionFormSheet
        open={editing}
        onOpenChange={handleEditOpenChange}
        mode="edit"
        initialValues={formInitialValues}
        onSubmit={handleSubmitEdit}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={handleDeleteOpenChange}
        title={`Delete "${subscription.name}"?`}
        description="This action cannot be undone. The subscription will be permanently removed."
        confirmLabel="Delete subscription"
        tone="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

function SubscriptionDetailInner({
  handle,
  subscriptionId,
}: SubscriptionDetailInnerProps) {
  const page = useSubscriptionsPage(handle);
  // Render nothing until the breakpoint is decided, so a phone never paints
  // the desktop board on the first frame.
  const isPhone = useIsMobileState();

  if (isPhone === undefined) {
    return null;
  }

  if (isPhone) {
    return (
      <SubscriptionDetailPhone page={page} subscriptionId={subscriptionId} />
    );
  }

  return (
    <SubscriptionsBoard
      page={page}
      variant="desktop"
      initialSelectedId={subscriptionId}
    />
  );
}

export function SubscriptionDetailPageClient({
  subscriptionId,
}: SubscriptionDetailPageClientProps) {
  return (
    <VaultGate title="Subscriptions">
      {({ handle }) =>
        handle ? (
          <SubscriptionDetailInner
            handle={handle}
            subscriptionId={subscriptionId}
          />
        ) : null
      }
    </VaultGate>
  );
}
