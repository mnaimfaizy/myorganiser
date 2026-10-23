import type { GroceryCategoryType } from '@myorganiser/vault-core';
import { GROCERY_CATEGORY_ORDER } from '@myorganiser/vault-core';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import {
  GROCERY_CATEGORY_ILLUSTRATION_SIZES,
  GroceryCategoryIllustration,
} from '../GroceryCategoryIllustration';

function renderIllustration(
  props: Parameters<typeof GroceryCategoryIllustration>[0],
) {
  const { container } = render(<GroceryCategoryIllustration {...props} />);
  const svg = container.querySelector('svg');
  expect(svg).not.toBeNull();
  return { container, svg: svg as SVGSVGElement };
}

function markupFor(category: string): string {
  return renderIllustration({ category }).container.innerHTML;
}

/** Tile background fill per category, read from the drawing's first 64 × 64 rect (rx 16). */
const TILE_FILLS: Record<GroceryCategoryType, string> = {
  produce: '#DCFCE7',
  dairy: '#E0F2FE',
  meat: '#FEE2E2',
  seafood: '#CFFAFE',
  bakery: '#FEF3C7',
  frozen: '#E0E7FF',
  beverages: '#CCFBF1',
  snacks: '#FCE7F3',
  condiments: '#FEF9C3',
  household: '#F1F5F9',
  'personal-care': '#F3E8FF',
  other: '#F1F5F9',
};

describe('GroceryCategoryIllustration', () => {
  describe('category selection', () => {
    it.each(GROCERY_CATEGORY_ORDER)(
      'renders a drawing for category %s',
      (category) => {
        const { svg } = renderIllustration({ category });

        expect(svg.childElementCount).toBeGreaterThan(0);
      },
    );

    it('renders a distinct drawing for every category in the vocabulary', () => {
      const markup = GROCERY_CATEGORY_ORDER.map((category) =>
        markupFor(category),
      );

      expect(GROCERY_CATEGORY_ORDER).toHaveLength(12);
      expect(new Set(markup).size).toBe(GROCERY_CATEGORY_ORDER.length);
    });

    it.each(GROCERY_CATEGORY_ORDER)(
      'binds category %s to its own tile background fill',
      (category) => {
        const { svg } = renderIllustration({ category });
        const tile = svg.querySelector('rect');

        expect(tile).toHaveAttribute('width', '64');
        expect(tile).toHaveAttribute('height', '64');
        expect(tile).toHaveAttribute('rx', '16');
        expect(tile).toHaveAttribute('fill', TILE_FILLS[category]);
      },
    );

    it('tells household and other apart by their shadow ellipse, since their tile fills match', () => {
      // household and other share #F1F5F9, so the tile fill cannot separate them.
      // Their bottom shadow ellipses differ (rx 12 vs 17), so a swap of the two drawings fails here.
      const household = renderIllustration({ category: 'household' }).svg;
      const other = renderIllustration({ category: 'other' }).svg;

      expect(household.querySelector('ellipse')).toHaveAttribute('rx', '12');
      expect(other.querySelector('ellipse')).toHaveAttribute('rx', '17');
    });
  });

  describe('fallback to Other', () => {
    it.each(['garden', ''])(
      'renders category %j identically to other',
      (category) => {
        expect(markupFor(category)).toBe(markupFor('other'));
      },
    );

    it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
      'renders prototype key %s identically to other without throwing',
      (category) => {
        expect(() => markupFor(category)).not.toThrow();
        expect(markupFor(category)).toBe(markupFor('other'));
      },
    );

    it('treats a capitalised known key as unknown, so it renders as other', () => {
      // Lookup is exact-match: 'Produce' is not a key, so it does not normalise to 'produce'.
      expect(markupFor('Produce')).toBe(markupFor('other'));
      expect(markupFor('Produce')).not.toBe(markupFor('produce'));
    });
  });

  describe('size', () => {
    it.each(GROCERY_CATEGORY_ILLUSTRATION_SIZES)(
      'sets width and height to %i',
      (size) => {
        const { svg } = renderIllustration({ category: 'produce', size });

        expect(svg).toHaveAttribute('width', String(size));
        expect(svg).toHaveAttribute('height', String(size));
      },
    );

    it('defaults to 32 when size is omitted', () => {
      const { svg } = renderIllustration({ category: 'produce' });

      expect(svg).toHaveAttribute('width', '32');
      expect(svg).toHaveAttribute('height', '32');
    });

    it('uses a fixed 64 by 64 viewBox at every size', () => {
      const { svg } = renderIllustration({ category: 'dairy', size: 20 });

      expect(svg).toHaveAttribute('viewBox', '0 0 64 64');
    });
  });

  describe('decorative accessibility', () => {
    it('hides the svg from assistive technology and removes it from focus order', () => {
      const { svg } = renderIllustration({ category: 'meat' });

      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('focusable', 'false');
    });

    it('renders no title element and exposes no img role', () => {
      const { container } = renderIllustration({ category: 'snacks' });

      expect(container.querySelector('title')).toBeNull();
      expect(screen.queryByRole('img')).toBeNull();
    });
  });

  describe('className', () => {
    it('merges a consumer className with the base classes', () => {
      const { svg } = renderIllustration({
        category: 'bakery',
        className: 'custom-class',
      });

      expect(svg).toHaveClass('block', 'shrink-0', 'custom-class');
    });
  });
});
