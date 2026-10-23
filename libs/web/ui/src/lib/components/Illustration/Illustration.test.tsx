import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createRef } from 'react';
import {
  Illustration,
  ILLUSTRATION_KINDS,
  ILLUSTRATION_SIZES,
  type IllustrationKind,
  type IllustrationSize,
} from './Illustration';

function renderSvg(kind: IllustrationKind, size?: IllustrationSize) {
  // An undefined size falls through to the component's default of 64.
  const { container } = render(<Illustration kind={kind} size={size} />);
  const svg = container.querySelector('svg');
  if (!svg) {
    throw new Error(`Illustration ${kind} rendered no svg`);
  }
  return svg;
}

// Tile background fill of each kind's drawing: the first rect of its artboard
// in Illustration.tsx, matching the `sc-if` artboard of the same kind in
// docs/design/web-v2/artboards/Illustration.dc.html.
const TILE_FILLS: Record<IllustrationKind, string> = {
  home: '#EDE9FE',
  tasks: '#CCFBF1',
  groceries: '#DCFCE7',
  subscriptions: '#E0E7FF',
  addresses: '#FFE4E6',
  mobile: '#CFFAFE',
  youtube: '#FFEDD5',
  vault: '#1E1B4B',
  feedback: '#F5F3FF',
  admin: '#E2E8F0',
  users: '#E2E8F0',
  audit: '#E2E8F0',
  inbox: '#E2E8F0',
  more: '#F1F5F9',
};

// The four kinds that share the #E2E8F0 tile fill are told apart by the centre
// of their first circle, verified against Illustration.tsx and the design doc.
const SHARED_FILL_CIRCLE_CENTRES: Record<
  'admin' | 'users' | 'audit' | 'inbox',
  { cx: string; cy: string }
> = {
  admin: { cx: '98', cy: '22' },
  users: { cx: '22', cy: '22' },
  audit: { cx: '98', cy: '98' },
  inbox: { cx: '24', cy: '98' },
};

describe('Illustration', () => {
  describe('kind registry', () => {
    it('lists exactly the 14 Web v2.0 kinds in registry order', () => {
      expect(ILLUSTRATION_KINDS).toEqual([
        'home',
        'tasks',
        'groceries',
        'subscriptions',
        'addresses',
        'mobile',
        'youtube',
        'vault',
        'feedback',
        'admin',
        'users',
        'audit',
        'inbox',
        'more',
      ]);
    });
  });

  describe('kind selection', () => {
    it.each(ILLUSTRATION_KINDS)('renders a drawing for kind %s', (kind) => {
      const svg = renderSvg(kind);

      expect(svg.children.length).toBeGreaterThan(0);
    });

    it.each(ILLUSTRATION_KINDS)(
      'binds kind %s to its own tile background fill',
      (kind) => {
        const svg = renderSvg(kind);

        expect(svg.querySelector('rect')).toHaveAttribute(
          'fill',
          TILE_FILLS[kind],
        );
      },
    );

    it.each(Object.entries(SHARED_FILL_CIRCLE_CENTRES))(
      'binds kind %s to its own first-circle centre',
      (kind, centre) => {
        const svg = renderSvg(kind as IllustrationKind);

        expect(svg.querySelector('circle')).toHaveAttribute('cx', centre.cx);
        expect(svg.querySelector('circle')).toHaveAttribute('cy', centre.cy);
      },
    );

    it('renders a distinct drawing for every kind', () => {
      const markup = ILLUSTRATION_KINDS.map(
        (kind) => renderSvg(kind).innerHTML,
      );

      expect(new Set(markup).size).toBe(ILLUSTRATION_KINDS.length);
    });

    it('swaps the drawing when the kind prop changes', () => {
      const { container, rerender } = render(<Illustration kind="home" />);
      const before = container.querySelector('svg')?.innerHTML;

      rerender(<Illustration kind="vault" />);
      const after = container.querySelector('svg')?.innerHTML;

      expect(before).toBeDefined();
      expect(after).not.toBe(before);
    });
  });

  describe('size', () => {
    it.each(ILLUSTRATION_SIZES)(
      'sets width and height to %i with the 120 x 120 artboard viewBox',
      (size) => {
        const svg = renderSvg('tasks', size);

        expect(svg).toHaveAttribute('width', String(size));
        expect(svg).toHaveAttribute('height', String(size));
        expect(svg).toHaveAttribute('viewBox', '0 0 120 120');
      },
    );

    it('defaults to 64 pixels when size is omitted', () => {
      const svg = renderSvg('groceries');

      expect(svg).toHaveAttribute('width', '64');
      expect(svg).toHaveAttribute('height', '64');
    });
  });

  describe('decorative accessibility', () => {
    it('hides the svg from assistive technology and blocks focus', () => {
      const svg = renderSvg('inbox');

      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('focusable', 'false');
    });

    it('has no title and exposes no img role, even including hidden elements', () => {
      const { container } = render(<Illustration kind="audit" />);

      expect(container.querySelector('title')).toBeNull();
      expect(screen.queryByRole('img', { hidden: true })).toBeNull();
    });
  });

  describe('props', () => {
    it('merges a custom className alongside the base classes', () => {
      const { container } = render(
        <Illustration kind="more" className="custom-illustration" />,
      );
      const svg = container.querySelector('svg');

      expect(svg).toHaveClass('custom-illustration', 'block', 'shrink-0');
    });

    it('forwards the ref to the underlying SVGSVGElement', () => {
      const ref = createRef<SVGSVGElement>();

      render(<Illustration kind="users" ref={ref} />);

      expect(ref.current).toBeInstanceOf(SVGSVGElement);
      expect(ref.current).toHaveAttribute('viewBox', '0 0 120 120');
    });
  });
});
