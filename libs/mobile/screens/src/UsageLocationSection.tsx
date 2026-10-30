import React, { useMemo } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import type {
  OrganisationType,
  UpdateMethod,
} from '@myorganiser/vault-core/portable';
import {
  Checkbox,
  Icon,
  IconButton,
  ListRow,
  ListSection,
  ProgressMeter,
  Text,
  useTheme,
  type IconName,
} from '@myorganiser/mobile/ui';
import {
  describeNotifiedOn,
  describeNotifiedProgress,
  describeSeeAllUsageLocations,
  describeUsageLocationMeta,
  groupUsageLocations,
  isNotified,
  openableUsageLocationLink,
  PRIORITY_LABEL,
  UPDATE_METHOD_LABEL,
  USAGE_LOCATIONS_COPY,
  type ContactKind,
  type DecryptedUsageLocation,
} from './contactModel';
import type { UsageLocationEdits } from './useContactRecord';

/**
 * The glyph each Organisation Type's tile draws, pinned to the type set
 * (ADR 0053). The Details sheets draw six of them — government, healthcare,
 * bank, employer, utility, telecom; the rest take the nearest drawn glyph.
 */
const ORGANISATION_TYPE_ICON = {
  government: 'government',
  private: 'briefcase',
  bank: 'bank',
  insurance: 'shield',
  school: 'graduation',
  university: 'graduation',
  employer: 'briefcase',
  utility: 'bolt',
  healthcare: 'healthcare',
  telecom: 'call',
  housing: 'home',
  email: 'mail',
  other: 'more',
} as const satisfies Record<OrganisationType, IconName>;

/** The glyph before each Update Method on a row's meta line, pinned. */
const UPDATE_METHOD_ICON = {
  online: 'globe',
  inPerson: 'person',
  phone: 'call',
  mail: 'mail',
} as const satisfies Record<UpdateMethod, IconName>;

/** The meta line of a Usage Location still to notify: how it is reached, and
 * how urgent it is, with High set heavier in the body colour (Det-UL). */
function ToNotifyMeta({
  location,
}: {
  location: DecryptedUsageLocation;
}): React.JSX.Element {
  const theme = useTheme();
  const method = location.updateMethod;
  const priority = location.priority;
  const urgent = priority === 'high';

  return (
    <View style={[styles.inline, { gap: theme.spacing.xs }]}>
      {method != null && (
        <View style={[styles.inline, { gap: theme.spacing.xs }]}>
          <Icon
            name={UPDATE_METHOD_ICON[method]}
            size={14}
            color="mutedForeground"
          />
          <Text variant="caption" numberOfLines={1}>
            {UPDATE_METHOD_LABEL[method]}
          </Text>
        </View>
      )}
      {method != null && priority != null && <Text variant="caption">·</Text>}
      {priority != null && (
        <Text
          variant="caption"
          weight={urgent ? 'bold' : undefined}
          color={urgent ? 'foreground' : 'mutedForeground'}
          numberOfLines={1}
        >
          {PRIORITY_LABEL[priority]}
        </Text>
      )}
    </View>
  );
}

export interface UsageLocationRowProps {
  location: DecryptedUsageLocation;
  edits: UsageLocationEdits;
  now: Date;
}

/**
 * One Usage Location: its Organisation Type's tile, its name, how it is
 * reached and how urgent it is — or, once notified, when — then its website
 * and its notified box on the right (Det-UL). A notified row is muted, not
 * struck: it is done, and still listed.
 *
 * The whole row is the tick target and announces as a checkbox; the drawn
 * box is there for sight, and the website link is a row action as well,
 * because a control inside the row is not reachable by a screen reader.
 */
export function UsageLocationRow({
  location,
  edits,
  now,
}: UsageLocationRowProps): React.JSX.Element {
  const notified = isNotified(location);
  const name = location.organisationName?.trim() || 'Organisation';
  const link = openableUsageLocationLink(location);
  const hasLink = link != null;
  const state = edits.rowState(location.id);
  // A tick in flight keeps the line it had, so the row still says how the
  // organisation is reached while "Saving…" shows (Det-UL-Unconfirmed).
  const showsNotifiedOn = notified && state !== 'unconfirmed';
  const metaText = showsNotifiedOn
    ? describeNotifiedOn(location, now)
    : describeUsageLocationMeta(location);
  const openLink = (): void => {
    if (hasLink) void Linking.openURL(link);
  };
  const toggle = (): void => edits.toggle(location);

  return (
    <ListRow
      title={name}
      titleWeight="semibold"
      size="tall"
      subtitle={metaText.length > 0 ? metaText : undefined}
      subtitleContent={
        showsNotifiedOn ? undefined : <ToNotifyMeta location={location} />
      }
      leadingIcon={
        location.organisationType != null
          ? ORGANISATION_TYPE_ICON[location.organisationType]
          : 'more'
      }
      leadingIconSize="large"
      leadingIconColor={notified ? 'mutedForeground' : 'foreground'}
      checked={notified}
      strikeChecked={false}
      entering={edits.arrivedId === location.id}
      accessibilityLabel={
        metaText.length > 0
          ? `Notified ${name}, ${metaText}`
          : `Notified ${name}`
      }
      onPress={edits.writing ? undefined : toggle}
      trailing={
        <View style={styles.inline}>
          {hasLink && (
            <IconButton
              icon="external"
              accessibilityLabel={`Open ${name} website`}
              onPress={openLink}
            />
          )}
          <Checkbox
            checked={notified}
            disabled={edits.writing}
            accessibilityLabel={`Notified ${name}`}
            onChange={toggle}
          />
        </View>
      }
      innerActions={
        hasLink
          ? [
              {
                id: 'open-website',
                label: `Open ${name} website`,
                onPress: openLink,
              },
            ]
          : []
      }
      state={state}
      revertedReason={state === 'reverted' ? edits.revertedReason : undefined}
      retryLabel={edits.retryLabel}
      onRetry={edits.retry}
    />
  );
}

export interface UsageLocationProgressProps {
  kind: ContactKind;
  usageLocations: readonly DecryptedUsageLocation[];
}

/**
 * "5 of 8 notified" over its bar, "3 to go" at the far edge — or, with
 * nobody left, "All done" on a full success bar and the line that says so
 * (Det-UL-AllDone). Renders nothing for a record with no Usage Location.
 */
export function UsageLocationProgress({
  kind,
  usageLocations,
}: UsageLocationProgressProps): React.JSX.Element | null {
  const theme = useTheme();
  const progress = describeNotifiedProgress(usageLocations);
  if (progress === null) return null;

  return (
    <View
      style={{
        gap: theme.spacing.md,
        paddingTop: theme.spacing.xs,
        paddingHorizontal: theme.spacing.md,
        paddingBottom: theme.spacing.md,
      }}
    >
      <ProgressMeter
        value={progress.fraction}
        label={progress.label}
        meta={progress.meta}
      />
      {progress.complete && (
        <View style={[styles.inline, { gap: theme.spacing.sm }]}>
          <Icon name="check" size={20} color="success" />
          <Text variant="bodySm" style={styles.grow}>
            {USAGE_LOCATIONS_COPY[kind].allDone}
          </Text>
        </View>
      )}
    </View>
  );
}

export interface UsageLocationSectionProps {
  kind: ContactKind;
  usageLocations: readonly DecryptedUsageLocation[];
  edits: UsageLocationEdits;
  /** Opens the full list, where the notified ones are too. */
  onSeeAll: () => void;
}

/**
 * A detail's preview of its Usage Locations: the progress, then only the
 * ones still to notify, by priority, and a way to the whole list — "See all
 * 8, including notified" (Det-Address, Det-Mobile). Ticking notified is the
 * only edit here; creating, editing, or deleting a Usage Location stays
 * web-only. A record with none shows nothing (Det-Address-Legacy).
 */
export function UsageLocationSection({
  kind,
  usageLocations,
  edits,
  onSeeAll,
}: UsageLocationSectionProps): React.JSX.Element | null {
  const now = useMemo(() => new Date(), []);
  const { toNotify } = groupUsageLocations(usageLocations, edits.pendingId);
  if (usageLocations.length === 0) return null;

  const seeAll = (
    <ListRow
      key="see-all"
      title={describeSeeAllUsageLocations(usageLocations.length)}
      titleWeight="semibold"
      chevron
      onPress={onSeeAll}
    />
  );

  return (
    <View>
      <ListSection title="Usage Locations" />
      <UsageLocationProgress kind={kind} usageLocations={usageLocations} />
      {toNotify.length > 0 ? (
        <ListSection title={`To notify · ${toNotify.length} · by priority`}>
          {toNotify.map((location) => (
            <UsageLocationRow
              key={location.id}
              location={location}
              edits={edits}
              now={now}
            />
          ))}
          {seeAll}
        </ListSection>
      ) : (
        seeAll
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  grow: {
    flexShrink: 1,
    flexGrow: 1,
  },
});
