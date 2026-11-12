// Contract Suite for the QA Report the Merge Train reads (ADR 0148 decision 7,
// #1527): the header parser, and the staleness rule. The fake-GitHub reader
// that feeds these is in merge-train-auto.test.ts.
//
// Run with: node --test tools/scripts/lib/qa-report.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseQaReport,
  type PrCommit,
  QA_REPORT_MARKER,
  qaStaleness,
} from './qa-report.ts';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const SKILL_PATH = '.agents/skills/finish-standalone-runs/SKILL.md';
/** A full, lowercase, non-random 40-character SHA. */
const SHA = '0123456789abcdef'.repeat(2) + '01234567';

const reportBody = (...lines: string[]): string => lines.join('\n');

// ----------------------------------------------- the template the Skill prints

/** The QA Report section of the Skill: its prose, and its fenced `md` template. */
function qaReportSection(): { prose: string; template: string } {
  const lines = readFileSync(join(REPO_ROOT, SKILL_PATH), 'utf8').split(
    /\r?\n/,
  );
  const start = lines.findIndex((line) => line.trim() === '## The QA Report');
  assert.notEqual(start, -1, 'the Skill has a ## The QA Report section');
  const open = lines.findIndex(
    (line, index) => index > start && line.trim() === '```md',
  );
  assert.notEqual(open, -1, 'the section prints a ```md template');
  const close = lines.findIndex(
    (line, index) => index > open && line.trim() === '```',
  );
  assert.notEqual(close, -1, 'the ```md template is closed');
  return {
    prose: lines.slice(start, open).join('\n'),
    template: lines.slice(open + 1, close).join('\n'),
  };
}

/** Fills the Skill's placeholders the way a session would. */
const fillPlaceholders = (text: string, leftForPerson: number): string =>
  text.replaceAll('<40-hex sha>', SHA).replaceAll('<n>', String(leftForPerson));

describe('parseQaReport: the template the Skill prints', () => {
  test('the printed template parses as passed, with its commit and no item left', () => {
    const { template } = qaReportSection();
    assert.deepEqual(parseQaReport(fillPlaceholders(template, 0)), {
      result: 'passed',
      commit: SHA,
      leftForPerson: 0,
    });
  });

  test('the same template with two items left parses as passed with two left', () => {
    const { template } = qaReportSection();
    assert.deepEqual(parseQaReport(fillPlaceholders(template, 2)), {
      result: 'passed',
      commit: SHA,
      leftForPerson: 2,
    });
  });

  test('the failed and no-manual-QA forms, taken from the prose bullets, parse as the Skill says', () => {
    const { prose, template } = qaReportSection();
    const headerSpans = [...prose.matchAll(/`(QA Report:[^`]*)`/g)].map(
      (match) => match[1],
    );
    assert.equal(headerSpans.length, 2, 'the prose names two header forms');
    const passedSpan = headerSpans.find((span) =>
      span.includes('result=passed'),
    );
    const noneSpan = headerSpans.find((span) =>
      span.includes('no manual QA needed'),
    );
    assert.ok(passedSpan, 'the prose names the passed form');
    assert.ok(noneSpan, 'the prose names the no-manual-QA form');
    // The prose names `result=failed` "in the same place" as passed; the
    // failed header is the passed one with that one word changed.
    assert.match(prose, /`result=failed`/);
    // The passed bullet is the template's header line, not a second copy.
    assert.ok(
      template.split('\n').includes(passedSpan),
      'the template header is the bullet form',
    );

    const failedSpan = passedSpan.replace('result=passed', 'result=failed');
    assert.deepEqual(
      parseQaReport(
        reportBody(QA_REPORT_MARKER, '', fillPlaceholders(failedSpan, 0)),
      ),
      {
        result: 'failed',
        commit: SHA,
        leftForPerson: 0,
      },
    );
    assert.deepEqual(
      parseQaReport(
        reportBody(QA_REPORT_MARKER, '', fillPlaceholders(noneSpan, 0)),
      ),
      {
        result: 'none-needed',
        commit: SHA,
        leftForPerson: 0,
      },
    );
  });
});

describe('parseQaReport: a header in any other form is unparseable', () => {
  const malformed: [string, string][] = [
    [
      'a short sha (39 characters)',
      `QA Report: result=passed; commit=${SHA.slice(1)}; left-for-person=0`,
    ],
    [
      'an uppercase sha',
      `QA Report: result=passed; commit=${SHA.toUpperCase()}; left-for-person=0`,
    ],
    [
      'an extra field',
      `QA Report: result=passed; commit=${SHA}; left-for-person=0; qa=ok`,
    ],
    [
      'the fields in another order',
      `QA Report: result=passed; left-for-person=0; commit=${SHA}`,
    ],
    [
      'a negative count',
      `QA Report: result=passed; commit=${SHA}; left-for-person=-1`,
    ],
    [
      'a non-numeric count',
      `QA Report: result=passed; commit=${SHA}; left-for-person=two`,
    ],
    [
      'a count with a leading zero',
      `QA Report: result=passed; commit=${SHA}; left-for-person=01`,
    ],
    [
      'a no-manual-QA header with an extra count',
      `QA Report: no manual QA needed; commit=${SHA}; left-for-person=0`,
    ],
    [
      'an unknown result',
      `QA Report: result=maybe; commit=${SHA}; left-for-person=0`,
    ],
  ];
  for (const [name, header] of malformed) {
    test(`${name} is unparseable`, () => {
      assert.equal(
        parseQaReport(reportBody(QA_REPORT_MARKER, '', header)),
        null,
      );
    });
  }

  test('a heading before the header makes the header not the first non-blank line', () => {
    const header = `QA Report: result=passed; commit=${SHA}; left-for-person=0`;
    assert.equal(
      parseQaReport(
        reportBody(QA_REPORT_MARKER, '', '## QA Report', '', header),
      ),
      null,
    );
  });

  test('a marker that is not the first line (quoted in prose) is not a report', () => {
    const header = `QA Report: result=passed; commit=${SHA}; left-for-person=0`;
    assert.equal(
      parseQaReport(
        reportBody('Quoting the marker:', QA_REPORT_MARKER, '', header),
      ),
      null,
    );
  });

  test('a blank, null or undefined body is unparseable, and so is a marker with no header', () => {
    assert.equal(parseQaReport(''), null);
    assert.equal(parseQaReport(null), null);
    assert.equal(parseQaReport(undefined), null);
    assert.equal(parseQaReport(reportBody(QA_REPORT_MARKER)), null);
    assert.equal(parseQaReport(reportBody(QA_REPORT_MARKER, '  ', '')), null);
  });
});

describe('parseQaReport: layout the Skill allows', () => {
  const header = `QA Report: result=passed; commit=${SHA}; left-for-person=0`;

  test('a CRLF body parses like the LF one', () => {
    const lf = reportBody(QA_REPORT_MARKER, '', header, '', '## QA Report');
    assert.deepEqual(
      parseQaReport(lf.replaceAll('\n', '\r\n')),
      parseQaReport(lf),
    );
    assert.notEqual(parseQaReport(lf), null);
  });

  test('blank lines between the marker and the header are accepted', () => {
    assert.deepEqual(
      parseQaReport(reportBody(QA_REPORT_MARKER, '', '  ', header)),
      { result: 'passed', commit: SHA, leftForPerson: 0 },
    );
  });
});

// ------------------------------------------------------------- staleness

const id = (pair: string): string => pair.repeat(20);
const BASE = id('10');
const QA = id('11');
const UPDATE = id('12');
const NEXT = id('13');
const ORPHAN = id('14');
const MERGE_BEFORE = id('15');
const MAIN = id('20');
const OTHER = id('21');

const commit = (sha: string, ...parents: string[]): PrCommit => ({
  sha,
  parents,
});

/** `isOnMain` that says yes only for the listed commits, and records each ask. */
const onMain = (...mains: string[]) => {
  const asked: string[] = [];
  const isOnMain = (sha: string): boolean => {
    asked.push(sha);
    return mains.includes(sha);
  };
  return { isOnMain, asked };
};

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}

describe('qaStaleness: the commit the report names against the head', () => {
  test('a report naming the head is current, and isOnMain is never asked', () => {
    const { isOnMain, asked } = onMain();
    assert.deepEqual(
      qaStaleness(QA, QA, [commit(BASE), commit(QA, BASE)], isOnMain),
      { status: 'current' },
    );
    assert.deepEqual(asked, []);
  });

  test('a branch commit written after the named one is stale, and names that commit', () => {
    const { isOnMain, asked } = onMain();
    assert.deepEqual(
      qaStaleness(
        QA,
        NEXT,
        [commit(BASE), commit(QA, BASE), commit(NEXT, QA)],
        isOnMain,
      ),
      { status: 'stale', byCommit: NEXT },
    );
    assert.deepEqual(asked, [], 'a single-parent commit needs no main check');
  });

  test('an update merge of main after the named one is current', () => {
    const { isOnMain, asked } = onMain(MAIN);
    assert.deepEqual(
      qaStaleness(
        QA,
        UPDATE,
        [commit(BASE), commit(QA, BASE), commit(UPDATE, QA, MAIN)],
        isOnMain,
      ),
      { status: 'current' },
    );
    assert.deepEqual(asked, [MAIN]);
  });

  test('a hand merge of another branch after the named one is stale, even though it has two parents', () => {
    const { isOnMain } = onMain(MAIN);
    assert.deepEqual(
      qaStaleness(
        QA,
        UPDATE,
        [commit(BASE), commit(QA, BASE), commit(UPDATE, QA, OTHER)],
        isOnMain,
      ),
      { status: 'stale', byCommit: UPDATE },
    );
  });

  test('a branch commit after an update merge of main is stale', () => {
    const { isOnMain } = onMain(MAIN);
    assert.deepEqual(
      qaStaleness(
        QA,
        NEXT,
        [
          commit(BASE),
          commit(QA, BASE),
          commit(UPDATE, QA, MAIN),
          commit(NEXT, UPDATE),
        ],
        isOnMain,
      ),
      { status: 'stale', byCommit: NEXT },
    );
  });

  test('the order of the commit list does not change the verdict', () => {
    const cases: [
      string,
      PrCommit[],
      string,
      ReturnType<typeof qaStaleness>,
    ][] = [
      [
        'an update merge of main after the named one',
        [commit(BASE), commit(QA, BASE), commit(UPDATE, QA, MAIN)],
        UPDATE,
        { status: 'current' },
      ],
      [
        'a branch commit after an update merge of main',
        [
          commit(BASE),
          commit(QA, BASE),
          commit(UPDATE, QA, MAIN),
          commit(NEXT, UPDATE),
        ],
        NEXT,
        { status: 'stale', byCommit: NEXT },
      ],
      [
        'a hand merge of another branch',
        [commit(BASE), commit(QA, BASE), commit(UPDATE, QA, OTHER)],
        UPDATE,
        { status: 'stale', byCommit: UPDATE },
      ],
    ];
    for (const [name, list, head, expected] of cases) {
      for (const order of permutations(list)) {
        const { isOnMain } = onMain(MAIN);
        assert.deepEqual(
          qaStaleness(QA, head, order, isOnMain),
          expected,
          `${name}, order ${order.map((c) => c.sha.slice(0, 2)).join(' ')}`,
        );
      }
    }
  });

  test('a commit listed but not reachable from the head is ignored', () => {
    const { isOnMain } = onMain(MAIN);
    assert.deepEqual(
      qaStaleness(
        QA,
        UPDATE,
        [
          commit(BASE),
          commit(QA, BASE),
          commit(UPDATE, QA, MAIN),
          commit(ORPHAN, QA),
        ],
        isOnMain,
      ),
      { status: 'current' },
    );
  });

  test('a second parent that cannot be checked against main is unknown, naming it', () => {
    assert.deepEqual(
      qaStaleness(
        QA,
        UPDATE,
        [commit(BASE), commit(QA, BASE), commit(UPDATE, QA, MAIN)],
        () => null,
      ),
      {
        status: 'unknown',
        reason: 'it could not be checked whether `20202020` is on `main`',
      },
    );
  });

  test('a named commit the branch no longer has (a force-push) is unknown, naming it', () => {
    assert.deepEqual(
      qaStaleness(QA, NEXT, [commit(BASE), commit(NEXT, BASE)], () => false),
      {
        status: 'unknown',
        reason:
          'the QA Report names `11111111`, which is no longer on the branch',
      },
    );
  });

  test('a head the commit list does not hold is unknown, naming it', () => {
    assert.deepEqual(
      qaStaleness(QA, NEXT, [commit(BASE), commit(QA, BASE)], () => false),
      {
        status: 'unknown',
        reason: "the head `13131313` is not among the Pull Request's commits",
      },
    );
  });

  test('isOnMain is asked only for second parents of commits after the named one', () => {
    // A main merge before the named commit is part of what QA checked: no ask.
    const before = onMain(MAIN);
    assert.equal(
      qaStaleness(
        QA,
        NEXT,
        [
          commit(BASE),
          commit(MERGE_BEFORE, BASE, MAIN),
          commit(QA, MERGE_BEFORE),
          commit(NEXT, QA),
        ],
        before.isOnMain,
      ).status,
      'stale',
    );
    assert.deepEqual(before.asked, [], 'no main merge after the named commit');

    // The same main merge after the named commit is asked, once, for its second parent.
    const after = onMain(MAIN);
    assert.deepEqual(
      qaStaleness(
        QA,
        UPDATE,
        [commit(BASE), commit(QA, BASE), commit(UPDATE, QA, MAIN)],
        after.isOnMain,
      ),
      { status: 'current' },
    );
    assert.deepEqual(after.asked, [MAIN]);
  });
});
