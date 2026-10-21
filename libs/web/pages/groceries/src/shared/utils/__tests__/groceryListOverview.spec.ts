import type {
  CatalogItem,
  GroceryList,
  ListLine,
} from '@myorganiser/vault-core';
import {
  countListsPerCatalogItem,
  formatListActivity,
  formatRelativeTime,
  groupLinesByCategory,
  lastListActivity,
  pluralize,
  summarizeListProgress,
  toKnownCategory,
} from '../groceryListOverview';

const CREATED = '2026-01-01T00:00:00.000Z';
const NOW = new Date('2026-10-21T12:00:00.000Z');

const isoAgo = (ms: number): string =>
  new Date(NOW.getTime() - ms).toISOString();

const item = (id: string, category = 'other'): CatalogItem =>
  ({
    id,
    name: id,
    category,
    createdAt: CREATED,
    updatedAt: CREATED,
  }) as CatalogItem;

const line = (
  id: string,
  catalogItemId: string,
  options: { checked?: boolean; updatedAt?: string } = {},
): ListLine => ({
  id,
  catalogItemId,
  checked: options.checked ?? false,
  createdAt: CREATED,
  updatedAt: options.updatedAt ?? CREATED,
});

const list = (
  lines: ListLine[],
  options: { updatedAt?: string } = {},
): GroceryList => ({
  id: 'list-1',
  name: 'Weekly',
  lines,
  createdAt: CREATED,
  updatedAt: options.updatedAt ?? CREATED,
});

describe('summarizeListProgress', () => {
  it('reports an empty list as zero total and not all bought', () => {
    expect(summarizeListProgress([])).toEqual({
      total: 0,
      checked: 0,
      left: 0,
      allBought: false,
    });
  });

  it('counts checked and remaining lines for a partly bought list', () => {
    expect(
      summarizeListProgress([
        line('l1', 'a', { checked: true }),
        line('l2', 'b'),
        line('l3', 'c', { checked: true }),
      ]),
    ).toEqual({ total: 3, checked: 2, left: 1, allBought: false });
  });

  it('marks the list all bought once every line is checked', () => {
    expect(
      summarizeListProgress([
        line('l1', 'a', { checked: true }),
        line('l2', 'b', { checked: true }),
      ]),
    ).toEqual({ total: 2, checked: 2, left: 0, allBought: true });
  });
});

describe('toKnownCategory', () => {
  it('returns a category that is in the shop-walk vocabulary', () => {
    expect(toKnownCategory('dairy')).toBe('dairy');
  });

  it('folds an unknown category string into other', () => {
    expect(toKnownCategory('not-a-category')).toBe('other');
  });

  it('folds a missing category into other', () => {
    expect(toKnownCategory(undefined)).toBe('other');
  });
});

describe('groupLinesByCategory', () => {
  it('orders groups by the shop walk, not by input order', () => {
    const catalog = [
      item('bread', 'bakery'),
      item('apple', 'produce'),
      item('milk', 'dairy'),
    ];
    const groups = groupLinesByCategory(
      [line('l1', 'bread'), line('l2', 'apple'), line('l3', 'milk')],
      catalog,
    );

    expect(groups.map((group) => group.category)).toEqual([
      'produce',
      'dairy',
      'bakery',
    ]);
  });

  it('files a line with an unknown category or a missing catalog item under other', () => {
    const catalog = [item('widget', 'mystery')];
    const groups = groupLinesByCategory(
      [line('l1', 'widget'), line('l2', 'ghost')],
      catalog,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('other');
    expect(groups[0].lines).toEqual([
      { line: line('l1', 'widget'), item: catalog[0] },
      { line: line('l2', 'ghost'), item: undefined },
    ]);
  });

  it('omits empty categories and keeps input order inside a group', () => {
    const catalog = [
      item('carrot', 'produce'),
      item('onion', 'produce'),
      item('cheese', 'dairy'),
    ];
    const groups = groupLinesByCategory(
      [line('l1', 'onion'), line('l2', 'cheese'), line('l3', 'carrot')],
      catalog,
    );

    expect(groups.map((group) => group.category)).toEqual(['produce', 'dairy']);
    expect(groups[0].lines.map((resolved) => resolved.line.id)).toEqual([
      'l1',
      'l3',
    ]);
  });
});

describe('countListsPerCatalogItem', () => {
  it('counts each Grocery List that carries the item', () => {
    const counts = countListsPerCatalogItem([
      list([line('l1', 'milk')]),
      list([line('l2', 'milk'), line('l3', 'eggs')]),
    ]);

    expect(counts.get('milk')).toBe(2);
    expect(counts.get('eggs')).toBe(1);
  });

  it('counts a repeated line for one item on one list once, and leaves unlisted items absent', () => {
    const counts = countListsPerCatalogItem([
      list([line('l1', 'milk'), line('l2', 'milk')]),
    ]);

    expect(counts.get('milk')).toBe(1);
    expect(counts.has('bread')).toBe(false);
  });
});

describe('pluralize', () => {
  it('uses the singular only for exactly one', () => {
    expect(pluralize(1, 'list')).toBe('1 list');
    expect(pluralize(2, 'list')).toBe('2 lists');
    expect(pluralize(0, 'list')).toBe('0 lists');
  });

  it('uses an explicit plural when adding s would be wrong', () => {
    expect(pluralize(3, 'child', 'children')).toBe('3 children');
  });
});

describe('formatRelativeTime', () => {
  it('reads anything under a minute as just now', () => {
    expect(formatRelativeTime(isoAgo(59 * 1000), NOW)).toBe('just now');
  });

  it('reads minutes, hours, and days in the relative form', () => {
    expect(formatRelativeTime(isoAgo(5 * 60 * 1000), NOW)).toBe(
      '5 minutes ago',
    );
    expect(formatRelativeTime(isoAgo(2 * 60 * 60 * 1000), NOW)).toBe(
      '2 hours ago',
    );
    expect(formatRelativeTime(isoAgo(24 * 60 * 60 * 1000), NOW)).toBe(
      'yesterday',
    );
    expect(formatRelativeTime(isoAgo(3 * 24 * 60 * 60 * 1000), NOW)).toBe(
      '3 days ago',
    );
  });

  it('falls back to just now for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('just now');
  });
});

describe('lastListActivity', () => {
  it('returns a List Line updatedAt when it is newer than the list', () => {
    const newer = '2026-03-01T00:00:00.000Z';
    expect(
      lastListActivity(
        list([line('l1', 'milk', { updatedAt: newer })], {
          updatedAt: '2026-02-01T00:00:00.000Z',
        }),
      ),
    ).toBe(newer);
  });

  it('returns the list updatedAt when no line is newer', () => {
    const listUpdated = '2026-02-01T00:00:00.000Z';
    expect(
      lastListActivity(
        list([line('l1', 'milk', { updatedAt: '2026-01-15T00:00:00.000Z' })], {
          updatedAt: listUpdated,
        }),
      ),
    ).toBe(listUpdated);
  });
});

describe('formatListActivity', () => {
  it('says Created for a list never changed since it was made', () => {
    expect(formatListActivity(list([]), NOW)).toBe(
      `Created ${formatRelativeTime(CREATED, NOW)}`,
    );
  });

  it('says Updated when the list record itself changed', () => {
    const changed = isoAgo(2 * 60 * 60 * 1000);
    expect(formatListActivity(list([], { updatedAt: changed }), NOW)).toBe(
      'Updated 2 hours ago',
    );
  });

  it('says Updated when only a List Line changed after creation', () => {
    const lineChanged = isoAgo(5 * 60 * 1000);
    expect(
      formatListActivity(
        list([line('l1', 'milk', { updatedAt: lineChanged })]),
        NOW,
      ),
    ).toBe('Updated 5 minutes ago');
  });
});
