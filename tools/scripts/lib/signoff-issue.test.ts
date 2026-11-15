// Contract Suite for the Sign-off Issue (ADR 0151 decision 6, #1588): the
// fixed-form body, the finder, the QA Report reader, and the write
// orchestration driven over an in-memory issue store.
//
// Run with: node --test tools/scripts/lib/signoff-issue.test.ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type PrCommit, QA_REPORT_MARKER } from './qa-report.ts';
import {
  addCarriedToSignOffIssue,
  addToSignOffIssue,
  type SignOffChecksRead,
  type SignOffPlace,
  signOffChecksFromView,
  emptySignOffReport,
  findSignOffIssue,
  freezeSignOffBody,
  parseCarriedComment,
  parseSignOffIssue,
  type QaReportComment,
  recordSignOff,
  renderCarriedComment,
  renderCarriedLine,
  renderFrozenSignOffIssue,
  renderSignOffFrozen,
  renderSignOffIssue,
  renderSignOffLine,
  renderSignOffReport,
  SIGNOFF_ISSUE_MARKER,
  SIGNOFF_ISSUE_TITLE,
  SIGNOFF_SECTION_HEADING,
  type SignOffCheck,
  type SignOffEntry,
  type SignOffIo,
  type SignOffIssueCandidate,
  type SignOffIssueLookup,
  type SignOffReport,
  signOffFrozenTitle,
  signOffKey,
  unsafeSignOffText,
} from './signoff-issue.ts';

// ------------------------------------------------------------- fixtures

const TRUSTED = 'maintainer';
const PR = 7;
const COMMENT_URL = 'https://github.test/comments/1';
const NEW_ISSUE = 42;

/** A full, lowercase, non-random 40-character SHA. */
const HEAD = '0123456789abcdef'.repeat(2) + '01234567';
const sha = (ch: string): string => ch.repeat(40);
const REPORTED = sha('a');
const MID = sha('b');
const BASE = sha('9');

type Check = { place: SignOffPlace; text: string };
const STAGING: Check = { place: 'staging', text: 'Check the invoice email' };
const PRODUCTION: Check = { place: 'production', text: 'Confirm the tax line' };

const entryOf = (check: Check, pr = PR): SignOffEntry => ({
  pr,
  ...check,
  reportUrl: COMMENT_URL,
});
const A = entryOf(STAGING);
const B = entryOf(PRODUCTION);

/** A body in the fixed form, with the given lines in its checks section. */
const sectionBody = (...lines: string[]): string =>
  [SIGNOFF_ISSUE_MARKER, '', SIGNOFF_SECTION_HEADING, '', ...lines].join('\n');

const STAGING_PROD_HEADER = `QA Report: result=passed; commit=${HEAD}; left-for-person=1; deferred=2`;
const STAGING_PROD_LINES = [
  '- [local] Check the banner on a phone',
  '- [staging] Check the invoice email',
  '- [production] Confirm the tax line',
];
const reportWith = (header: string, ...lines: string[]): string =>
  [QA_REPORT_MARKER, header, '', '### Left for a person', ...lines].join('\n');
const STAGING_PROD_REPORT = reportWith(
  STAGING_PROD_HEADER,
  ...STAGING_PROD_LINES,
);

const qaComment = (
  body: string,
  overrides: Partial<QaReportComment> = {},
): QaReportComment => ({
  body,
  author: { login: TRUSTED },
  isMinimized: false,
  url: COMMENT_URL,
  ...overrides,
});

const noCommits = (): PrCommit[] | null => [];

/** Reads the `staging` and `production` Person Checks for the fixture head, with `isOnMain` always true. */
const readReport = (
  comments: QaReportComment[] | null,
  commits: () => PrCommit[] | null = noCommits,
  head = HEAD,
): SignOffChecksRead =>
  signOffChecksFromView(
    comments === null ? null : { comments },
    TRUSTED,
    head,
    commits,
    () => true,
  );

type ReadResult = Extract<SignOffChecksRead, { status: 'read' }>;
function asRead(result: SignOffChecksRead): ReadResult {
  assert.equal(result.status, 'read', JSON.stringify(result));
  return result as ReadResult;
}

// ------------------------------------------------------------- write fake

interface FakeStore {
  issue: { number: number; body: string } | null;
  /** When set, the finder reports the open issues as unreadable with this reason. */
  unreadable: string | null;
  refuseCreate: boolean;
  /**
   * What a refused create still leaves in the store: nothing, the body it was
   * given (an issue made, but its number not returned), or an empty issue
   * (a concurrent writer's, lacking the lines).
   */
  storeOnRefusedCreate: 'written' | 'empty' | 'first-only' | null;
  /**
   * When set, every lookup after the first is unreadable with this reason (the
   * first lookup stays as the store holds it).
   */
  readbackUnreadable: string | null;
  /** When set, a numbered write is refused (null) and stores nothing. */
  refuseEdit: boolean;
  /** When set, the issue is gone after a numbered write (a read-back finds none). */
  closeOnWrite: boolean;
  /** Edits the store accepts but does not keep: a concurrent writer's replace. */
  lostEdits: number;
  lookups: number;
  /** The (pr, headRefOid) arguments `signOffChecks` was called with. */
  checkCalls: [number, string][];
  writes: { number: number | null; body: string }[];
}

const emptyStore = (overrides: Partial<FakeStore> = {}): FakeStore => ({
  issue: null,
  unreadable: null,
  refuseCreate: false,
  storeOnRefusedCreate: null,
  readbackUnreadable: null,
  refuseEdit: false,
  closeOnWrite: false,
  lostEdits: 0,
  lookups: 0,
  checkCalls: [],
  writes: [],
  ...overrides,
});

function fakeIo(read: SignOffChecksRead, store: FakeStore): SignOffIo {
  return {
    signOffChecks: (pr, headRefOid) => {
      store.checkCalls.push([pr, headRefOid]);
      return read;
    },
    findSignOffIssue: (): SignOffIssueLookup => {
      store.lookups += 1;
      if (store.unreadable !== null)
        return { status: 'unreadable', reason: store.unreadable };
      if (store.readbackUnreadable !== null && store.lookups > 1)
        return { status: 'unreadable', reason: store.readbackUnreadable };
      if (store.issue === null) return { status: 'none' };
      return {
        status: 'found',
        number: store.issue.number,
        body: store.issue.body,
      };
    },
    writeSignOffIssue: (number, body) => {
      store.writes.push({ number, body });
      if (number === null) {
        if (store.refuseCreate) {
          if (store.storeOnRefusedCreate === 'written')
            store.issue = { number: NEW_ISSUE, body };
          if (store.storeOnRefusedCreate === 'empty')
            store.issue = { number: NEW_ISSUE, body: renderSignOffIssue([]) };
          if (store.storeOnRefusedCreate === 'first-only')
            store.issue = { number: NEW_ISSUE, body: renderSignOffIssue([A]) };
          return null;
        }
        store.issue = { number: NEW_ISSUE, body };
        return NEW_ISSUE;
      }
      if (store.refuseEdit) return null;
      if (store.lostEdits > 0) {
        store.lostEdits -= 1;
        return number;
      }
      store.issue = store.closeOnWrite ? null : { number, body };
      return number;
    },
  };
}

/** The read a merged Pull Request's trusted report gives for `checks`. */
const readOf = (
  checks: Check[],
  caveat: string | null = null,
): SignOffChecksRead => ({
  status: 'read',
  checks,
  reportUrl: COMMENT_URL,
  caveat,
});

// ------------------------------------------------------------- format

describe('Sign-off Issue format', () => {
  // 1
  test('renderSignOffIssue round-trips through parseSignOffIssue, including a text with " · "', () => {
    const entries = [
      A,
      entryOf({ place: 'production', text: 'Confirm the price · tax line' }, 8),
    ];
    const parsed = parseSignOffIssue(renderSignOffIssue(entries));
    assert.deepEqual(parsed, {
      checks: entries.map((e) => ({
        ...e,
        key: signOffKey(e.place, e.text),
        checked: false,
      })),
      frozen: null,
    });
  });

  // 2
  test('signOffKey is stable for the same place and text, and differs when only the place differs', () => {
    const key = signOffKey('staging', 'Check the invoice email');
    assert.match(key, /^[0-9a-f]{12}$/);
    assert.equal(signOffKey('staging', 'Check the invoice email'), key);
    assert.notEqual(signOffKey('production', 'Check the invoice email'), key);
    assert.notEqual(signOffKey('staging', 'Check the menu'), key);
  });

  // 3
  test('a ticked line, with either x or X, parses as checked', () => {
    const line = renderSignOffLine(A);
    for (const mark of ['- [x]', '- [X]']) {
      const parsed = parseSignOffIssue(
        sectionBody(line.replace('- [ ]', mark)),
      );
      assert.equal(parsed?.checks[0]?.checked, true, mark);
    }
    assert.equal(
      parseSignOffIssue(sectionBody(line))?.checks[0]?.checked,
      false,
    );
  });

  // 4
  test('a body outside the fixed form parses as null', () => {
    const cases: [string, string][] = [
      ['a blank first line', `\n${sectionBody(renderSignOffLine(A))}`],
      [
        'the marker quoted in prose, not on line 1',
        [
          'Quoted: ' + SIGNOFF_ISSUE_MARKER,
          '',
          SIGNOFF_SECTION_HEADING,
          '',
          renderSignOffLine(A),
        ].join('\n'),
      ],
      [
        'no Person Checks section',
        [SIGNOFF_ISSUE_MARKER, '', 'Just prose.'].join('\n'),
      ],
      [
        'two Person Checks sections',
        [
          SIGNOFF_ISSUE_MARKER,
          '',
          SIGNOFF_SECTION_HEADING,
          '',
          renderSignOffLine(A),
          '',
          '## Other',
          '',
          SIGNOFF_SECTION_HEADING,
          '',
        ].join('\n'),
      ],
      ['a local check line', sectionBody('- [ ] [local] Check the banner')],
      ['a plain top-level note', sectionBody('- some note')],
      [
        'a display #n that differs from the trailer pr=n',
        sectionBody(renderSignOffLine(A).replace(' · #7 · ', ' · #8 · ')),
      ],
      ['an unclosed code fence', sectionBody('```', renderSignOffLine(A))],
    ];
    for (const [why, body] of cases) {
      assert.equal(parseSignOffIssue(body), null, why);
    }
  });

  // 5
  test('an indented continuation, prose, fenced list items, and lists under a later heading are ignored, not refused', () => {
    const body = [
      SIGNOFF_ISSUE_MARKER,
      'A list item before the section, which is ignored:',
      '- an early note',
      '',
      SIGNOFF_SECTION_HEADING,
      '',
      'Prose in the section.',
      renderSignOffLine(A),
      '  - bug #123',
      '```md',
      '- [ ] [local] a list item inside a fence',
      '```',
      '',
      '## Notes',
      '- a note under a later heading',
    ].join('\n');
    assert.deepEqual(parseSignOffIssue(body), {
      checks: [{ ...A, key: signOffKey(A.place, A.text), checked: false }],
      frozen: null,
    });
  });

  // 6
  test('addToSignOffIssue adds only entries whose (pr, key) is absent, and a repeat returns the identical body', () => {
    const first = addToSignOffIssue(renderSignOffIssue([]), [A, B]);
    assert.ok(first);
    assert.deepEqual(first.added, [A, B]);

    const second = addToSignOffIssue(first.body, [A, B]);
    assert.ok(second);
    assert.deepEqual(second.added, []);
    assert.equal(second.body, first.body);

    // The same Person Check on another Pull Request is a different line.
    const otherPr = addToSignOffIssue(first.body, [{ ...A, pr: 8 }]);
    assert.ok(otherPr);
    assert.deepEqual(otherPr.added, [{ ...A, pr: 8 }]);
  });

  // 7
  test('addToSignOffIssue keeps every other line, inserts after the section, and opens an empty section with a blank line', () => {
    const C = entryOf({ place: 'staging', text: 'Check the menu' }, 9);
    const ticked = renderSignOffLine(A).replace('- [ ]', '- [x]');
    const body = [
      SIGNOFF_ISSUE_MARKER,
      'Prose before the section.',
      '',
      SIGNOFF_SECTION_HEADING,
      '',
      ticked,
      '  - bug #123',
      renderSignOffLine(C),
      '',
      '## Other',
      'Other text.',
      '',
    ].join('\n');
    const added = addToSignOffIssue(body, [B]);
    assert.ok(added);
    assert.equal(
      added.body,
      [
        SIGNOFF_ISSUE_MARKER,
        'Prose before the section.',
        '',
        SIGNOFF_SECTION_HEADING,
        '',
        ticked,
        '  - bug #123',
        renderSignOffLine(C),
        renderSignOffLine(B),
        '',
        '## Other',
        'Other text.',
        '',
      ].join('\n'),
    );

    const empty = addToSignOffIssue(
      [SIGNOFF_ISSUE_MARKER, '', SIGNOFF_SECTION_HEADING].join('\n'),
      [B],
    );
    assert.ok(empty);
    assert.equal(
      empty.body,
      [
        SIGNOFF_ISSUE_MARKER,
        '',
        SIGNOFF_SECTION_HEADING,
        '',
        renderSignOffLine(B),
      ].join('\n'),
    );
  });

  // 8
  test('a CRLF body keeps its CRLF line endings after an insert', () => {
    const body = [
      SIGNOFF_ISSUE_MARKER,
      '',
      SIGNOFF_SECTION_HEADING,
      '',
      renderSignOffLine(A),
      '',
    ].join('\r\n');
    assert.equal(parseSignOffIssue(body)?.checks.length, 1);
    const added = addToSignOffIssue(body, [B]);
    assert.ok(added);
    assert.equal(
      added.body,
      [
        SIGNOFF_ISSUE_MARKER,
        '',
        SIGNOFF_SECTION_HEADING,
        '',
        renderSignOffLine(A),
        renderSignOffLine(B),
        '',
      ].join('\r\n'),
    );
  });

  // 9
  test('addToSignOffIssue on a body outside the fixed form returns null, so nothing is written over it', () => {
    assert.equal(addToSignOffIssue('Just prose, no marker.', [A]), null);
  });

  // 10
  test('unsafeSignOffText is true for text holding <!-- or -->, and false otherwise', () => {
    assert.equal(unsafeSignOffText('Check the <!-- thing'), true);
    assert.equal(unsafeSignOffText('Check the --> thing'), true);
    assert.equal(unsafeSignOffText('Check the invoice email'), false);
  });
});

// ------------------------------------------------------------- frozen line

describe('Sign-off Issue frozen line', () => {
  const FROZEN = renderSignOffFrozen('v1.2.3');

  // 1
  test('renderSignOffFrozen renders the fixed frozen line, and throws for anything that is not a release version', () => {
    assert.equal(FROZEN, '<!-- signoff-frozen version=v1.2.3 -->');
    for (const version of ['1.2.3', 'v1.2', 'v1.2.3-rc.1']) {
      assert.throws(
        () => renderSignOffFrozen(version),
        /not a release version/,
        version,
      );
    }
  });

  // 2
  test('a frozen line on the line after the marker parses with its version, and leaves the checks as they are without it', () => {
    const plain = sectionBody(renderSignOffLine(A), renderSignOffLine(B));
    const frozen = [
      SIGNOFF_ISSUE_MARKER,
      FROZEN,
      '',
      SIGNOFF_SECTION_HEADING,
      '',
      renderSignOffLine(A),
      renderSignOffLine(B),
    ].join('\n');
    assert.equal(parseSignOffIssue(plain)?.frozen, null);
    assert.deepEqual(parseSignOffIssue(frozen)?.frozen, { version: 'v1.2.3' });
    assert.deepEqual(
      parseSignOffIssue(frozen)?.checks,
      parseSignOffIssue(plain)?.checks,
    );
  });

  // 3
  test('a frozen line among the Maintainer prose between the marker and the section is read', () => {
    const body = [
      SIGNOFF_ISSUE_MARKER,
      'Prose before the freeze.',
      FROZEN,
      'Prose after it.',
      '',
      SIGNOFF_SECTION_HEADING,
      '',
      renderSignOffLine(A),
    ].join('\n');
    const parsed = parseSignOffIssue(body);
    assert.deepEqual(parsed?.frozen, { version: 'v1.2.3' });
    assert.deepEqual(
      parsed?.checks.map((c) => c.key),
      [signOffKey(A.place, A.text)],
    );
  });

  // 4
  test('a body with a second frozen line, a frozen line in or after the section, an indented or malformed frozen line is unparseable', () => {
    const cases: [string, string][] = [
      [
        'two frozen lines before the section',
        [
          SIGNOFF_ISSUE_MARKER,
          FROZEN,
          renderSignOffFrozen('v1.2.4'),
          '',
          SIGNOFF_SECTION_HEADING,
          '',
        ].join('\n'),
      ],
      [
        'a frozen line inside the section',
        [
          SIGNOFF_ISSUE_MARKER,
          '',
          SIGNOFF_SECTION_HEADING,
          '',
          FROZEN,
          renderSignOffLine(A),
        ].join('\n'),
      ],
      [
        'a frozen line after the section',
        [
          SIGNOFF_ISSUE_MARKER,
          '',
          SIGNOFF_SECTION_HEADING,
          '',
          renderSignOffLine(A),
          '## Notes',
          FROZEN,
        ].join('\n'),
      ],
      [
        'an indented frozen line',
        [
          SIGNOFF_ISSUE_MARKER,
          `  ${FROZEN}`,
          '',
          SIGNOFF_SECTION_HEADING,
          '',
        ].join('\n'),
      ],
      [
        'a frozen line without version=',
        [
          SIGNOFF_ISSUE_MARKER,
          '<!-- signoff-frozen v1.2.3 -->',
          '',
          SIGNOFF_SECTION_HEADING,
          '',
        ].join('\n'),
      ],
      [
        'a frozen line with an unprefixed version',
        [
          SIGNOFF_ISSUE_MARKER,
          '<!-- signoff-frozen version=1.2.3 -->',
          '',
          SIGNOFF_SECTION_HEADING,
          '',
        ].join('\n'),
      ],
      [
        'a frozen line with trailing text',
        [
          SIGNOFF_ISSUE_MARKER,
          `${FROZEN} trailing`,
          '',
          SIGNOFF_SECTION_HEADING,
          '',
        ].join('\n'),
      ],
    ];
    for (const [why, body] of cases) {
      assert.equal(parseSignOffIssue(body), null, why);
    }
  });

  // 5
  test('a frozen line inside a code fence before the section is content: it is ignored, and does not count as the frozen line', () => {
    const fencedOnly = [
      SIGNOFF_ISSUE_MARKER,
      '```md',
      FROZEN,
      '```',
      '',
      SIGNOFF_SECTION_HEADING,
      '',
      renderSignOffLine(A),
    ].join('\n');
    assert.deepEqual(parseSignOffIssue(fencedOnly), {
      checks: [{ ...A, key: signOffKey(A.place, A.text), checked: false }],
      frozen: null,
    });

    const fencedPlusReal = [
      SIGNOFF_ISSUE_MARKER,
      '```md',
      renderSignOffFrozen('v1.2.4'),
      '```',
      FROZEN,
      '',
      SIGNOFF_SECTION_HEADING,
      '',
    ].join('\n');
    assert.deepEqual(parseSignOffIssue(fencedPlusReal)?.frozen, {
      version: 'v1.2.3',
    });
  });

  // 6
  test('addToSignOffIssue keeps the frozen line exactly as it was, and adds the new entries to the section', () => {
    const body = [
      SIGNOFF_ISSUE_MARKER,
      FROZEN,
      '',
      SIGNOFF_SECTION_HEADING,
      '',
      renderSignOffLine(A),
    ].join('\n');
    const next = addToSignOffIssue(body, [A, B]);
    assert.ok(next);
    assert.deepEqual(next.added, [B]);
    assert.equal(
      next.body,
      [
        SIGNOFF_ISSUE_MARKER,
        FROZEN,
        '',
        SIGNOFF_SECTION_HEADING,
        '',
        renderSignOffLine(A),
        renderSignOffLine(B),
      ].join('\n'),
    );
    assert.deepEqual(parseSignOffIssue(next.body)?.frozen, {
      version: 'v1.2.3',
    });
  });

  // 7
  test('the train never flips a box: a ticked, an upper-case ticked, and an unticked line keep their checkbox byte for byte, when entries are added and when they repeat', () => {
    const menu = entryOf({ place: 'staging', text: 'Check the menu' }, 9);
    const newEntry = entryOf(
      { place: 'production', text: 'Check the ledger' },
      11,
    );
    const xLine = renderSignOffLine(A).replace('- [ ]', '- [x]');
    const upperLine = renderSignOffLine(B).replace('- [ ]', '- [X]');
    const openLine = renderSignOffLine(menu);
    const body = sectionBody(xLine, upperLine, openLine);

    const withNew = addToSignOffIssue(body, [newEntry]);
    assert.ok(withNew);
    assert.deepEqual(withNew.added, [newEntry]);
    assert.equal(
      withNew.body,
      sectionBody(xLine, upperLine, openLine, renderSignOffLine(newEntry)),
    );
    assert.deepEqual(
      parseSignOffIssue(withNew.body)?.checks.map((c) => c.checked),
      [true, true, false, false],
    );

    const repeat = addToSignOffIssue(body, [A, B, menu]);
    assert.ok(repeat);
    assert.deepEqual(repeat.added, []);
    assert.equal(repeat.body, body);
  });
});

// ------------------------------------------------------------- finder

describe('findSignOffIssue', () => {
  const marked = renderSignOffIssue([]);

  // 11a
  test('unreadable without the candidates or without a trusted login', () => {
    const reason = 'the open `qa` issues could not be read';
    assert.deepEqual(findSignOffIssue(null, TRUSTED), {
      status: 'unreadable',
      reason,
    });
    assert.deepEqual(findSignOffIssue([], null), {
      status: 'unreadable',
      reason,
    });
  });

  // 11b
  test("finds only the trusted login's issue whose first line is the marker; other authors and unmarked issues are ignored", () => {
    const candidates: SignOffIssueCandidate[] = [
      { number: 12, body: marked, author: { login: TRUSTED } },
      { number: 13, body: 'Unrelated', author: { login: TRUSTED } },
      { number: 14, body: marked, author: { login: 'someone-else' } },
      {
        number: 15,
        body: `Prose\n${SIGNOFF_ISSUE_MARKER}`,
        author: { login: TRUSTED },
      },
    ];
    assert.deepEqual(findSignOffIssue(candidates, TRUSTED), {
      status: 'found',
      number: 12,
      body: marked,
    });
    assert.deepEqual(
      findSignOffIssue([candidates[2], candidates[3]], TRUSTED),
      {
        status: 'none',
      },
    );
  });

  // 11c
  test('two matching issues are unreadable, with a reason naming both', () => {
    const candidates: SignOffIssueCandidate[] = [
      { number: 12, body: marked, author: { login: TRUSTED } },
      { number: 13, body: marked, author: { login: TRUSTED } },
    ];
    assert.deepEqual(findSignOffIssue(candidates, TRUSTED), {
      status: 'unreadable',
      reason: 'more than one Sign-off Issue is open (#12, #13)',
    });
  });
});

// ------------------------------------------------------------- report reader

describe('signOffChecksFromView', () => {
  // 12a
  test("missing when there is no view, no report, or only another login's or a minimised report", () => {
    assert.equal(readReport(null).status, 'missing');
    assert.equal(readReport([]).status, 'missing');
    assert.equal(
      readReport([
        qaComment(STAGING_PROD_REPORT, { author: { login: 'someone-else' } }),
      ]).status,
      'missing',
    );
    assert.equal(
      readReport([qaComment(STAGING_PROD_REPORT, { isMinimized: true })])
        .status,
      'missing',
    );
  });

  // 12b
  test('when the latest trusted report does not parse, it is missing, and an older parsing report is not used', () => {
    const broken = qaComment(
      [
        QA_REPORT_MARKER,
        'QA Report: result=passed; commit=abc; left-for-person=0',
      ].join('\n'),
    );
    const result = readReport([qaComment(STAGING_PROD_REPORT), broken]);
    assert.equal(result.status, 'missing');
    assert.match(result.status === 'missing' ? result.reason : '', /header/);
  });

  // 13
  test('a legacy header, or a report with only [local] lines, reads with no checks and never asks for the commits', () => {
    let commitsAsked = 0;
    const commits = () => {
      commitsAsked += 1;
      return [];
    };
    const legacy = qaComment(
      [
        QA_REPORT_MARKER,
        `QA Report: result=passed; commit=${HEAD}; left-for-person=1`,
        '',
        '### Left for a person',
        '- [local] Check the banner on a phone',
      ].join('\n'),
    );
    const localOnly = qaComment(
      reportWith(
        `QA Report: result=passed; commit=${REPORTED}; left-for-person=1; deferred=0`,
        '- [local] Check the banner on a phone',
      ),
    );
    for (const comment of [legacy, localOnly]) {
      assert.deepEqual(readReport([comment], commits), {
        status: 'read',
        checks: [],
        reportUrl: '',
        caveat: null,
      });
    }
    assert.equal(commitsAsked, 0);
  });

  // 14
  test('only staging and production lines, with the comment URL, and no caveat when the report names the head', () => {
    let commitsAsked = 0;
    const result = readReport([qaComment(STAGING_PROD_REPORT)], () => {
      commitsAsked += 1;
      return [];
    });
    assert.deepEqual(result, {
      status: 'read',
      checks: [
        { place: 'staging', text: 'Check the invoice email' },
        { place: 'production', text: 'Confirm the tax line' },
      ],
      reportUrl: COMMENT_URL,
      caveat: null,
    });
    assert.equal(commitsAsked, 0);
  });

  // 15
  test('a report with staging or production checks whose URL is missing or not https is missing', () => {
    for (const url of [undefined, 'http://github.test/comments/1']) {
      const result = readReport([qaComment(STAGING_PROD_REPORT, { url })]);
      assert.equal(result.status, 'missing', String(url));
    }
  });

  // 16a
  test('a report that records a failure is still copied, with a caveat that says so', () => {
    const failed = qaComment(
      reportWith(
        `QA Report: result=failed; commit=${HEAD}; left-for-person=1; deferred=2`,
        ...STAGING_PROD_LINES,
      ),
    );
    const read = asRead(readReport([failed]));
    assert.equal(read.checks.length, 2);
    assert.match(read.caveat ?? '', /records a failure/);
  });

  // 16b
  test('a report the branch has moved past is copied with a caveat naming the report commit and the later one', () => {
    // REPORTED -> MID -> HEAD: MID is a one-parent commit the report does not cover.
    const commits: PrCommit[] = [
      { sha: REPORTED, parents: [BASE] },
      { sha: MID, parents: [REPORTED] },
      { sha: HEAD, parents: [MID] },
    ];
    const reported = qaComment(
      reportWith(
        `QA Report: result=passed; commit=${REPORTED}; left-for-person=1; deferred=2`,
        ...STAGING_PROD_LINES,
      ),
    );
    const read = asRead(readReport([reported], () => commits));
    assert.equal(read.checks.length, 2);
    assert.equal(
      read.caveat,
      'the QA Report copied is for `aaaaaaaa`, and the branch commit `bbbbbbbb` came after it',
    );
  });

  // 16c
  test('when the commits cannot be read, the caveat says it could not be told, and the checks are kept', () => {
    const reported = qaComment(
      reportWith(
        `QA Report: result=passed; commit=${REPORTED}; left-for-person=1; deferred=2`,
        ...STAGING_PROD_LINES,
      ),
    );
    const read = asRead(readReport([reported], () => null));
    assert.equal(read.checks.length, 2);
    assert.equal(
      read.caveat,
      "it could not be told whether the QA Report copied is current: the Pull Request's commits could not be read",
    );
  });

  // 5 (revision): a null trusted login reads as unreadable, not as a report.
  test('a null trusted login is missing, whatever comments are given', () => {
    assert.deepEqual(
      signOffChecksFromView(
        { comments: [qaComment(STAGING_PROD_REPORT)] },
        null,
        HEAD,
        noCommits,
        () => true,
      ),
      { status: 'missing', reason: 'the QA Report could not be read' },
    );
  });

  // Optional (revision): the head reached through a merge whose second parent
  // is on main is current, and the commits are asked.
  test('a head reached through a merge from main is current: commits are asked and the caveat is null', () => {
    const MERGE = sha('c');
    const MAIN = sha('d');
    const commits: PrCommit[] = [
      { sha: REPORTED, parents: [BASE] },
      { sha: MERGE, parents: [REPORTED, MAIN] },
    ];
    let commitsAsked = 0;
    const reported = qaComment(
      reportWith(
        `QA Report: result=passed; commit=${REPORTED}; left-for-person=1; deferred=2`,
        ...STAGING_PROD_LINES,
      ),
    );
    const read = asRead(
      readReport(
        [reported],
        () => {
          commitsAsked += 1;
          return commits;
        },
        MERGE,
      ),
    );
    assert.equal(commitsAsked, 1);
    assert.equal(read.caveat, null);
    assert.equal(read.checks.length, 2);
  });
});

// ------------------------------------------------------------- write

describe('recordSignOff', () => {
  // 17a
  test('a missing read records one note, and reads no issue and writes nothing', () => {
    const store = emptyStore();
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(
        {
          status: 'missing',
          reason: 'there is no QA Report for this Pull Request',
        },
        store,
      ),
      report,
    );
    assert.deepEqual(report, {
      signOff: [],
      signOffFailures: [],
      signOffNotes: [
        {
          pr: PR,
          reason:
            'no Person Check added to the Sign-off Issue: there is no QA Report for this Pull Request',
        },
      ],
    });
    assert.equal(store.lookups, 0);
    assert.deepEqual(store.writes, []);
  });

  // 17b
  test('a read with no checks records nothing, and reads no issue and writes nothing', () => {
    const store = emptyStore();
    const report = emptySignOffReport();
    recordSignOff(PR, HEAD, fakeIo(readOf([]), store), report);
    assert.deepEqual(report, emptySignOffReport());
    assert.equal(store.lookups, 0);
    assert.deepEqual(store.writes, []);
  });

  // 17c
  test('a caveat is recorded as a note, and the write still happens', () => {
    const store = emptyStore();
    const report = emptySignOffReport();
    const caveat = 'the QA Report copied records a failure';
    recordSignOff(PR, HEAD, fakeIo(readOf([STAGING], caveat), store), report);
    assert.deepEqual(report.signOffNotes, [{ pr: PR, reason: caveat }]);
    assert.equal(store.writes.length, 1);
    assert.equal(report.signOff.length, 1);
  });

  // 18a
  test('with no issue open, one create writes the entries, and the signOff entry names the returned number', () => {
    const store = emptyStore();
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.equal(store.writes.length, 1);
    assert.equal(store.writes[0].number, null);
    const parsed = parseSignOffIssue(store.writes[0].body);
    assert.deepEqual(
      parsed?.checks.map(({ pr, place, text, reportUrl }) => ({
        pr,
        place,
        text,
        reportUrl,
      })),
      [A, B],
    );
    assert.deepEqual(report.signOff, [
      { pr: PR, issue: NEW_ISSUE, created: true, added: 2 },
    ]);
    assert.deepEqual(report.signOffFailures, []);
  });

  // 18a (revision): the collaborator is asked for the merged PR's own head.
  test('signOffChecks is asked for the merged Pull Request and its head', () => {
    const store = emptyStore();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      emptySignOffReport(),
    );
    assert.deepEqual(store.checkCalls, [[PR, HEAD]]);
  });

  // 18b
  test('a refused create records a failure whose unwritten lines are the rendered entries exactly', () => {
    const store = emptyStore({ refuseCreate: true });
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.equal(store.writes.length, 1);
    // The lookup before the create, and the read-back after the refusal.
    assert.equal(store.lookups, 2);
    assert.deepEqual(report.signOff, []);
    assert.deepEqual(report.signOffFailures, [
      {
        pr: PR,
        reason: 'the Sign-off Issue could not be created',
        unwritten: [A, B].map(renderSignOffLine),
      },
    ]);
  });

  // 18c (revision): a create GitHub took, whose number was lost, is read back and recorded.
  test('a refused create whose issue is found holding every line is recorded as created, with no failure', () => {
    const store = emptyStore({
      refuseCreate: true,
      storeOnRefusedCreate: 'written',
    });
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.equal(store.writes.length, 1);
    assert.deepEqual(report.signOff, [
      { pr: PR, issue: NEW_ISSUE, created: true, added: 2 },
    ]);
    assert.deepEqual(report.signOffFailures, []);
  });

  // 18d (revision): a refused create whose read-back issue lacks the lines fails with every line.
  test('a refused create whose read-back issue lacks the lines records a failure with every rendered line', () => {
    const store = emptyStore({
      refuseCreate: true,
      storeOnRefusedCreate: 'empty',
    });
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.equal(store.writes.length, 1);
    assert.deepEqual(report.signOff, []);
    assert.deepEqual(report.signOffFailures, [
      {
        pr: PR,
        reason: 'the Sign-off Issue could not be created',
        unwritten: [A, B].map(renderSignOffLine),
      },
    ]);
  });

  // 18e (revision): a refused create whose read-back is unreadable says it may have been created.
  test('a refused create whose read-back is unreadable records that the issue may exist, with every line', () => {
    const reason = 'more than one Sign-off Issue is open (#41, #42)';
    const store = emptyStore({
      refuseCreate: true,
      readbackUnreadable: reason,
    });
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.equal(store.writes.length, 1);
    assert.equal(store.lookups, 2);
    assert.deepEqual(report.signOff, []);
    assert.deepEqual(report.signOffFailures, [
      {
        pr: PR,
        reason: `the Sign-off Issue may have been created, but could not be read back: ${reason}`,
        unwritten: [A, B].map(renderSignOffLine),
      },
    ]);
  });

  // 18f (revision): the read-back holds A but not B, so the failure lists both lines (every, not some).
  test('a refused create whose read-back holds only part of the entries records a failure with every line', () => {
    const store = emptyStore({
      refuseCreate: true,
      storeOnRefusedCreate: 'first-only',
    });
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.equal(store.writes.length, 1);
    assert.deepEqual(report.signOff, []);
    assert.deepEqual(report.signOffFailures, [
      {
        pr: PR,
        reason: 'the Sign-off Issue could not be created',
        unwritten: [A, B].map(renderSignOffLine),
      },
    ]);
  });

  // 19
  test('an existing issue is edited by number, and a re-run for the same Pull Request writes nothing new', () => {
    const existing = renderSignOffIssue([
      entryOf({ place: 'staging', text: 'Check the menu' }, 3),
    ]);
    const store = emptyStore({ issue: { number: 5, body: existing } });
    const io = fakeIo(readOf([STAGING, PRODUCTION]), store);

    const first = emptySignOffReport();
    recordSignOff(PR, HEAD, io, first);
    assert.equal(store.writes.length, 1);
    assert.equal(store.writes[0].number, 5);
    assert.deepEqual(
      parseSignOffIssue(store.writes[0].body)?.checks.map((c) => ({
        pr: c.pr,
        place: c.place,
        text: c.text,
        key: c.key,
      })),
      [
        {
          pr: 3,
          place: 'staging',
          text: 'Check the menu',
          key: signOffKey('staging', 'Check the menu'),
        },
        {
          pr: PR,
          place: STAGING.place,
          text: STAGING.text,
          key: signOffKey(STAGING.place, STAGING.text),
        },
        {
          pr: PR,
          place: PRODUCTION.place,
          text: PRODUCTION.text,
          key: signOffKey(PRODUCTION.place, PRODUCTION.text),
        },
      ],
    );
    assert.deepEqual(first.signOff, [
      { pr: PR, issue: 5, created: false, added: 2 },
    ]);

    const second = emptySignOffReport();
    recordSignOff(PR, HEAD, io, second);
    assert.equal(store.writes.length, 1);
    assert.deepEqual(second, emptySignOffReport());
  });

  // 20a
  test('an unreadable lookup records the reason and the lines, and writes nothing', () => {
    const reason = 'more than one Sign-off Issue is open (#5, #6)';
    const store = emptyStore({ unreadable: reason });
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.deepEqual(report.signOffFailures, [
      { pr: PR, reason, unwritten: [A, B].map(renderSignOffLine) },
    ]);
    assert.deepEqual(store.writes, []);
  });

  // 20b
  test('an existing body outside the fixed form records a failure, and nothing is written over it', () => {
    const store = emptyStore({
      issue: { number: 5, body: 'Not a Sign-off Issue.' },
    });
    const report = emptySignOffReport();
    recordSignOff(PR, HEAD, fakeIo(readOf([STAGING]), store), report);
    assert.deepEqual(report.signOffFailures, [
      {
        pr: PR,
        reason:
          'the Sign-off Issue #5 is not in the fixed form, so nothing was written over it',
        unwritten: [renderSignOffLine(A)],
      },
    ]);
    assert.deepEqual(store.writes, []);
  });

  // 21a
  test('a read-back that lacks the lines (a concurrent writer) triggers one more write, and the added count is right', () => {
    const store = emptyStore({
      issue: { number: 5, body: renderSignOffIssue([]) },
      lostEdits: 1,
    });
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.deepEqual(
      store.writes.map((w) => w.number),
      [5, 5],
    );
    assert.deepEqual(report.signOff, [
      { pr: PR, issue: 5, created: false, added: 2 },
    ]);
    assert.deepEqual(report.signOffFailures, []);
  });

  // 21b
  test('a read-back that always lacks the lines fails after two writes, with the unwritten lines', () => {
    const store = emptyStore({
      issue: { number: 5, body: renderSignOffIssue([]) },
      lostEdits: Infinity,
    });
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.equal(store.writes.length, 2);
    assert.deepEqual(report.signOff, []);
    assert.deepEqual(report.signOffFailures, [
      {
        pr: PR,
        reason: 'the Sign-off Issue #5 did not keep the lines written to it',
        unwritten: [A, B].map(renderSignOffLine),
      },
    ]);
  });

  // 21c (revision): a refused edit lists only the lines not yet present.
  test('a refused edit records a failure listing only the lines not yet in the issue', () => {
    const store = emptyStore({
      issue: { number: 5, body: renderSignOffIssue([A]) },
      refuseEdit: true,
    });
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.equal(store.writes.length, 1);
    assert.deepEqual(report.signOff, []);
    assert.deepEqual(report.signOffFailures, [
      {
        pr: PR,
        reason: 'the Sign-off Issue #5 could not be edited',
        unwritten: [renderSignOffLine(B)],
      },
    ]);
  });

  // 21d (revision): the issue is gone on read-back, so the failure lists both lines.
  test('a read-back that finds no Sign-off Issue after the write records a failure with both lines', () => {
    const store = emptyStore({
      issue: { number: 5, body: renderSignOffIssue([]) },
      closeOnWrite: true,
    });
    const report = emptySignOffReport();
    recordSignOff(
      PR,
      HEAD,
      fakeIo(readOf([STAGING, PRODUCTION]), store),
      report,
    );
    assert.equal(store.writes.length, 1);
    assert.deepEqual(report.signOff, []);
    assert.deepEqual(report.signOffFailures, [
      {
        pr: PR,
        reason: 'the Sign-off Issue #5 could not be read back after the write',
        unwritten: [A, B].map(renderSignOffLine),
      },
    ]);
  });

  // 22a (revision): every entry unsafe means nothing is looked up or written.
  test('when every entry is unsafe, the issue is never looked up and nothing is written', () => {
    const unsafe: Check = {
      place: 'staging',
      text: 'Check the total --> twice',
    };
    const store = emptyStore();
    const report = emptySignOffReport();
    recordSignOff(PR, HEAD, fakeIo(readOf([unsafe]), store), report);
    assert.equal(report.signOffFailures.length, 1);
    assert.match(report.signOffFailures[0].reason, /could forge another line/);
    assert.deepEqual(report.signOffFailures[0].unwritten, [
      renderSignOffLine(entryOf(unsafe)),
    ]);
    assert.equal(store.lookups, 0);
    assert.deepEqual(store.writes, []);
  });

  // 22
  test('an entry whose text holds --> is listed as a failure, and the safe entries are still written', () => {
    const unsafe: Check = {
      place: 'staging',
      text: 'Check the total --> twice',
    };
    const store = emptyStore();
    const report = emptySignOffReport();
    recordSignOff(PR, HEAD, fakeIo(readOf([unsafe, STAGING]), store), report);
    assert.equal(report.signOffFailures.length, 1);
    assert.match(report.signOffFailures[0].reason, /could forge another line/);
    assert.deepEqual(report.signOffFailures[0].unwritten, [
      renderSignOffLine(entryOf(unsafe)),
    ]);
    assert.equal(store.writes.length, 1);
    assert.deepEqual(
      parseSignOffIssue(store.writes[0].body)?.checks.map((c) => c.text),
      [STAGING.text],
    );
    assert.deepEqual(report.signOff, [
      { pr: PR, issue: NEW_ISSUE, created: true, added: 1 },
    ]);
  });

  // 23
  test('renderSignOffReport renders the added line, the note, and a failure with each unwritten line below it', () => {
    const report: SignOffReport = {
      signOff: [
        { pr: 7, issue: 12, created: true, added: 1 },
        { pr: 8, issue: 12, created: false, added: 2 },
      ],
      signOffNotes: [
        { pr: 9, reason: 'the QA Report copied records a failure' },
      ],
      signOffFailures: [
        {
          pr: 7,
          reason: 'the Sign-off Issue #12 could not be edited',
          unwritten: ['- [ ] [staging] line A', '- [ ] [production] line B'],
        },
      ],
    };
    assert.deepEqual(renderSignOffReport(report), [
      'Sign-off Issue #12: added 1 Person Check from #7 (created).',
      'Sign-off Issue #12: added 2 Person Checks from #8.',
      'Note for #9: the QA Report copied records a failure.',
      'Sign-off Issue not written for #7 (merged; the merge stands): the Sign-off Issue #12 could not be edited. Add these lines by hand:',
      '- [ ] [staging] line A',
      '- [ ] [production] line B',
    ]);
  });
});

// ------------------------------------------------ the Cut (ADR 0151 decisions 7 and 8)

describe('freezeSignOffBody', () => {
  const FROZEN_LINE = renderSignOffFrozen('v1.2.3');

  // 1
  test('an unfrozen body gets the frozen line right after the marker, and every other line is kept', () => {
    const body = sectionBody(renderSignOffLine(A));
    const frozen = freezeSignOffBody(body, 'v1.2.3');
    assert.equal(
      frozen,
      [SIGNOFF_ISSUE_MARKER, FROZEN_LINE, ...body.split('\n').slice(1)].join(
        '\n',
      ),
    );
    assert.deepEqual(parseSignOffIssue(frozen)?.frozen, { version: 'v1.2.3' });
  });

  // 2
  test('a CRLF body keeps its CRLF line endings after the freeze', () => {
    const body = sectionBody(renderSignOffLine(A)).replace(/\n/g, '\r\n');
    assert.equal(
      freezeSignOffBody(body, 'v1.2.3'),
      [SIGNOFF_ISSUE_MARKER, FROZEN_LINE, ...body.split('\r\n').slice(1)].join(
        '\r\n',
      ),
    );
  });

  // 3
  test('null for a body outside the fixed form, and for a body already frozen, so nothing is written over either', () => {
    assert.equal(freezeSignOffBody('not a Sign-off Issue', 'v1.2.3'), null);
    const frozen = freezeSignOffBody(
      sectionBody(renderSignOffLine(A)),
      'v1.2.3',
    );
    assert.equal(freezeSignOffBody(frozen ?? '', 'v1.2.4'), null);
  });
});

describe('renderFrozenSignOffIssue and renderCarriedLine', () => {
  // 1
  test('a frozen body round-trips: its version, and every carried check with its Pull Request, place, text and key, unticked', () => {
    const checks: SignOffCheck[] = [
      {
        ...A,
        key: signOffKey('staging', 'Check the invoice email'),
        checked: false,
      },
      {
        pr: 8,
        place: 'production',
        text: 'Confirm the tax · line',
        reportUrl: COMMENT_URL,
        key: signOffKey('production', 'Confirm the tax · line'),
        checked: true,
      },
    ];
    const parsed = parseSignOffIssue(
      renderFrozenSignOffIssue('v1.2.3', checks),
    );
    assert.deepEqual(parsed?.frozen, { version: 'v1.2.3' });
    assert.deepEqual(
      parsed?.checks,
      checks.map((c) => ({ ...c, checked: false })),
    );
  });

  // 2
  test('a carried line keeps the key of its original trailer when the visible text was edited, where renderSignOffLine would hash the new text', () => {
    const check: SignOffCheck = {
      pr: 7,
      place: 'staging',
      text: 'Check the invoice email, reworded',
      reportUrl: COMMENT_URL,
      key: signOffKey('staging', 'Check the invoice email'),
      checked: false,
    };
    assert.ok(
      renderCarriedLine(check).endsWith(
        `<!-- signoff-check pr=7 key=${check.key} -->`,
      ),
    );
    assert.ok(
      renderSignOffLine(check).endsWith(
        `<!-- signoff-check pr=7 key=${signOffKey('staging', check.text)} -->`,
      ),
    );
  });
});

describe('addCarriedToSignOffIssue', () => {
  const carried: SignOffCheck = {
    pr: 7,
    place: 'staging',
    text: 'Check the invoice email',
    reportUrl: COMMENT_URL,
    key: signOffKey('staging', 'Check the invoice email'),
    checked: true,
  };

  // 1
  test('adds a carried check unticked with its original key after the section, and a repeat adds nothing and returns the same body', () => {
    const once = addCarriedToSignOffIssue(sectionBody(renderSignOffLine(B)), [
      carried,
    ]);
    assert.ok(once);
    assert.deepEqual(
      once.added.map((c) => c.key),
      [carried.key],
    );
    assert.deepEqual(
      parseSignOffIssue(once.body)?.checks.map((c) => [c.checked, c.key]),
      [
        [false, signOffKey(B.place, B.text)],
        [false, carried.key],
      ],
    );
    assert.deepEqual(addCarriedToSignOffIssue(once.body, [carried]), {
      body: once.body,
      added: [],
    });
  });

  // 2
  test('a check whose id the body already holds is not added again, and a body outside the fixed form gives null', () => {
    const body = sectionBody(renderSignOffLine(A));
    assert.deepEqual(addCarriedToSignOffIssue(body, [carried]), {
      body,
      added: [],
    });
    assert.equal(
      addCarriedToSignOffIssue('not a Sign-off Issue', [carried]),
      null,
    );
  });
});

describe('findSignOffIssue and a frozen body', () => {
  // 1
  test('a frozen body is skipped, so the next merge opens a fresh issue', () => {
    const frozen = freezeSignOffBody(
      sectionBody(renderSignOffLine(A)),
      'v1.2.3',
    );
    assert.deepEqual(
      findSignOffIssue(
        [{ number: 4, body: frozen, author: { login: TRUSTED } }],
        TRUSTED,
      ),
      { status: 'none' },
    );
  });

  // 2
  test('a body with two frozen lines does not parse, so it is still found and the train refuses to write it', () => {
    const body = [
      SIGNOFF_ISSUE_MARKER,
      renderSignOffFrozen('v1.2.3'),
      renderSignOffFrozen('v1.2.4'),
      '',
      SIGNOFF_SECTION_HEADING,
      '',
      renderSignOffLine(A),
    ].join('\n');
    assert.deepEqual(
      findSignOffIssue(
        [{ number: 4, body, author: { login: TRUSTED } }],
        TRUSTED,
      ),
      { status: 'found', number: 4, body },
    );
    assert.equal(addToSignOffIssue(body, [B]), null);
  });
});

describe('the carried comment (renderCarriedComment, parseCarriedComment)', () => {
  const MARKER = '<!-- signoff-carried to=#42 version=v1.2.3 -->';

  // 1
  test('a rendered comment parses back to the issue it went to and its version, and names each carried id', () => {
    const comment = renderCarriedComment(42, 'v1.2.3', [
      '7:0123456789ab',
      '8:ba9876543210',
    ]);
    assert.equal(comment.split('\n')[0], MARKER);
    assert.deepEqual(parseCarriedComment(comment), {
      to: 42,
      version: 'v1.2.3',
    });
    assert.deepEqual(parseCarriedComment(`${MARKER}\r\nbody`), {
      to: 42,
      version: 'v1.2.3',
    });
    assert.ok(comment.includes('`7:0123456789ab`, `8:ba9876543210`'));
  });

  // 2
  test('the first line must be exactly the marker: extra text, a bad version, #0, another case, a missing #, or leading junk is not a carried comment', () => {
    const bad = [
      `${MARKER} and more`,
      '<!-- signoff-carried to=#42 version=v1.2 -->',
      '<!-- signoff-carried to=#0 version=v1.2.3 -->',
      '<!-- SIGNOFF-CARRIED to=#42 version=v1.2.3 -->',
      `x ${MARKER}`,
      '<!-- signoff-carried to=42 version=v1.2.3 -->',
      '<!-- signoff-carried to=#42 version=1.2.3 -->',
    ];
    for (const body of bad) assert.equal(parseCarriedComment(body), null, body);
  });

  // 3
  test('a marker that is not on the first line is ignored', () => {
    assert.equal(parseCarriedComment(`Prose first.\n${MARKER}`), null);
  });

  // 4
  test('renderCarriedComment throws for a version that is not vX.Y.Z', () => {
    assert.throws(
      () => renderCarriedComment(42, '1.2.3', []),
      /not a release version/,
    );
  });
});

describe('signOffFrozenTitle', () => {
  // 1
  test('names the version the issue is frozen for', () => {
    assert.equal(
      signOffFrozenTitle('v1.2.3'),
      'Sign-off: Person Checks for v1.2.3',
    );
    assert.equal(
      SIGNOFF_ISSUE_TITLE,
      'Sign-off: Person Checks for the next Cut',
    );
  });
});
