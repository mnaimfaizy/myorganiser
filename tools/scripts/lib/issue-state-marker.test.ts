/**
 * Contract Suite for the shared issue state marker (PRD #1387, issue #1393).
 * Two automations rely on it to record a recovery once: the npm audit issue
 * reports on every push to `main`, and the PR CI duration watch reports weekly.
 * This suite pins the marker's format and the reader's rules over a neutral
 * prefix, so the module is asserted without either caller's wording.
 *
 * Run with: node --test tools/scripts/lib/issue-state-marker.test.ts
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { issueStateMarker } from './issue-state-marker.ts';

type State = 'open' | 'closed';

const reader = issueStateMarker<State>({
  prefix: 'demo-issue',
  states: ['open', 'closed'],
  fallback: 'open',
});

describe('the marker a report opens with', () => {
  test('marker(state) renders an HTML comment naming the prefix and the state', () => {
    assert.equal(reader.marker('open'), '<!-- demo-issue:open -->');
    assert.equal(reader.marker('closed'), '<!-- demo-issue:closed -->');
  });

  test('a body opened with marker(state) reads back as that state', () => {
    assert.equal(
      reader.lastReportedState({
        body: `${reader.marker('closed')}\nThe report.`,
      }),
      'closed',
    );
  });
});

describe('reading the newest marker', () => {
  test('a marker at the start of the body is read; no marker anywhere is the fallback', () => {
    assert.equal(
      reader.lastReportedState({ body: '<!-- demo-issue:closed -->' }),
      'closed',
    );
    assert.equal(
      reader.lastReportedState({ body: 'Opened by hand.', comments: [] }),
      'open',
    );
    assert.equal(
      reader.lastReportedState({ body: null, comments: null }),
      'open',
    );
    assert.equal(reader.lastReportedState({}), 'open');
  });

  test('comments are read oldest first, so the newest marker wins over the body and older comments', () => {
    assert.equal(
      reader.lastReportedState({
        body: '<!-- demo-issue:closed -->',
        comments: [
          { body: '<!-- demo-issue:open -->' },
          { body: '<!-- demo-issue:closed -->' },
        ],
      }),
      'closed',
    );
    assert.equal(
      reader.lastReportedState({
        body: '<!-- demo-issue:closed -->',
        comments: [
          { body: '<!-- demo-issue:closed -->' },
          { body: '<!-- demo-issue:open -->' },
        ],
      }),
      'open',
    );
  });

  test('a marker that is not at the start of a body is ignored, in the body and in a comment', () => {
    assert.equal(
      reader.lastReportedState({
        body: 'Some prose first.\n<!-- demo-issue:closed -->',
      }),
      'open',
    );
    assert.equal(
      reader.lastReportedState({
        body: ' <!-- demo-issue:closed -->',
      }),
      'open',
    );
    assert.equal(
      reader.lastReportedState({
        body: 'Opened by hand.',
        comments: [{ body: 'A quotation: <!-- demo-issue:closed -->' }],
      }),
      'open',
    );
  });

  test('a marker naming a state outside states is ignored, so the previous report still counts', () => {
    assert.equal(
      reader.lastReportedState({ body: '<!-- demo-issue:archived -->' }),
      'open',
    );
    assert.equal(
      reader.lastReportedState({
        body: '<!-- demo-issue:closed -->',
        comments: [{ body: '<!-- demo-issue:archived -->' }],
      }),
      'closed',
    );
  });

  test('a prefix containing regex metacharacters is matched literally, not as a pattern', () => {
    const literal = issueStateMarker<State>({
      prefix: 'a.b*(c)',
      states: ['open', 'closed'],
      fallback: 'open',
    });
    assert.equal(literal.marker('closed'), '<!-- a.b*(c):closed -->');
    assert.equal(
      literal.lastReportedState({ body: '<!-- a.b*(c):closed -->' }),
      'closed',
    );
    // As an unescaped pattern, `a.b*(c)` would also match this body.
    assert.equal(
      literal.lastReportedState({ body: '<!-- aXc:closed -->' }),
      'open',
    );
  });
});
