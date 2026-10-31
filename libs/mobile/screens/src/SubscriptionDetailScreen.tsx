import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { VaultBlobType } from '@myorganiser/app-api-client';
import {
  useUnconfirmedEdit,
  useVaultBlob,
  useVaultSession,
  recoversByReload,
  VAULT_WRITE_ERROR_COPY,
} from '@myorganiser/mobile/feat-vault';
import {
  type SubscriptionRecord,
  type SubscriptionStatus,
} from '@myorganiser/vault-core/portable';
import {
  Button,
  EmptyState,
  haptics,
  Icon,
  InlineNotice,
  ListSection,
  LockAction,
  OfflineBanner,
  SavingNote,
  Screen,
  StatusPill,
  Text,
  useFocusRing,
  staticElement,
  usePressFeedback,
  useTheme,
  type StatusTone,
} from '@myorganiser/mobile/ui';
import {
  BILLING_CYCLE_LABELS,
  BILLING_CYCLE_UNITS,
  describeMonthlyEquivalent,
  describeScheduleLine,
  findVisibleSubscription,
  formatStoredDate,
  formatSubscriptionAmount,
  openableSubscriptionLink,
  openSubscriptionLink,
  PAYMENT_METHOD_LABELS,
  RENEWAL_TYPE_LABELS,
  subscriptionStatus,
  SUBSCRIPTION_STATUS_LABELS,
  TIER_LABELS,
  type DecryptedSubscription,
} from './subscriptionModel';
import {
  SubscriptionEditSheet,
  type SubscriptionEditValues,
} from './SubscriptionEditSheet';
import {
  SUBSCRIPTIONS_ROUTES,
  type SubscriptionsStackParamList,
} from './subscriptionsStack';
import { STACK_SCREEN_EDGES } from './TabScreenHeader';
import { subscriptionEdit } from './vaultRecordEdits';
import { useBarRuleOnScroll } from './useBarRuleOnScroll';
import { describeVaultLoadError } from './vaultLoadError';

/**
 * The hero's status pill. Active is the one status drawn in colour
 * (Sub-Detail); a Cancelled one is the neutral pair (Sub-Detail-Cancelled),
 * and the rest follow it — none of them is a warning.
 */
const STATUS_TONE = {
  active: 'success',
  pending: 'neutral',
  inactive: 'neutral',
  cancelled: 'neutral',
  expired: 'neutral',
} as const satisfies Record<SubscriptionStatus, StatusTone>;

/** A value row's height on Sub-Detail. */
const ROW_HEIGHT = 52;

/** "https://www.netflix.com/account/" → "netflix.com/account". */
function displayLink(link: string): string {
  return link
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
}

/**
 * One label-left, value-right row (Sub-Detail): the label in `body-sm`
 * muted, the value in `body`. A row with `onPress` opens something — the
 * Link row — and says so with its underlined value and outward glyph.
 */
function DetailRow({
  label,
  value,
  accessory,
  last = false,
  onPress,
}: {
  label: string;
  value: string;
  /** Drawn after the value — the Unconfirmed "Saving…". */
  accessory?: React.ReactNode;
  last?: boolean;
  onPress?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const press = usePressFeedback();
  const focus = useFocusRing('inset');

  // A row that does nothing is one static element named by its label, so
  // what it draws is kept from the screen reader (`staticElement`).
  const hidden = onPress == null ? 'no-hide-descendants' : undefined;
  const content = (
    <>
      <Text
        importantForAccessibility={hidden}
        variant="bodySm"
        color="mutedForeground"
        style={styles.label}
      >
        {label}
      </Text>
      <View
        importantForAccessibility={hidden}
        style={[styles.value, { gap: theme.spacing.sm }]}
      >
        {accessory}
        <Text
          variant="body"
          weight={onPress != null ? 'semibold' : undefined}
          numberOfLines={1}
          style={[styles.valueText, onPress != null && styles.underline]}
        >
          {value}
        </Text>
        {onPress != null && <Icon name="external" size={16} />}
      </View>
    </>
  );

  const rowStyle = [
    styles.row,
    {
      minHeight: ROW_HEIGHT,
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      backgroundColor: theme.colors.card,
      borderBottomColor: theme.colors.border,
    },
    last && styles.lastRow,
  ];

  if (onPress == null) {
    return (
      <View
        {...staticElement()}
        accessibilityLabel={`${label}, ${value}`}
        style={rowStyle}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      android_ripple={focus.ripple(press.android_ripple)}
      style={({ pressed }) => [
        ...rowStyle,
        press.pressedStyle(pressed),
        focus.ringStyle,
      ]}
    >
      {content}
    </Pressable>
  );
}

/**
 * One Subscription's detail (Sub-Detail): a hero with the name, status,
 * amount and when it renews, then every field grouped — Plan, Schedule,
 * Payment, Link — with a Cancelled one's Cancellation first
 * (Sub-Detail-Cancelled). Edit sits in the navigation bar beside Lock and
 * opens the Edit sheet; the link opens the system browser.
 *
 * Save closes the sheet at once and the edit shows here as an Unconfirmed
 * Edit — "Saving…" beside the hero amount and the Amount row
 * (Sub-Detail-Saving) — until the server confirms it or it is put back.
 */
export function SubscriptionDetailScreen(): React.JSX.Element {
  const theme = useTheme();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<
        SubscriptionsStackParamList,
        typeof SUBSCRIPTIONS_ROUTES.detail
      >
    >();
  const { subscriptionId } =
    useRoute<
      RouteProp<SubscriptionsStackParamList, typeof SUBSCRIPTIONS_ROUTES.detail>
    >().params;
  const { lock } = useVaultSession();

  const {
    snapshot,
    loading,
    loadError,
    writing,
    writeError,
    reload,
    apply,
    retry,
  } = useVaultBlob(VaultBlobType.Subscriptions);

  const subscription = useMemo(
    () => findVisibleSubscription(snapshot?.envelope.records, subscriptionId),
    [snapshot, subscriptionId],
  );

  const { pendingId, revertedId, push, reloadAfterConflict, retryFailedEdit } =
    useUnconfirmedEdit(apply, retry, reload);

  const [editVisible, setEditVisible] = useState(false);

  const openEdit = useCallback((): void => setEditVisible(true), []);
  const canEdit = subscription !== null && !writing;

  // The name is the hero's, so the bar carries only the way back, Edit, and
  // Lock (Sub-Detail).
  useLayoutEffect(() => {
    navigation.setOptions({
      title: '',
      headerRight: () => (
        <View style={styles.headerActions}>
          <Button
            label="Edit"
            variant="ghost"
            size="compact"
            disabled={!canEdit}
            onPress={openEdit}
          />
          <LockAction onPress={() => lock('manual')} />
        </View>
      ),
    });
  }, [navigation, canEdit, openEdit, lock]);
  const barRule = useBarRuleOnScroll();

  const commitEdit = useCallback(
    (values: SubscriptionEditValues): void => {
      if (subscription === null) return;
      const now = new Date().toISOString();
      // The sheet closes on Save; the edit carries on here as Unconfirmed.
      setEditVisible(false);
      void push(
        subscription.id,
        subscriptionEdit(subscription as SubscriptionRecord, values, now),
      );
    },
    [subscription, push],
  );

  const cancelEdit = useCallback((): void => setEditVisible(false), []);

  const openLink = useCallback((): void => {
    if (subscription != null) {
      openSubscriptionLink(subscription, (url) => Linking.openURL(url));
    }
  }, [subscription]);

  const notice = writeError == null ? null : VAULT_WRITE_ERROR_COPY[writeError];
  const saving = subscription !== null && pendingId === subscription.id;
  const reverted =
    subscription !== null &&
    revertedId === subscription.id &&
    writeError != null;

  // A revert is felt as well as read, as on every row (Lists sheet). Fired on
  // the transition only, never for a screen opened already reverted.
  const wasReverted = useRef(reverted);
  useEffect(() => {
    if (reverted && !wasReverted.current) haptics.revert();
    wasReverted.current = reverted;
  }, [reverted]);

  return (
    <Screen edges={STACK_SCREEN_EDGES} noPadding>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : loadError != null ? (
        <View
          style={[
            styles.centered,
            { gap: theme.spacing.md, padding: theme.spacing.md },
          ]}
        >
          <OfflineBanner />
          <InlineNotice
            tone="destructive"
            message={describeVaultLoadError(loadError, 'this subscription')}
          />
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => void reload()}
          />
        </View>
      ) : subscription === null ? (
        <View style={[styles.centered, { padding: theme.spacing.lg }]}>
          <EmptyState
            icon="subscriptions"
            title="Subscription not found"
            description="It may have been deleted on another device."
          />
        </View>
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          onScroll={barRule.onScroll}
          scrollEventThrottle={barRule.scrollEventThrottle}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: theme.spacing.lg },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <OfflineBanner />

          {reverted && notice != null && (
            <InlineNotice
              tone="warning"
              variant="compact"
              message={notice.message}
              actionLabel={notice.action}
              actionIcon="retry"
              onAction={() =>
                void (recoversByReload(writeError)
                  ? reloadAfterConflict()
                  : retryFailedEdit())
              }
              style={{
                paddingHorizontal: theme.spacing.md,
                paddingBottom: theme.spacing.sm,
              }}
            />
          )}

          <SubscriptionHero subscription={subscription} saving={saving} />

          <SubscriptionFields
            subscription={subscription}
            saving={saving}
            onOpenLink={openLink}
          />
        </ScrollView>
      )}

      <SubscriptionEditSheet
        visible={editVisible}
        busy={saving}
        subscription={subscription}
        onSave={commitEdit}
        onCancel={cancelEdit}
      />
    </Screen>
  );
}

/**
 * The hero (Sub-Detail): name, status pill and tier, the amount over its
 * cycle, and the schedule line — "Renews in 2 days · Tue 29 Sep ·
 * auto-renews", or when a Cancelled one stopped. A manual renewal carries
 * the warning pill where "auto-renews" would be.
 */
function SubscriptionHero({
  subscription,
  saving,
}: {
  subscription: DecryptedSubscription;
  saving: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const status = subscriptionStatus(subscription);
  const cancelled = status === 'cancelled';
  const schedule = describeScheduleLine(subscription, new Date());
  const manual = !cancelled && subscription.renewalType === 'manual';
  const autoRenews = !cancelled && subscription.renewalType === 'autoRenew';

  return (
    <View
      style={{
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        // The sheet leaves 20 under the hero — between two steps, so `lg`.
        paddingBottom: theme.spacing.lg,
      }}
    >
      <Text variant="display" accessibilityRole="header">
        {subscription.name ?? 'Untitled subscription'}
      </Text>
      <View style={[styles.inline, { gap: theme.spacing.sm }]}>
        <StatusPill
          label={SUBSCRIPTION_STATUS_LABELS[status]}
          tone={STATUS_TONE[status]}
        />
        {subscription.tier != null && (
          <Text variant="bodySm" color="mutedForeground">
            {`${TIER_LABELS[subscription.tier]} tier`}
          </Text>
        )}
      </View>
      {subscription.amount != null && subscription.currency != null && (
        <View
          style={[
            styles.baseline,
            // The sheet sets the figure 4 below the pill row, 6 from its unit.
            { gap: theme.spacing.sm, paddingTop: theme.spacing.xs },
          ]}
        >
          <Text
            variant="titleLg"
            color={cancelled ? 'mutedForeground' : 'foreground'}
            style={styles.figures}
          >
            {formatSubscriptionAmount(
              subscription.amount,
              subscription.currency,
            )}
          </Text>
          {subscription.billingCycle != null && (
            <Text variant="bodySm" color="mutedForeground">
              {BILLING_CYCLE_UNITS[subscription.billingCycle]}
            </Text>
          )}
          {saving && <SavingNote />}
        </View>
      )}
      <View style={[styles.inline, styles.wrap, { gap: theme.spacing.sm }]}>
        <Text variant="bodySm">
          {autoRenews ? `${schedule} · auto-renews` : schedule}
        </Text>
        {manual && <StatusPill label="Manual" tone="warning" />}
      </View>
    </View>
  );
}

/** Every field, grouped as Sub-Detail groups them. */
function SubscriptionFields({
  subscription,
  saving,
  onOpenLink,
}: {
  subscription: DecryptedSubscription;
  saving: boolean;
  onOpenLink: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const status = subscriptionStatus(subscription);
  const monthlyEquivalent = describeMonthlyEquivalent(subscription);
  const link = openableSubscriptionLink(subscription);

  return (
    // The sheet leaves 12 between groups: `md`, a tie rounded up.
    <View style={{ gap: theme.spacing.md }}>
      {status === 'cancelled' && (
        <ListSection title="Cancellation">
          <DetailRow
            label="Cancelled on"
            value={formatStoredDate(subscription.cancellationDate)}
          />
          <DetailRow
            label="Reason"
            value={subscription.cancellationReason ?? '—'}
            last
          />
        </ListSection>
      )}

      <ListSection title="Plan">
        <DetailRow label="Status" value={SUBSCRIPTION_STATUS_LABELS[status]} />
        <DetailRow
          label="Tier"
          value={
            subscription.tier != null ? TIER_LABELS[subscription.tier] : '—'
          }
        />
        <DetailRow
          label="Billing cycle"
          value={
            subscription.billingCycle != null
              ? BILLING_CYCLE_LABELS[subscription.billingCycle]
              : '—'
          }
        />
        <DetailRow
          label="Amount"
          value={
            subscription.amount != null && subscription.currency != null
              ? formatSubscriptionAmount(
                  subscription.amount,
                  subscription.currency,
                )
              : '—'
          }
          accessory={saving ? <SavingNote /> : undefined}
          last={monthlyEquivalent == null}
        />
        {monthlyEquivalent != null && (
          <DetailRow
            label="Monthly Equivalent"
            value={monthlyEquivalent}
            last
          />
        )}
      </ListSection>

      <ListSection title="Schedule">
        <DetailRow
          label="Start date"
          value={formatStoredDate(subscription.startDate)}
        />
        <DetailRow
          label="Next billing date"
          value={
            status === 'cancelled'
              ? '—'
              : formatStoredDate(subscription.nextBillingDate)
          }
        />
        <DetailRow
          label="Renewal type"
          value={
            subscription.renewalType != null
              ? RENEWAL_TYPE_LABELS[subscription.renewalType]
              : '—'
          }
        />
        <DetailRow
          label="End date"
          value={formatStoredDate(subscription.endDate)}
          last
        />
      </ListSection>

      <ListSection title="Payment">
        <DetailRow
          label="Payment method"
          value={
            subscription.paymentMethod != null
              ? PAYMENT_METHOD_LABELS[subscription.paymentMethod]
              : '—'
          }
        />
        <DetailRow label="Currency" value={subscription.currency ?? '—'} last />
      </ListSection>

      {link != null && (
        <ListSection title="Link">
          <DetailRow
            label="Account page"
            value={displayLink(link)}
            onPress={onOpenLink}
            last
          />
        </ListSection>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wrap: {
    flexWrap: 'wrap',
  },
  baseline: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  figures: {
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  label: {
    flexShrink: 0,
  },
  value: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  valueText: {
    flexShrink: 1,
    textAlign: 'right',
  },
  underline: {
    textDecorationLine: 'underline',
  },
});
