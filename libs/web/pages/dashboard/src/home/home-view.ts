import { formatMoney, formatUsd } from '@myorganiser/core';
import type { IllustrationKind } from '@myorganiser/web-ui';
import {
  VAULT_HOME_WITHHELD_COPY,
  type VaultHomeState,
  type VaultHomeWithheldState,
} from '@myorganiser/web-vault-ui';
import { formatDistanceStrict, isValid } from 'date-fns';
import {
  formatDateCaption,
  formatRenewalDay,
  getGreeting,
  isParseableTimestamp,
  pluralize,
  type HomeSummaryData,
} from './home-summary';

/**
 * The Home view model: every string and number the Home components draw,
 * built from the summaries. Pure, so the copy and the state rules can be
 * tested without rendering.
 */

export type HomePillTone = 'neutral' | 'warning' | 'danger' | 'trust';

export interface HomePill {
  label: string;
  tone: HomePillTone;
}

export type HomeSpaceKey =
  | 'tasks'
  | 'groceries'
  | 'subscriptions'
  | 'addresses'
  | 'mobile'
  | 'youtube'
  | 'vault';

export interface HomeSpace {
  key: HomeSpaceKey;
  kind: IllustrationKind;
  title: string;
  href: string;
  /** Desktop one-line summary. */
  summary: string;
  /** Desktop pill, or null for none. */
  pill: HomePill | null;
  /** Phone tile meta line. */
  meta: string;
  /** Phone tile pill, or null for none. */
  phonePill: HomePill | null;
}

export interface HomeDueRow {
  id: string;
  title: string;
  pill: HomePill;
}

export interface HomeRenewalRow {
  id: string;
  name: string;
  when: string;
  amount: string;
}

export interface HomeVideoRow {
  videoId: string;
  title: string;
  thumbnail: string | null;
  href: string;
  /** "Channel · 2 hours ago". */
  meta: string;
}

/** The latest successful export, as the Vault space reads it. */
export type BackupState =
  | { status: 'pending' }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'loaded'; record: { createdAt: string; source: string } };

export interface YouTubeVideo {
  videoId: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string;
  channelTitle?: string;
}

export type YouTubeState =
  | { status: 'loading' }
  | { status: 'disconnected' }
  | { status: 'error' }
  | {
      status: 'loaded';
      /** Null when the channel list could not be read; the videos still show. */
      channels: number | null;
      videos: readonly YouTubeVideo[];
    };

/** YouTube is gated by the nav rule; its data is server-side, not vault. */
export interface YouTubeHome {
  visible: boolean;
  state: YouTubeState;
}

export interface HomeViewInput {
  now: Date;
  firstName: string | null;
  /** The one Home vault state every surface reads (`deriveVaultHomeState`). */
  vault: VaultHomeState;
  /** Null until the vault blobs have been read. */
  summary: HomeSummaryData | null;
  backup: BackupState;
  youtube: YouTubeHome;
  /** The sync line reads healthy, so the header shows the Synced chip. */
  synced: boolean;
}

/** A link Home offers about the Vault. Every one leads to the vault page. */
export interface HomeVaultAction {
  label: string;
  href: string;
}

/**
 * What Home says about a Vault that is not open: the desktop hero's sentence
 * and buttons, the phone card, the phone header chip and the sealed tiles.
 * One per Home vault state, so no surface keeps locked wording while another
 * changes.
 */
export interface HomeVaultPrompt {
  /** The desktop hero sentence. */
  heroLine: string;
  /** The desktop hero buttons; the first is the primary one. */
  heroActions: readonly HomeVaultAction[];
  /** The phone card's headline. */
  cardTitle: string;
  /** The phone card's line under the headline. */
  cardCaption: string;
  /** The phone card's full-width button. */
  cardAction: HomeVaultAction;
  /** The phone card's secondary text link, or null for none. */
  cardSecondaryAction: HomeVaultAction | null;
  /** The phone header chip, or null for none. */
  headerChip: string | null;
  /** The five data spaces' fields. */
  sealedSpace: SpaceFields;
  /** The Vault tile's fields. */
  vaultSpace: SpaceFields;
}

export interface HomeView {
  unlocked: boolean;
  /** The not-open treatment, or null while the Vault is unlocked. */
  vaultPrompt: HomeVaultPrompt | null;
  summaryPending: boolean;
  firstName: string;
  greeting: string;
  dateCaption: string;
  /** The desktop hero sentence, or the vault prompt's sentence. */
  heroLine: string;
  /** Today's progress, or null when there is nothing due to measure. */
  progress: { done: number; total: number } | null;
  /** Phone Today card headline. */
  todayTitle: string;
  /** Phone Today card line; empty when there is nothing to say. */
  todayMeta: string;
  synced: boolean;
  /** Desktop order. Phone hides Tasks; the component filters it. */
  spaces: readonly HomeSpace[];
  dueRows: readonly HomeDueRow[];
  renewalRows: readonly HomeRenewalRow[];
  youtubeVisible: boolean;
  youtube: YouTubeState;
  videoRows: readonly HomeVideoRow[];
}

const NO_PILL = null;

/** Each space's fixed identity. Both breakpoints and both lock states read it. */
const SPACE_TABLE = {
  tasks: { kind: 'tasks', title: 'Tasks', href: '/dashboard/tasks' },
  groceries: {
    kind: 'groceries',
    title: 'Groceries',
    href: '/dashboard/groceries',
  },
  subscriptions: {
    kind: 'subscriptions',
    title: 'Subscriptions',
    href: '/dashboard/subscriptions',
  },
  addresses: {
    kind: 'addresses',
    title: 'Addresses',
    href: '/dashboard/addresses',
  },
  mobile: {
    kind: 'mobile',
    title: 'Mobile numbers',
    href: '/dashboard/mobile-numbers',
  },
  youtube: { kind: 'youtube', title: 'YouTube', href: '/dashboard/youtube' },
  vault: { kind: 'vault', title: 'Vault', href: '/dashboard/vault' },
} as const satisfies Record<
  HomeSpaceKey,
  { kind: IllustrationKind; title: string; href: string }
>;

/** The data spaces in tile order, before YouTube and Vault. */
const DATA_SPACE_ORDER: readonly HomeSpaceKey[] = [
  'tasks',
  'groceries',
  'subscriptions',
  'addresses',
  'mobile',
];

/** The per-state fields of a space: everything except its fixed identity. */
export type SpaceFields = Omit<HomeSpace, 'key' | 'kind' | 'title' | 'href'>;

/** Tiles in order: data spaces, then YouTube when visible, then Vault. */
function assembleSpaces(
  fields: Record<HomeSpaceKey, SpaceFields>,
  youtubeVisible: boolean,
): HomeSpace[] {
  const order: readonly HomeSpaceKey[] = youtubeVisible
    ? [...DATA_SPACE_ORDER, 'youtube', 'vault']
    : [...DATA_SPACE_ORDER, 'vault'];
  return order.map((key) => ({ key, ...SPACE_TABLE[key], ...fields[key] }));
}

function neutral(label: string): HomePill {
  return { label, tone: 'neutral' };
}

function warning(label: string): HomePill {
  return { label, tone: 'warning' };
}

/** "2 days ago", measured from the injected clock rather than the wall clock. */
function relativeTo(iso: string, now: Date): string {
  const date = new Date(iso);
  if (!isValid(date)) return '';
  return formatDistanceStrict(date, now, { addSuffix: true });
}

function backupSummary(backup: BackupState, now: Date): string {
  if (backup.status === 'empty') return 'No backups recorded yet';
  if (backup.status !== 'loaded') return 'Unlocked';
  if (!isParseableTimestamp(backup.record.createdAt)) return 'Unlocked';
  const where =
    backup.record.source === 'google-drive' ? 'to Google Drive ' : '';
  return `Backed up ${where}${relativeTo(backup.record.createdAt, now)}`;
}

function tasksHeroPart(total: number): string {
  if (total === 0) return 'No tasks are due today';
  if (total === 1) return '1 task is due today';
  return `${total} tasks are due today`;
}

function renewalsHeroPart(count: number): string {
  if (count === 0) return 'no subscriptions renew this week';
  if (count === 1) return '1 subscription renews this week';
  return `${count} subscriptions renew this week`;
}

const VAULT_HREF = '/dashboard/vault';

const OPEN_VAULT: HomeVaultAction = { label: 'Open vault', href: VAULT_HREF };

/** Today's locked treatment, unchanged: owned, unclaimed or owner-mismatch. */
const LOCKED_PROMPT: HomeVaultPrompt = {
  heroLine:
    "Your vault is locked. Unlock it to see what's due, your lists and your spending.",
  heroActions: [
    { label: 'Unlock vault', href: VAULT_HREF },
    { label: 'Use recovery key', href: VAULT_HREF },
  ],
  cardTitle: 'Vault locked',
  cardCaption: 'Your data stays encrypted on this device',
  cardAction: { label: 'Unlock', href: VAULT_HREF },
  cardSecondaryAction: {
    label: 'Use recovery key instead',
    href: VAULT_HREF,
  },
  headerChip: 'Locked',
  sealedSpace: {
    summary: 'Encrypted · unlock to view',
    pill: neutral('Locked'),
    meta: 'Encrypted',
    phonePill: neutral('Locked'),
  },
  vaultSpace: {
    summary: 'Unlock to use your spaces',
    pill: warning('Locked'),
    meta: 'Encrypted',
    phonePill: neutral('Locked'),
  },
};

/**
 * No Vault here and the server proved it holds none. Home only links to the
 * vault page; `VaultGate`'s create form stays the one creation path.
 */
const CREATE_PROMPT: HomeVaultPrompt = {
  heroLine: 'Set up your encrypted vault to start using your spaces.',
  heroActions: [{ label: 'Create your vault', href: VAULT_HREF }],
  cardTitle: 'Set up your vault',
  cardCaption: 'Your data is encrypted on this device before it is saved',
  cardAction: { label: 'Create your vault', href: VAULT_HREF },
  cardSecondaryAction: null,
  headerChip: 'Not set up',
  sealedSpace: {
    summary: 'Set up your vault to use this space',
    pill: NO_PILL,
    meta: 'Needs a vault',
    phonePill: NO_PILL,
  },
  vaultSpace: {
    summary: 'Set up your vault to use your spaces',
    pill: warning('Not set up'),
    meta: 'Not set up',
    phonePill: neutral('Not set up'),
  },
};

/**
 * No Vault here and no proof the server holds none: the vault page's own
 * words, one link to it, and nothing that leads to creation.
 */
function withheldPrompt(state: VaultHomeWithheldState): HomeVaultPrompt {
  const { title, description } = VAULT_HOME_WITHHELD_COPY[state];
  return {
    heroLine: description,
    heroActions: [OPEN_VAULT],
    cardTitle: title,
    cardCaption: description,
    cardAction: OPEN_VAULT,
    cardSecondaryAction: null,
    headerChip: null,
    sealedSpace: {
      summary: 'Encrypted',
      pill: NO_PILL,
      meta: 'Encrypted',
      phonePill: NO_PILL,
    },
    vaultSpace: {
      summary: title,
      pill: NO_PILL,
      meta: title,
      phonePill: NO_PILL,
    },
  };
}

/** Pinned per Home vault state (ADR 0053); null while the Vault is open. */
const HOME_VAULT_PROMPTS = {
  unlocked: null,
  locked: LOCKED_PROMPT,
  create: CREATE_PROMPT,
  checking: withheldPrompt('checking'),
  'server-holds-vault': withheldPrompt('server-holds-vault'),
  postponed: withheldPrompt('postponed'),
  'session-lost': withheldPrompt('session-lost'),
} as const satisfies Record<VaultHomeState, HomeVaultPrompt | null>;

/** Space tiles for an unlocked vault, once the blobs are read. */
function unlockedSpaces(
  summary: HomeSummaryData | null,
  backup: BackupState,
  now: Date,
  youtube: YouTubeHome,
): HomeSpace[] {
  const loading = 'Loading…';
  const tasks = summary?.tasks;
  const groceries = summary?.groceries;
  const subs = summary?.subscriptions;
  const addresses = summary?.addresses;
  const mobile = summary?.mobile;

  const taskSummary =
    tasks === undefined
      ? loading
      : tasks.open === 0
        ? 'Nothing open'
        : tasks.openContexts.length > 0
          ? `${tasks.open} open across ${tasks.openContexts.join(' and ')}`
          : `${tasks.open} open`;
  const taskPill =
    tasks !== undefined && tasks.dueOpen.length > 0
      ? warning(`${tasks.dueOpen.length} due today`)
      : NO_PILL;

  const groceriesSummary =
    groceries === undefined
      ? loading
      : groceries.listCount === 0
        ? 'No grocery lists yet'
        : `${groceries.listCount} ${pluralize(groceries.listCount, 'list', 'lists')}, ${groceries.itemsLeft} ${pluralize(groceries.itemsLeft, 'item', 'items')} left to buy`;
  const groceriesPill =
    groceries !== undefined && groceries.listCount > 0
      ? neutral(formatUsd(groceries.knownSpend))
      : NO_PILL;
  const groceriesMeta =
    groceries === undefined
      ? loading
      : groceries.listCount === 0
        ? 'No grocery lists yet'
        : `${groceries.listCount} ${pluralize(groceries.listCount, 'list', 'lists')} · ${groceries.itemsLeft} left`;

  const monthlyText =
    subs === undefined
      ? loading
      : subs.active === 0
        ? 'None active'
        : subs.monthly === ''
          ? `${subs.active} active`
          : `${subs.active} active, ${subs.monthly} a month`;
  const renewCount = subs?.renewingSoon.length ?? 0;
  const subsPill =
    subs !== undefined && renewCount > 0
      ? warning(
          `${renewCount} ${pluralize(renewCount, 'renews', 'renew')} soon`,
        )
      : NO_PILL;
  const subsMeta =
    subs === undefined
      ? loading
      : subs.active === 0
        ? 'None active'
        : subs.monthly === ''
          ? `${subs.active} active`
          : `${subs.monthly} a month`;
  const subsPhonePill =
    subs !== undefined && renewCount > 0
      ? warning(`${renewCount} soon`)
      : NO_PILL;

  const addressSummary = addressLine(addresses, loading, 'desktop');
  const addressMeta = addressLine(addresses, loading, 'phone');
  const toUpdate =
    addresses === undefined ? 0 : addresses.places - addresses.updatedPlaces;
  const addressPill =
    addresses !== undefined && toUpdate > 0
      ? warning(`${toUpdate} to update`)
      : NO_PILL;

  const mobileSummary =
    mobile === undefined
      ? loading
      : mobile.count === 0
        ? 'None saved'
        : `${mobile.count} saved ${pluralize(mobile.count, 'number', 'numbers')}`;
  const mobileMeta =
    mobile === undefined
      ? loading
      : mobile.count === 0
        ? 'None saved'
        : `${mobile.count} saved`;
  const mobilePill =
    mobile !== undefined && mobile.count > 0
      ? neutral(String(mobile.count))
      : NO_PILL;

  const vaultSummary = backupSummary(backup, now);

  const fields: Record<HomeSpaceKey, SpaceFields> = {
    tasks: {
      summary: taskSummary,
      pill: taskPill,
      meta: taskSummary,
      phonePill: NO_PILL,
    },
    groceries: {
      summary: groceriesSummary,
      pill: groceriesPill,
      meta: groceriesMeta,
      phonePill: NO_PILL,
    },
    subscriptions: {
      summary: monthlyText,
      pill: subsPill,
      meta: subsMeta,
      phonePill: subsPhonePill,
    },
    addresses: {
      summary: addressSummary,
      pill: addressPill,
      meta: addressMeta,
      phonePill: NO_PILL,
    },
    mobile: {
      summary: mobileSummary,
      pill: mobilePill,
      meta: mobileMeta,
      phonePill: NO_PILL,
    },
    youtube: youtubeFields(youtube.state),
    vault: {
      summary: vaultSummary,
      pill: { label: 'Unlocked', tone: 'trust' },
      meta: vaultSummary,
      phonePill: NO_PILL,
    },
  };
  return assembleSpaces(fields, youtube.visible);
}

function addressLine(
  addresses: HomeSummaryData['addresses'] | undefined,
  loading: string,
  surface: 'desktop' | 'phone',
): string {
  if (addresses === undefined) return loading;
  if (addresses.count === 0) return 'None saved';
  if (addresses.places === 0) return `${addresses.count} saved`;
  if (surface === 'phone') {
    return `${addresses.updatedPlaces} of ${addresses.places} updated`;
  }
  return `${addresses.count} saved · ${addresses.updatedPlaces} of ${addresses.places} places updated`;
}

/** The YouTube tile's fields. An unknown channel count reads as "Connected". */
function youtubeFields(state: YouTubeState): SpaceFields {
  const phonePill = NO_PILL;
  switch (state.status) {
    case 'loading':
      return {
        summary: 'Loading…',
        pill: NO_PILL,
        meta: 'Loading…',
        phonePill,
      };
    case 'disconnected':
      return {
        summary: 'Not connected',
        pill: NO_PILL,
        meta: 'Not connected',
        phonePill,
      };
    case 'error':
      return {
        summary: 'Could not load',
        pill: NO_PILL,
        meta: 'Could not load',
        phonePill,
      };
    case 'loaded': {
      const count = state.videos.length;
      const channels = state.channels;
      return {
        summary:
          channels === null
            ? 'Connected'
            : `${channels} ${pluralize(channels, 'channel', 'channels')}`,
        pill: count > 0 ? neutral(`${count} new`) : NO_PILL,
        meta: `${count} new ${pluralize(count, 'video', 'videos')}`,
        phonePill,
      };
    }
  }
}

/** Space tiles for a Vault that is not open: everything except YouTube is sealed. */
function sealedSpaces(
  prompt: HomeVaultPrompt,
  youtube: YouTubeHome,
): HomeSpace[] {
  const sealed = prompt.sealedSpace;
  const fields: Record<HomeSpaceKey, SpaceFields> = {
    tasks: sealed,
    groceries: sealed,
    subscriptions: sealed,
    addresses: sealed,
    mobile: sealed,
    youtube: youtubeFields(youtube.state),
    vault: prompt.vaultSpace,
  };
  return assembleSpaces(fields, youtube.visible);
}

function phoneTodayTitle(
  summary: HomeSummaryData['tasks'] | undefined,
): string {
  if (summary === undefined) return 'Loading…';
  const total = summary.todayTotal;
  if (total === 0) return 'Nothing due today';
  return `${total} ${pluralize(total, 'task', 'tasks')} due`;
}

function phoneTodayMeta(summary: HomeSummaryData | null): string {
  if (summary === null) return '';
  const parts: string[] = [];
  const { todayTotal, todayDone } = summary.tasks;
  if (todayTotal > 0) parts.push(`${todayDone} of ${todayTotal} done`);
  const renewals = summary.subscriptions.renewingSoon.length;
  if (renewals === 1) parts.push('1 renews this week');
  if (renewals > 1) parts.push(`${renewals} renew this week`);
  return parts.join(' · ');
}

/** Builds the whole Home view from the inputs. */
export function buildHomeView(input: HomeViewInput): HomeView {
  const { now, summary, youtube, backup } = input;
  const vaultPrompt = HOME_VAULT_PROMPTS[input.vault];
  const unlocked = vaultPrompt === null;
  const summaryPending = unlocked && summary === null;
  const firstName = input.firstName ?? 'there';

  let heroLine: string;
  if (vaultPrompt !== null) {
    heroLine = vaultPrompt.heroLine;
  } else if (summary === null) {
    heroLine = 'Loading…';
  } else {
    heroLine = `${tasksHeroPart(summary.tasks.todayTotal)} and ${renewalsHeroPart(summary.subscriptions.renewingSoon.length)}.`;
  }

  const progress =
    unlocked && summary !== null && summary.tasks.todayTotal > 0
      ? {
          done: summary.tasks.todayDone,
          total: summary.tasks.todayTotal,
        }
      : null;

  const spaces =
    vaultPrompt === null
      ? unlockedSpaces(summary, backup, now, youtube)
      : sealedSpaces(vaultPrompt, youtube);

  const dueRows: HomeDueRow[] = [];
  const renewalRows: HomeRenewalRow[] = [];
  if (unlocked && summary !== null) {
    const today = summary.tasks.dueOpen;
    for (const task of today.slice(0, 5)) {
      dueRows.push({
        id: task.id,
        title: task.title,
        pill: task.overdue
          ? { label: 'Overdue', tone: 'danger' }
          : neutral('Today'),
      });
    }
    for (const renewal of summary.subscriptions.renewingSoon.slice(0, 5)) {
      renewalRows.push({
        id: renewal.id,
        name: renewal.name,
        when: `Renews ${formatRenewalDay(renewal.renewsOn)}`,
        amount: formatMoney({
          amount: renewal.amount,
          currency: renewal.currency,
        }),
      });
    }
  }

  const videoRows: HomeVideoRow[] =
    youtube.state.status === 'loaded'
      ? youtube.state.videos.slice(0, 3).map((video) => {
          const when = isParseableTimestamp(video.publishedAt)
            ? relativeTo(video.publishedAt, now)
            : '';
          return {
            videoId: video.videoId,
            title: video.title,
            thumbnail: video.thumbnail,
            href: `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`,
            meta: [video.channelTitle, when]
              .filter((part) => part !== undefined && part !== '')
              .join(' · '),
          };
        })
      : [];

  return {
    unlocked,
    vaultPrompt,
    summaryPending,
    firstName,
    greeting: getGreeting(now),
    dateCaption: formatDateCaption(now),
    heroLine,
    progress,
    todayTitle: unlocked ? phoneTodayTitle(summary?.tasks) : '',
    todayMeta: unlocked ? phoneTodayMeta(summary) : '',
    synced: input.synced,
    spaces,
    dueRows,
    renewalRows,
    youtubeVisible: youtube.visible,
    youtube: youtube.state,
    videoRows,
  };
}
