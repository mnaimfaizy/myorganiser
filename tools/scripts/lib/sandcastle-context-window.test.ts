import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeContextWindow,
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
