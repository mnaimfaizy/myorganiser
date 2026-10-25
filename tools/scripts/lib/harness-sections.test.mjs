/**
 * Run with: yarn agents:sync:test
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { KNOWN_HARNESSES, renderHarnessSections } from './harness-sections.mjs';

test('a body with no markers is identical for every harness', () => {
  const body = '# Agent\n\nDo the thing.\n\n## Rules\n\n- One\n- Two';
  for (const harness of KNOWN_HARNESSES) {
    assert.equal(renderHarnessSections(body, harness), body);
  }
});

test('keeps a block only for the harness it names', () => {
  const body = [
    'Shared intro.',
    '',
    '<!-- harness:claude -->',
    'Claude only.',
    '<!-- /harness -->',
    '',
    'Shared outro.',
  ].join('\n');

  assert.equal(
    renderHarnessSections(body, 'claude'),
    'Shared intro.\n\nClaude only.\n\nShared outro.',
  );
  assert.equal(
    renderHarnessSections(body, 'gemini'),
    'Shared intro.\n\nShared outro.',
  );
});

test('a block may name several harnesses', () => {
  const body = [
    '<!-- harness:claude, cursor -->',
    'Both.',
    '<!-- /harness -->',
  ].join('\n');

  assert.equal(renderHarnessSections(body, 'claude'), 'Both.');
  assert.equal(renderHarnessSections(body, 'cursor'), 'Both.');
  assert.equal(renderHarnessSections(body, 'copilot'), '');
});

test('dropping a block does not leave a widening blank gap', () => {
  const body = [
    'Before.',
    '',
    '<!-- harness:claude -->',
    'Claude.',
    '<!-- /harness -->',
    '',
    '<!-- harness:gemini -->',
    'Gemini.',
    '<!-- /harness -->',
    '',
    'After.',
  ].join('\n');

  assert.equal(renderHarnessSections(body, 'cursor'), 'Before.\n\nAfter.');
});

test('rejects an unknown harness inside a marker', () => {
  const body = '<!-- harness:claude,windsurf -->\nx\n<!-- /harness -->';
  assert.throws(
    () => renderHarnessSections(body, 'claude'),
    /unknown harness "windsurf"/,
  );
});

test('rejects an empty harness list', () => {
  const body = '<!-- harness: -->\nx\n<!-- /harness -->';
  assert.throws(
    () => renderHarnessSections(body, 'claude'),
    /names no harness/,
  );
});

test('rejects an unclosed block', () => {
  const body = 'Intro.\n\n<!-- harness:claude -->\nDangling.';
  assert.throws(() => renderHarnessSections(body, 'claude'), /is never closed/);
});

test('rejects a close marker with no open', () => {
  const body = 'Intro.\n\n<!-- /harness -->';
  assert.throws(() => renderHarnessSections(body, 'claude'), /no matching/);
});

test('rejects nested blocks', () => {
  const body = [
    '<!-- harness:claude -->',
    '<!-- harness:cursor -->',
    'x',
    '<!-- /harness -->',
    '<!-- /harness -->',
  ].join('\n');
  assert.throws(() => renderHarnessSections(body, 'claude'), /nested/);
});

test('rejects an inline marker that would otherwise leak to every harness', () => {
  const body = 'Text <!-- harness:claude --> more text';
  assert.throws(
    () => renderHarnessSections(body, 'gemini'),
    /stray harness marker/,
  );
});

test('rejects an unknown target harness', () => {
  assert.throws(
    () => renderHarnessSections('x', 'windsurf'),
    /Unknown harness "windsurf"/,
  );
});
