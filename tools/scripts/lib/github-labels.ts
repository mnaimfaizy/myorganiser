import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GITHUB_LABELS_CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../config/github-labels.json',
);

// GitHub rejects a longer label description with a bare HTTP 422.
export const GITHUB_LABEL_DESCRIPTION_MAX = 100;

/** One provisioned GitHub label, as the catalog describes it. */
export interface LabelRecord {
  name: string;
  color: string;
  description: string;
}

/** The parsed `tools/config/github-labels.json` catalog. */
export interface GithubLabelCatalog {
  schemaVersion: number;
  orchestration: LabelRecord[];
  review: LabelRecord[];
  triggers: LabelRecord[];
  surface: {
    kind: LabelRecord[];
    area: LabelRecord[];
  };
}

function isLabelRecord(value: unknown): value is LabelRecord {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).name === 'string' &&
    (value as Record<string, unknown>).name !== '' &&
    typeof (value as Record<string, unknown>).color === 'string' &&
    typeof (value as Record<string, unknown>).description === 'string'
  );
}

export function loadGithubLabelCatalog(
  catalogPath: string = GITHUB_LABELS_CATALOG_PATH,
): GithubLabelCatalog {
  const catalog: {
    schemaVersion?: unknown;
    orchestration?: unknown;
    review?: unknown;
    triggers?: unknown;
    surface?: { kind?: unknown; area?: unknown };
  } = JSON.parse(readFileSync(catalogPath, 'utf8'));

  if (catalog?.schemaVersion !== 1) {
    throw new Error(
      `Unsupported github-labels catalog schemaVersion: ${catalog?.schemaVersion}`,
    );
  }

  if (
    !Array.isArray(catalog.orchestration) ||
    !catalog.orchestration.every(isLabelRecord)
  ) {
    throw new Error(
      'github-labels catalog orchestration must be an array of label records.',
    );
  }

  // ADR 0070 item 7: a third set, applied by the Review Tier classifier alone.
  if (!Array.isArray(catalog.review) || !catalog.review.every(isLabelRecord)) {
    throw new Error(
      'github-labels catalog review must be an array of label records.',
    );
  }

  // Request triggers: a human (or ai:create-pr) puts one on a Pull Request
  // to start a workflow, and the workflow takes it off again.
  if (
    !Array.isArray(catalog.triggers) ||
    !catalog.triggers.every(isLabelRecord)
  ) {
    throw new Error(
      'github-labels catalog triggers must be an array of label records.',
    );
  }

  if (
    !Array.isArray(catalog.surface?.kind) ||
    !catalog.surface.kind.every(isLabelRecord) ||
    !Array.isArray(catalog.surface?.area) ||
    !catalog.surface.area.every(isLabelRecord)
  ) {
    throw new Error(
      'github-labels catalog surface.kind and surface.area must be arrays of label records.',
    );
  }

  // Every array above has just been checked against `isLabelRecord`, so this
  // assertion only names the shape runtime validation already proved.
  const validated = catalog as GithubLabelCatalog;

  const overLong = provisionLabels(validated).filter(
    (label) => label.description.length > GITHUB_LABEL_DESCRIPTION_MAX,
  );
  if (overLong.length > 0) {
    throw new Error(
      `github-labels catalog descriptions must be at most ${GITHUB_LABEL_DESCRIPTION_MAX} characters, which GitHub enforces: ${overLong.map((l) => `${l.name} (${l.description.length})`).join(', ')}`,
    );
  }

  return validated;
}

export function surfaceLabelNames(catalog: GithubLabelCatalog): Set<string> {
  return new Set([
    ...catalog.surface.kind.map((label) => label.name),
    ...catalog.surface.area.map((label) => label.name),
  ]);
}

export function reviewTierLabelNames(catalog: GithubLabelCatalog): Set<string> {
  return new Set(catalog.review.map((label) => label.name));
}

export function triggerLabelNames(catalog: GithubLabelCatalog): Set<string> {
  return new Set(catalog.triggers.map((label) => label.name));
}

export function provisionLabels(catalog: GithubLabelCatalog): LabelRecord[] {
  return [
    ...catalog.orchestration,
    ...catalog.review,
    ...catalog.triggers,
    ...catalog.surface.kind,
    ...catalog.surface.area,
  ];
}

export function normalizeLabelArgs(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const value of values) {
    for (const part of String(value).split(',')) {
      const name = part.trim();

      if (!name || seen.has(name)) {
        continue;
      }

      seen.add(name);
      labels.push(name);
    }
  }

  return labels;
}

export function rejectedPrLabels(
  labels: readonly string[],
  catalog: GithubLabelCatalog,
): string[] {
  // A Pull Request may be opened with a trigger label already on it: that is
  // "open it and review it", which is a request, not a classification.
  const allowed = new Set([
    ...surfaceLabelNames(catalog),
    ...triggerLabelNames(catalog),
  ]);
  return labels.filter((name) => !allowed.has(name));
}

export interface SyncSurfaceLabelChanges {
  toAdd: string[];
  toRemove: string[];
}

export function syncSurfaceLabelChanges({
  currentNames,
  desiredNames,
  surfaceNames,
}: {
  currentNames: readonly string[];
  desiredNames: readonly string[];
  surfaceNames: ReadonlySet<string>;
}): SyncSurfaceLabelChanges {
  const current = new Set(currentNames);
  const desired = [...new Set(desiredNames)];

  return {
    toAdd: desired.filter((name) => !current.has(name)),
    toRemove: [...current].filter(
      (name) => surfaceNames.has(name) && !desired.includes(name),
    ),
  };
}
