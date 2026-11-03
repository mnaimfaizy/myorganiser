import { describe, expect, it } from '@jest/globals';

import { formatUsd } from './formatUsd';

describe('formatUsd', () => {
  it('formats zero with two decimals and a literal dollar sign', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('formats a fractional amount to exactly two decimals', () => {
    expect(formatUsd(12.5)).toBe('$12.50');
  });

  it('pads a whole amount to two decimals', () => {
    expect(formatUsd(3)).toBe('$3.00');
  });
});
