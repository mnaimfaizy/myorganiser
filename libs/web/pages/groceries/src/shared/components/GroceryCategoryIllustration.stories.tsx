import type { Meta, StoryObj } from '@storybook/react';
import {
  GROCERY_CATEGORY_LABELS,
  GROCERY_CATEGORY_ORDER,
  type GroceryCategoryType,
} from '@myorganiser/vault-core';
import {
  GROCERY_CATEGORY_ILLUSTRATION_SIZES,
  GroceryCategoryIllustration,
  type GroceryCategoryIllustrationSize,
} from './GroceryCategoryIllustration';

/** What each size is for, from the design sheet. */
const SIZE_CAPTIONS: Record<GroceryCategoryIllustrationSize, string> = {
  20: 'chips',
  24: 'section headers',
  32: 'picker, rows',
  64: 'drawing',
};

const meta: Meta<typeof GroceryCategoryIllustration> = {
  component: GroceryCategoryIllustration,
  title: 'Components/GroceryCategoryIllustration',
  tags: ['autodocs'],
  args: { category: 'produce', size: 32 },
  argTypes: {
    category: {
      control: 'select',
      options: [...GROCERY_CATEGORY_ORDER],
      description:
        'A category as it arrives from decrypted data: anything not in the vocabulary renders Other.',
    },
    size: {
      control: 'select',
      options: [...GROCERY_CATEGORY_ILLUSTRATION_SIZES],
      description:
        'The sizes the Web v2.0 design uses: chips 20, section headers 24, picker and rows 32, drawing 64.',
    },
  },
  parameters: {
    docs: {
      description: {
        component: [
          'Category drawings, one per member of the grocery category vocabulary.',
          'Adding a category: add it to GROCERY_CATEGORY_ORDER, draw one 64 × 64 illustration on its own tinted tile, and register it here. Unknown categories show Other.',
          '("here" is the `CATEGORY_DRAWINGS` table in `GroceryCategoryIllustration.tsx`; the `satisfies` clause there makes a missing drawing a compile error.)',
        ].join('\n\n'),
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof GroceryCategoryIllustration>;

/** A drawing with its visible category label beside it. The drawing is decorative. */
function Labelled({
  category,
  size = 32,
}: {
  category: GroceryCategoryType;
  size?: GroceryCategoryIllustrationSize;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-foreground">
      <GroceryCategoryIllustration category={category} size={size} />
      <span>{GROCERY_CATEGORY_LABELS[category]}</span>
    </div>
  );
}

export const Default: Story = {
  render: (args) => (
    <Labelled
      category={args.category as GroceryCategoryType}
      size={args.size}
    />
  ),
};

export const AllCategories: Story = {
  render: () => (
    <ul
      aria-label="Grocery categories in shop-walk order"
      className="grid grid-cols-3 gap-4 sm:grid-cols-4"
    >
      {GROCERY_CATEGORY_ORDER.map((category) => (
        <li key={category}>
          <figure className="flex flex-col items-center gap-2 rounded-lg bg-card p-3 text-center shadow-card">
            <GroceryCategoryIllustration category={category} size={64} />
            <figcaption className="text-sm text-foreground">
              {GROCERY_CATEGORY_LABELS[category]}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-foreground">
        {GROCERY_CATEGORY_LABELS.dairy}
      </p>
      <div className="flex flex-wrap items-end gap-6">
        {GROCERY_CATEGORY_ILLUSTRATION_SIZES.map((size) => (
          <figure
            key={size}
            className="flex flex-col items-center gap-2 text-xs text-muted-foreground"
          >
            <GroceryCategoryIllustration category="dairy" size={size} />
            <figcaption>{`${size} · ${SIZE_CAPTIONS[size]}`}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  ),
};

export const CategoryBySizeMatrix: Story = {
  render: () => (
    <table className="border-separate border-spacing-3 text-sm text-foreground">
      <caption className="mb-2 text-left font-medium">
        Every category at every size
      </caption>
      <thead>
        <tr>
          <th
            scope="col"
            className="text-left font-normal text-muted-foreground"
          >
            Category
          </th>
          {GROCERY_CATEGORY_ILLUSTRATION_SIZES.map((size) => (
            <th
              key={size}
              scope="col"
              className="text-center font-normal text-muted-foreground"
            >
              {size}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {GROCERY_CATEGORY_ORDER.map((category) => (
          <tr key={category}>
            <th scope="row" className="text-left font-normal">
              {GROCERY_CATEGORY_LABELS[category]}
            </th>
            {GROCERY_CATEGORY_ILLUSTRATION_SIZES.map((size) => (
              <td key={size} className="text-center">
                <GroceryCategoryIllustration category={category} size={size} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
};

/**
 * Two categories that are not in the vocabulary, each drawn next to the Other
 * drawing. The captions are fixed text, not a label lookup:
 * `GROCERY_CATEGORY_LABELS` is a plain object, so a prototype key such as
 * `'toString'` reads `Object.prototype.toString` rather than `undefined`, and
 * the `?? 'Other'` fallback in `groceryCategoryLabel` never runs for it. The
 * drawing itself uses an own-property check and is unaffected.
 */
export const UnknownCategoryFallsBackToOther: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-6">
      <figure className="flex flex-col items-center gap-2 text-center text-sm text-foreground">
        <GroceryCategoryIllustration category="other" size={64} />
        <figcaption>{GROCERY_CATEGORY_LABELS.other} (the fallback)</figcaption>
      </figure>
      <figure className="flex flex-col items-center gap-2 text-center text-sm text-foreground">
        <GroceryCategoryIllustration category="garden" size={64} />
        <figcaption>
          <code>garden</code> is not in the vocabulary, so it is drawn as Other
        </figcaption>
      </figure>
      <figure className="flex flex-col items-center gap-2 text-center text-sm text-foreground">
        <GroceryCategoryIllustration category="toString" size={64} />
        <figcaption>
          <code>toString</code> is a prototype key, not a category, so it is
          drawn as Other
        </figcaption>
      </figure>
    </div>
  ),
};

/** A category shown in two compositions: a chip at 20 and a list row at 32. */
export const InContext: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(['produce', 'dairy', 'bakery'] as const).map((category) => (
          <span
            key={category}
            className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-accent-foreground"
          >
            <GroceryCategoryIllustration category={category} size={20} />
            {GROCERY_CATEGORY_LABELS[category]}
          </span>
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {(['meat', 'household'] as const).map((category) => (
          <li
            key={category}
            className="flex items-center gap-3 rounded-lg bg-card px-3 py-2 text-sm text-foreground shadow-card"
          >
            <GroceryCategoryIllustration category={category} size={32} />
            {GROCERY_CATEGORY_LABELS[category]}
          </li>
        ))}
      </ul>
    </div>
  ),
};
