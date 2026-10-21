'use client';

import {
  SubscriptionStatusEnum,
  type SubscriptionRecord,
} from '@myorganiser/vault-core';
import { ConfirmDialog, IconButton } from '@myorganiser/web-ui';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { SubscriptionsPageController } from '../hooks/use-subscriptions-page';
import type { SubscriptionFormSurfaceProps } from '../hooks/use-subscription-form';
import type { SubscriptionFormValues } from '../schemas/subscription';
import { getSubscriptionStatusLabel } from '../utils/presentation';
import {
  emptySubscriptionFormValues,
  subscriptionToFormValues,
} from '../utils/subscription-form-values';
import {
  activeMonthlyTotals,
  countByStatus,
  filterSubscriptions,
  formatRenewal,
  formatSubscriptionsSummary,
  nextActiveRenewal,
  sortSubscriptions,
} from '../utils/subscription-summary';
import type {
  SubscriptionListFilter,
  SubscriptionSort,
} from '../utils/subscription-summary';
import { SubscriptionDetailPanel } from './subscription-detail-panel';
import { SubscriptionFilters } from './subscription-filters';
import { SubscriptionFormDialog } from './subscription-form-dialog';
import { SubscriptionFormSheet } from './subscription-form-sheet';
import { SubscriptionList } from './subscription-list';
import { SubscriptionsEmpty } from './subscriptions-empty';
import { SubscriptionsHeader } from './subscriptions-header';
import { SubscriptionsTotals } from './subscriptions-totals';
import type { NextRenewalSummary } from './subscriptions-totals';

export interface SubscriptionsBoardProps {
  page: SubscriptionsPageController;
  variant: 'desktop' | 'phone';
  /** Desktop only: the subscription whose detail panel opens on first render. */
  initialSelectedId?: string;
}

/** The add/edit form: closed, adding, or editing one record. */
type SubscriptionFormState =
  | { mode: 'add' }
  | { mode: 'edit'; id: string }
  | null;

const DESKTOP_CONTAINER = 'mx-auto flex w-full max-w-310 flex-col gap-5.5 p-8';
const PHONE_CONTAINER = 'flex flex-col gap-3.5 pt-1 pb-24';
const DELETE_DESCRIPTION =
  'This action cannot be undone. The subscription will be permanently removed.';

/** The next active renewal for the totals card, or null when none is upcoming. */
function buildNextRenewal(
  items: readonly SubscriptionRecord[],
  today: Date,
): NextRenewalSummary | null {
  const next = nextActiveRenewal(items, today);
  if (!next) return null;
  const renewal = formatRenewal(next.nextBillingDate, today);
  if (!renewal) return null;
  return {
    name: next.name,
    amount: next.amount,
    currency: next.currency,
    renewal,
  };
}

/**
 * The Subscriptions board shared by the list and the detail route. It owns the
 * filter, sort, desktop selection, the add/edit form and the delete dialog, and
 * reads and writes through the `useSubscriptionsPage` controller it is given.
 */
export function SubscriptionsBoard({
  page,
  variant,
  initialSelectedId,
}: SubscriptionsBoardProps) {
  const {
    items,
    loading,
    preferredCurrency,
    conversion,
    convertToPreferred,
    showOriginal,
    addSubscription,
    updateSubscription,
    markCancelled,
    deleteSubscription,
  } = page;
  const isPhone = variant === 'phone';

  const [filter, setFilter] = useState<SubscriptionListFilter>('active');
  const [sort, setSort] = useState<SubscriptionSort>('nextRenewal');
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialSelectedId,
  );
  const [formState, setFormState] = useState<SubscriptionFormState>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubscriptionRecord | null>(
    null,
  );
  // Only the initial selection seeds the filter, and only once the records
  // have loaded; later filter changes belong to the user.
  const [filterSeeded, setFilterSeeded] = useState(
    initialSelectedId === undefined,
  );

  if (!filterSeeded && !loading) {
    setFilterSeeded(true);
    const initial = items.find((s) => s.id === initialSelectedId);
    if (initial) setFilter(initial.status);
  }

  const today = new Date();
  // Phone always sorts by next renewal and has no sort control.
  const effectiveSort: SubscriptionSort = isPhone ? 'nextRenewal' : sort;
  const totals = activeMonthlyTotals(items, preferredCurrency);
  const nextRenewal = buildNextRenewal(items, today);
  const counts = countByStatus(items);
  const listItems = sortSubscriptions(
    filterSubscriptions(items, filter),
    effectiveSort,
  );
  const summary = loading ? '' : formatSubscriptionsSummary(items, today);
  const listLabel =
    filter === 'others'
      ? 'Other subscriptions'
      : `${getSubscriptionStatusLabel(filter)} subscriptions`;
  const emptyMessage =
    filter === 'others'
      ? 'No other subscriptions.'
      : `No ${getSubscriptionStatusLabel(filter).toLowerCase()} subscriptions.`;

  // A selection whose record has gone (deleted elsewhere) finds nothing, so no
  // panel opens on a stale id.
  const selectedRecord =
    selectedId === undefined
      ? undefined
      : items.find((s) => s.id === selectedId);

  const formRecordId = formState?.mode === 'edit' ? formState.id : undefined;
  const formRecord =
    formRecordId === undefined
      ? undefined
      : items.find((s) => s.id === formRecordId);
  // An edit whose record is gone (deleted elsewhere) closes rather than showing
  // a blank form that would submit against a missing id.
  const effectiveFormState: SubscriptionFormState =
    formState?.mode === 'edit' && !loading && !formRecord ? null : formState;
  const formMode = effectiveFormState?.mode ?? 'add';
  // Memoised on the record so the values stay referentially stable while the
  // form is open.
  const formInitialValues = useMemo<SubscriptionFormValues>(
    () =>
      formRecord
        ? subscriptionToFormValues(formRecord)
        : emptySubscriptionFormValues(preferredCurrency),
    [formRecord, preferredCurrency],
  );

  const handleAdd = useCallback(() => {
    setFormState({ mode: 'add' });
  }, []);

  const handleFormOpenChange = useCallback((open: boolean) => {
    if (!open) setFormState(null);
  }, []);

  const handleFormSubmit = useCallback(
    (values: SubscriptionFormValues) => {
      if (effectiveFormState?.mode === 'edit') {
        return updateSubscription(effectiveFormState.id, values);
      }
      return addSubscription(values);
    },
    [addSubscription, effectiveFormState, updateSubscription],
  );

  const handleConvert = useCallback(() => {
    void convertToPreferred();
  }, [convertToPreferred]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedId(undefined);
  }, []);

  const handleEdit = useCallback(() => {
    if (selectedRecord) setFormState({ mode: 'edit', id: selectedRecord.id });
  }, [selectedRecord]);

  const handleMarkCancelled = useCallback(() => {
    if (selectedRecord) void markCancelled(selectedRecord.id);
  }, [markCancelled, selectedRecord]);

  const handleRequestDelete = useCallback(() => {
    if (selectedRecord) setDeleteTarget(selectedRecord);
  }, [selectedRecord]);

  const handleDeleteOpenChange = useCallback((open: boolean) => {
    if (!open) setDeleteTarget(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const deletedId = deleteTarget.id;
    const deleted = await deleteSubscription(deletedId);
    // On failure the dialog stays open so the user can retry.
    if (!deleted) return;
    setDeleteTarget(null);
    setSelectedId((current) => (current === deletedId ? undefined : current));
  }, [deleteSubscription, deleteTarget]);

  const formSurface: SubscriptionFormSurfaceProps = {
    open: effectiveFormState !== null,
    onOpenChange: handleFormOpenChange,
    mode: formMode,
    initialValues: formInitialValues,
    onSubmit: handleFormSubmit,
  };

  const formElement = isPhone ? (
    <SubscriptionFormSheet {...formSurface} />
  ) : (
    <SubscriptionFormDialog {...formSurface} />
  );

  const deleteDialog = deleteTarget ? (
    <ConfirmDialog
      open
      onOpenChange={handleDeleteOpenChange}
      title={`Delete "${deleteTarget.name}"?`}
      description={DELETE_DESCRIPTION}
      confirmLabel="Delete subscription"
      tone="destructive"
      onConfirm={handleConfirmDelete}
    />
  ) : null;

  let body: ReactNode;

  if (loading) {
    body = isPhone ? (
      <SubscriptionsHeader summary="" onAdd={handleAdd} variant="phone" />
    ) : (
      <div className={DESKTOP_CONTAINER}>
        <SubscriptionsHeader summary="" onAdd={handleAdd} variant="desktop" />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className={isPhone ? PHONE_CONTAINER : DESKTOP_CONTAINER}>
        <SubscriptionsEmpty onAdd={handleAdd} variant={variant} />
      </div>
    );
  } else if (isPhone) {
    body = (
      <div className={PHONE_CONTAINER}>
        <SubscriptionsHeader summary="" onAdd={handleAdd} variant="phone" />
        <SubscriptionsTotals
          totals={totals}
          preferredCurrency={preferredCurrency}
          activeCount={counts[SubscriptionStatusEnum.Active]}
          nextRenewal={nextRenewal}
          conversion={conversion}
          onConvert={handleConvert}
          onShowOriginal={showOriginal}
          variant="phone"
        />
        <SubscriptionFilters
          filter={filter}
          onFilterChange={setFilter}
          counts={counts}
          sort={effectiveSort}
          onSortChange={setSort}
          variant="phone"
        />
        <SubscriptionList
          subscriptions={listItems}
          today={today}
          label={listLabel}
          emptyMessage={emptyMessage}
          variant="phone"
          selectedId={selectedId}
          onSelect={handleSelect}
        />
        <IconButton
          variant="brand"
          size="fab"
          label="Add subscription"
          onClick={handleAdd}
          className="fixed right-4 bottom-[calc(var(--toast-offset,0px)+1rem)] z-10 md:hidden"
        >
          <Plus aria-hidden="true" />
        </IconButton>
      </div>
    );
  } else {
    body = (
      <div className={DESKTOP_CONTAINER}>
        <SubscriptionsHeader
          summary={summary}
          onAdd={handleAdd}
          variant="desktop"
        />
        <SubscriptionsTotals
          totals={totals}
          preferredCurrency={preferredCurrency}
          activeCount={counts[SubscriptionStatusEnum.Active]}
          nextRenewal={nextRenewal}
          conversion={conversion}
          onConvert={handleConvert}
          onShowOriginal={showOriginal}
          variant="desktop"
        />
        <SubscriptionFilters
          filter={filter}
          onFilterChange={setFilter}
          counts={counts}
          sort={effectiveSort}
          onSortChange={setSort}
          variant="desktop"
        />
        <div className="flex flex-wrap items-start gap-5.5">
          <div className="flex min-w-0 grow-999 shrink basis-130 flex-col">
            <SubscriptionList
              subscriptions={listItems}
              today={today}
              label={listLabel}
              emptyMessage={emptyMessage}
              variant="desktop"
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          </div>
          {selectedRecord ? (
            <div className="flex min-w-0 grow shrink basis-85">
              <SubscriptionDetailPanel
                subscription={selectedRecord}
                today={today}
                onClose={handleClosePanel}
                onEdit={handleEdit}
                onMarkCancelled={handleMarkCancelled}
                onDelete={handleRequestDelete}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      {body}
      {formElement}
      {deleteDialog}
    </>
  );
}
