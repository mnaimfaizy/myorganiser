import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addPeakContext,
  describeContextWindow,
  peakContextCell,
  summariseContextWindow,
} from './sandcastle-context-window.ts';

const plain = (tokens: number): string => String(tokens);

test('summariseContextWindow returns null when no iteration reports one', () => {
  assert.equal(summariseContextWindow([]), null);
  assert.equal(summariseContextWindow([{}, {}]), null);
});

test('summariseContextWindow takes the peak and the last reported limit', () => {
  assert.deepEqual(
    summariseContextWindow([
      { contextWindow: { tokens: 50, limit: 200 } },
      {},
      { contextWindow: { tokens: 90 } },
      { contextWindow: { tokens: 70, limit: 1000 } },
    ]),
    { peakTokens: 90, limit: 1000 },
  );
});

test('summariseContextWindow keeps a zero-token reading', () => {
  assert.deepEqual(summariseContextWindow([{ contextWindow: { tokens: 0 } }]), {
    peakTokens: 0,
    limit: null,
  });
});

test('describeContextWindow shows the share of the limit when known', () => {
  assert.equal(
    describeContextWindow({ peakTokens: 84, limit: 200 }, plain),
    'peak context 84 of 200 (42%)',
  );
});

test('describeContextWindow omits the share without a limit', () => {
  assert.equal(
    describeContextWindow({ peakTokens: 84, limit: null }, plain),
    'peak context 84',
  );
});

test('addPeakContext keeps the largest peak with the limit from that run', () => {
  const totals = { peakContextTokens: 0, contextWindowLimit: null };
  addPeakContext(totals, { peakContextTokens: 50, contextWindowLimit: 200 });
  addPeakContext(totals, { peakContextTokens: 90 });
  addPeakContext(totals, { peakContextTokens: 70, contextWindowLimit: 1000 });
  addPeakContext(totals, {});
  assert.deepEqual(totals, { peakContextTokens: 90, contextWindowLimit: null });
});

test('peakContextCell renders limit, no limit, and no reading', () => {
  assert.equal(
    peakContextCell({ peakContextTokens: 84, contextWindowLimit: 200 }),
    '84 of 200',
  );
  assert.equal(
    peakContextCell({ peakContextTokens: 84, contextWindowLimit: null }),
    '84',
  );
  assert.equal(
    peakContextCell({ peakContextTokens: 0, contextWindowLimit: null }),
    'n/a',
  );
});
