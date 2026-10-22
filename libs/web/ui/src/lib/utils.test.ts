import * as path from 'path';
import {
  cn,
  initialsOf,
  RADIUS_STEPS,
  SHADOW_STEPS,
  SPACING_STEPS,
  TYPE_SCALE_STEPS,
} from './utils';

describe('cn', () => {
  it('keeps a colour class and a type-scale class together', () => {
    // text-body is registered as a font size, so it is not a colour conflict.
    expect(cn('text-foreground', 'text-body')).toBe(
      'text-foreground text-body',
    );
  });

  it('keeps only the later type-scale class when two font sizes conflict', () => {
    expect(cn('text-body', 'text-field')).toBe('text-field');
  });

  it('lets a Type Scale step override a Tailwind default font size', () => {
    expect(cn('text-sm', 'text-caption')).toBe('text-caption');
  });

  it('lets a later off-scale radius override an earlier one', () => {
    expect(cn('rounded-control', 'rounded-fab')).toBe('rounded-fab');
  });

  it('lets a later named shadow override an earlier Tailwind shadow', () => {
    expect(cn('shadow-sm', 'shadow-dialog')).toBe('shadow-dialog');
  });

  it('lets a later named size override an earlier one in the same arbitrary-variant group', () => {
    expect(cn('[&_svg]:size-icon', '[&_svg]:size-icon-fab')).toBe(
      '[&_svg]:size-icon-fab',
    );
  });

  it('lets a numeric padding override a named control padding, as the Button link variant relies on', () => {
    expect(cn('px-control-x', 'px-1')).toBe('px-1');
  });
});

describe('shared theme sync', () => {
  const themePath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'design-tokens',
    'tailwind-theme.cjs',
  );
  const theme = require(themePath) as {
    fontSize: Record<string, unknown>;
    borderRadius: Record<string, unknown>;
    boxShadow: Record<string, unknown>;
    spacing: Record<string, unknown>;
  };

  it('matches the fontSize keys of the shared Tailwind theme', () => {
    expect([...TYPE_SCALE_STEPS]).toEqual(Object.keys(theme.fontSize));
  });

  it('matches the borderRadius keys of the shared Tailwind theme', () => {
    expect([...RADIUS_STEPS]).toEqual(Object.keys(theme.borderRadius));
  });

  it('matches the boxShadow keys of the shared Tailwind theme', () => {
    expect([...SHADOW_STEPS]).toEqual(Object.keys(theme.boxShadow));
  });

  it('matches the spacing keys of the shared Tailwind theme', () => {
    expect([...SPACING_STEPS]).toEqual(Object.keys(theme.spacing));
  });
});

describe('initialsOf', () => {
  it('returns two upper-case initials for a two-word name', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
  });

  it('keeps only the first two initials of a longer name', () => {
    expect(initialsOf('Mary Anne Jane Smith')).toBe('MA');
  });

  it('returns one letter for a single-word name', () => {
    expect(initialsOf('Cher')).toBe('C');
  });

  it('upper-cases lower-case input', () => {
    expect(initialsOf('ada lovelace')).toBe('AL');
  });

  it('ignores repeated and leading spaces', () => {
    expect(initialsOf('  Ada   Lovelace')).toBe('AL');
  });

  it('returns an empty string for an empty or blank name', () => {
    expect(initialsOf('')).toBe('');
    expect(initialsOf('   ')).toBe('');
  });
});
