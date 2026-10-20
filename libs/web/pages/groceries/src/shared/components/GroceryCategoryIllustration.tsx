import { cn } from '@myorganiser/web-ui';
import type { GroceryCategoryType } from '@myorganiser/vault-core';
import type { ReactElement } from 'react';

/** The sizes the Web v2.0 design uses: chips 20, section headers 24, picker and rows 32, drawing 64. */
export const GROCERY_CATEGORY_ILLUSTRATION_SIZES = [20, 24, 32, 64] as const;

export type GroceryCategoryIllustrationSize =
  (typeof GROCERY_CATEGORY_ILLUSTRATION_SIZES)[number];

export interface GroceryCategoryIllustrationProps {
  /** A category as it arrives from decrypted data: anything not in the vocabulary renders Other. */
  category: string;
  size?: GroceryCategoryIllustrationSize; // default 32
  className?: string;
}

/**
 * Category drawings, one per member of the grocery category vocabulary.
 *
 * Adding a category: add it to GROCERY_CATEGORY_ORDER, draw one 64 × 64
 * illustration on its own tinted tile, and register it here. Unknown
 * categories show Other.
 *
 * The `satisfies` clause is what makes a missing drawing a compile error: a
 * category added to the vocabulary without an entry here fails to type-check
 * rather than rendering an empty square.
 *
 * Each entry is the children of the 64 × 64 viewBox; the wrapper `<svg>` is
 * added once, in the component. The hex fills are artwork, not UI colour
 * roles, so they stay as literals (see AppLogo in web-ui).
 */
const CATEGORY_DRAWINGS = {
  produce: (
    <>
      <rect width={64} height={64} rx={16} fill="#DCFCE7" />
      <ellipse cx={32} cy={56} rx={13} ry={2.5} fill="#0F172A" opacity={0.12} />
      <rect x={28} y={33} width={8} height={21} rx={3} fill="#15803D" />
      <circle cx={22} cy={29} r={9} fill="#22C55E" />
      <circle cx={42} cy={29} r={9} fill="#22C55E" />
      <circle cx={32} cy={22} r={11} fill="#16A34A" />
      <circle cx={32} cy={33} r={7} fill="#16A34A" />
      <circle cx={28} cy={18} r={3.5} fill="#86EFAC" />
    </>
  ),
  dairy: (
    <>
      <rect width={64} height={64} rx={16} fill="#E0F2FE" />
      <ellipse cx={32} cy={56} rx={13} ry={2.5} fill="#0F172A" opacity={0.12} />
      <rect x={20} y={24} width={24} height={30} rx={3} fill="#FFFFFF" />
      <rect x={36} y={24} width={8} height={30} fill="#BAE6FD" />
      <path d="M20 24 L26 14 H38 L44 24 Z" fill="#0EA5E9" />
      <rect x={29} y={9} width={6} height={6} rx={1.5} fill="#0369A1" />
      <rect x={23} y={33} width={11} height={11} rx={2} fill="#0EA5E9" />
      <circle cx={28.5} cy={38.5} r={2.5} fill="#FFFFFF" />
    </>
  ),
  meat: (
    <>
      <rect width={64} height={64} rx={16} fill="#FEE2E2" />
      <ellipse cx={32} cy={55} rx={15} ry={2.5} fill="#0F172A" opacity={0.12} />
      <ellipse cx={31} cy={34} rx={19} ry={15} fill="#FCA5A5" />
      <ellipse cx={31} cy={34} rx={15.5} ry={11.5} fill="#DC2626" />
      <path d="M20 30 Q27 27 32 32 Q36 36 42 33" fill="#F87171" opacity={0.9} />
      <circle cx={40} cy={31} r={4.5} fill="#FFF1F2" />
      <circle cx={40} cy={31} r={2} fill="#FECACA" />
    </>
  ),
  seafood: (
    <>
      <rect width={64} height={64} rx={16} fill="#CFFAFE" />
      <ellipse cx={32} cy={52} rx={14} ry={2.5} fill="#0F172A" opacity={0.12} />
      <path d="M41 32 L55 22 V42 Z" fill="#0891B2" />
      <path d="M28 23 L33 15 L38 25 Z" fill="#0891B2" />
      <ellipse cx={29} cy={32} rx={16} ry={10} fill="#06B6D4" />
      <ellipse cx={29} cy={36} rx={11} ry={4} fill="#67E8F9" opacity={0.7} />
      <circle cx={20} cy={30} r={2.6} fill="#0F172A" />
      <circle cx={19.2} cy={29.2} r={0.9} fill="#FFFFFF" />
    </>
  ),
  bakery: (
    <>
      <rect width={64} height={64} rx={16} fill="#FEF3C7" />
      <ellipse cx={32} cy={52} rx={18} ry={2.5} fill="#0F172A" opacity={0.12} />
      <path
        d="M11 38 C11 25 20 19 32 19 C44 19 53 25 53 38 V44 Q53 49 48 49 H16 Q11 49 11 44 Z"
        fill="#D97706"
      />
      <path
        d="M15 34 C16 26 23 22 32 22 C38 22 43 24 46 27 C40 25 24 25 15 34 Z"
        fill="#F59E0B"
      />
      <rect
        x={21}
        y={26}
        width={4}
        height={11}
        rx={2}
        fill="#FCD34D"
        transform="rotate(25 23 31.5)"
      />
      <rect
        x={30}
        y={25}
        width={4}
        height={12}
        rx={2}
        fill="#FCD34D"
        transform="rotate(25 32 31)"
      />
      <rect
        x={39}
        y={26}
        width={4}
        height={11}
        rx={2}
        fill="#FCD34D"
        transform="rotate(25 41 31.5)"
      />
    </>
  ),
  frozen: (
    <>
      <rect width={64} height={64} rx={16} fill="#E0E7FF" />
      <ellipse cx={32} cy={54} rx={15} ry={2.5} fill="#0F172A" opacity={0.12} />
      <rect x={15} y={17} width={34} height={34} rx={9} fill="#818CF8" />
      <rect
        x={15}
        y={17}
        width={34}
        height={34}
        rx={9}
        fill="#A5B4FC"
        transform="translate(-2 -2)"
      />
      <rect x={18} y={19} width={13} height={6} rx={3} fill="#E0E7FF" />
      <rect x={30.7} y={25} width={2.6} height={20} rx={1.3} fill="#FFFFFF" />
      <rect
        x={30.7}
        y={25}
        width={2.6}
        height={20}
        rx={1.3}
        fill="#FFFFFF"
        transform="rotate(60 32 35)"
      />
      <rect
        x={30.7}
        y={25}
        width={2.6}
        height={20}
        rx={1.3}
        fill="#FFFFFF"
        transform="rotate(-60 32 35)"
      />
    </>
  ),
  beverages: (
    <>
      <rect width={64} height={64} rx={16} fill="#CCFBF1" />
      <ellipse cx={32} cy={56} rx={12} ry={2.5} fill="#0F172A" opacity={0.12} />
      <rect x={28} y={11} width={8} height={10} rx={2} fill="#0F766E" />
      <rect x={27} y={8} width={10} height={5} rx={2} fill="#134E4A" />
      <rect x={22} y={19} width={20} height={35} rx={7} fill="#14B8A6" />
      <rect x={22} y={31} width={20} height={12} fill="#FFFFFF" />
      <rect x={26} y={35} width={12} height={4} rx={2} fill="#0F766E" />
      <rect x={25} y={22} width={3} height={8} rx={1.5} fill="#5EEAD4" />
    </>
  ),
  snacks: (
    <>
      <rect width={64} height={64} rx={16} fill="#FCE7F3" />
      <ellipse cx={32} cy={56} rx={14} ry={2.5} fill="#0F172A" opacity={0.12} />
      <path d="M18 15 H46 L44 51 H20 Z" fill="#DB2777" />
      <rect x={16} y={11} width={32} height={6} rx={2} fill="#9D174D" />
      <rect x={18} y={49} width={28} height={5} rx={2} fill="#9D174D" />
      <circle cx={32} cy={33} r={8.5} fill="#FBCFE8" />
      <ellipse
        cx={32}
        cy={33}
        rx={5.5}
        ry={4}
        fill="#F59E0B"
        transform="rotate(-20 32 33)"
      />
      <path d="M21 18 H26 L24 46 H22 Z" fill="#F472B6" opacity={0.6} />
    </>
  ),
  condiments: (
    <>
      <rect width={64} height={64} rx={16} fill="#FEF9C3" />
      <ellipse cx={32} cy={56} rx={11} ry={2.5} fill="#0F172A" opacity={0.12} />
      <rect x={30} y={7} width={4} height={10} rx={1.5} fill="#DC2626" />
      <path d="M26 16 H38 L41 24 H23 Z" fill="#DC2626" />
      <path
        d="M22 24 H42 L40 52 Q40 55 37 55 H27 Q24 55 24 52 Z"
        fill="#CA8A04"
      />
      <path d="M38 24 H42 L40 52 Q40 55 37 55 H35 Z" fill="#A16207" />
      <rect x={26} y={33} width={12} height={10} rx={2} fill="#FEF08A" />
      <rect x={25} y={26} width={3} height={6} rx={1.5} fill="#FDE047" />
    </>
  ),
  household: (
    <>
      <rect width={64} height={64} rx={16} fill="#F1F5F9" />
      <ellipse cx={32} cy={56} rx={12} ry={2.5} fill="#0F172A" opacity={0.12} />
      <rect x={22} y={28} width={20} height={27} rx={5} fill="#64748B" />
      <rect x={27} y={21} width={10} height={8} fill="#475569" />
      <path d="M21 12 H40 Q42 12 42 14 V21 H21 Z" fill="#334155" />
      <rect x={13} y={14} width={9} height={4} rx={1} fill="#334155" />
      <rect x={23} y={21} width={4} height={9} rx={2} fill="#1D283A" />
      <rect x={25} y={36} width={14} height={10} rx={2} fill="#CBD5E1" />
      <circle cx={10} cy={13} r={1.5} fill="#94A3B8" />
      <circle cx={9} cy={18} r={1.2} fill="#94A3B8" />
    </>
  ),
  'personal-care': (
    <>
      <rect width={64} height={64} rx={16} fill="#F3E8FF" />
      <ellipse cx={32} cy={56} rx={12} ry={2.5} fill="#0F172A" opacity={0.12} />
      <rect x={22} y={26} width={20} height={29} rx={6} fill="#A855F7" />
      <rect x={27} y={20} width={10} height={7} rx={1.5} fill="#7E22CE" />
      <rect x={30} y={12} width={4} height={9} fill="#7E22CE" />
      <rect x={25} y={9} width={16} height={4} rx={2} fill="#6B21A8" />
      <rect x={25} y={34} width={14} height={10} rx={2} fill="#F3E8FF" />
      <rect x={25} y={29} width={3} height={4} rx={1.5} fill="#D8B4FE" />
      <circle cx={48} cy={20} r={3.5} fill="#E9D5FF" />
      <circle cx={51} cy={28} r={2.2} fill="#E9D5FF" />
    </>
  ),
  other: (
    <>
      <rect width={64} height={64} rx={16} fill="#F1F5F9" />
      <ellipse cx={32} cy={55} rx={17} ry={2.5} fill="#0F172A" opacity={0.12} />
      <rect x={14} y={24} width={36} height={28} rx={4} fill="#94A3B8" />
      <rect x={12} y={18} width={40} height={9} rx={3} fill="#64748B" />
      <rect x={29} y={18} width={6} height={34} fill="#E2E8F0" />
      <rect x={18} y={34} width={8} height={3} rx={1.5} fill="#CBD5E1" />
    </>
  ),
} as const satisfies Record<GroceryCategoryType, ReactElement>;

/**
 * Resolves a category to its drawing. Own-property check, not `in`, so
 * `'toString'` or `'__proto__'` fall back to Other like any unknown string.
 */
function drawingFor(category: string): ReactElement {
  return Object.prototype.hasOwnProperty.call(CATEGORY_DRAWINGS, category)
    ? CATEGORY_DRAWINGS[category as GroceryCategoryType]
    : CATEGORY_DRAWINGS.other;
}

/**
 * A grocery category's drawing on its tinted tile. Decorative: the category
 * label beside it carries the meaning, so the SVG is hidden from assistive
 * technology.
 */
export function GroceryCategoryIllustration({
  category,
  size = 32,
  className,
}: GroceryCategoryIllustrationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={cn('block shrink-0', className)}
    >
      {drawingFor(category)}
    </svg>
  );
}
