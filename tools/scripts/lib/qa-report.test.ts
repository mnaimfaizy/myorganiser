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
  type PersonCheck,
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

/**
 * Fills a template the way a session would: the SHA, both counts (derived from
 * the checks), and the placeholder Person Check bullet replaced by the checks
 * it lists, or by `None.` when there are none.
 */
function fillTemplate(text: string, checks: PersonCheck[] = []): string {
  const local = checks.filter((c) => c.place === 'local').length;
  const deferred = checks.length - local;
  const lines = text
    .split('\n')
    .flatMap((line) =>
      line === '- [local|staging|production] <what a person must check>'
        ? checks.length === 0
          ? ['None.']
          : checks.map((c) => `- [${c.place}] ${c.text}`)
        : [line],
    );
  return lines
    .join('\n')
    .replaceAll('<40-hex sha>', SHA)
    .replaceAll('<local n>', String(local))
    .replaceAll('<staging+production n>', String(deferred));
}

describe('parseQaReport: the template the Skill prints', () => {
  test('the printed template parses as passed, with its commit and no item left', () => {
    const { template } = qaReportSection();
    assert.deepEqual(parseQaReport(fillTemplate(template)), {
      result: 'passed',
      commit: SHA,
      leftForPerson: 0,
      deferred: 0,
      checks: [],
    });
  });

  test('the template with one local and one staging item parses with both counts and both lines', () => {
    const { template } = qaReportSection();
    const checks: PersonCheck[] = [
      { place: 'local', text: 'Confirm the banner on a phone' },
      { place: 'staging', text: 'Check the invoice email' },
    ];
    assert.deepEqual(parseQaReport(fillTemplate(template, checks)), {
      result: 'passed',
      commit: SHA,
      leftForPerson: 1,
      deferred: 1,
      checks,
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
      parseQaReport(reportBody(QA_REPORT_MARKER, '', fillTemplate(failedSpan))),
      {
        result: 'failed',
        commit: SHA,
        leftForPerson: 0,
        deferred: 0,
        checks: [],
      },
    );
    assert.deepEqual(
      parseQaReport(reportBody(QA_REPORT_MARKER, '', fillTemplate(noneSpan))),
      {
        result: 'none-needed',
        commit: SHA,
        leftForPerson: 0,
        deferred: 0,
        checks: [],
      },
    );
  });
});

// ------------------------------------- the template the qa-plan Skill prints

const QA_PLAN_SKILL_PATH = '.agents/skills/qa-plan/SKILL.md';

/** The qa-plan step that posts a PRD Pull Request's QA Report. */
function qaPlanReportTemplate(): string {
  const lines = readFileSync(join(REPO_ROOT, QA_PLAN_SKILL_PATH), 'utf8').split(
    /\r?\n/,
  );
  const start = lines.findIndex((line) =>
    line.startsWith('### E5. Post the QA Report'),
  );
  assert.notEqual(start, -1, 'qa-plan has the Post the QA Report step');
  const open = lines.findIndex(
    (line, index) => index > start && line.trim() === '```md',
  );
  assert.notEqual(open, -1, 'the step prints a ```md template');
  const close = lines.findIndex(
    (line, index) => index > open && line.trim() === '```',
  );
  assert.notEqual(close, -1, 'the ```md template is closed');
  return lines.slice(open + 1, close).join('\n');
}

describe('parseQaReport: the template the qa-plan Skill prints', () => {
  test('parses as passed, with its commit and the Person Checks left, split by place', () => {
    const checks: PersonCheck[] = [
      { place: 'local', text: 'Confirm the banner on a phone' },
      { place: 'local', text: 'Confirm the reset link' },
      { place: 'production', text: 'Check the invoice PDF' },
    ];
    assert.deepEqual(
      parseQaReport(fillTemplate(qaPlanReportTemplate(), checks)),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 2,
        deferred: 1,
        checks,
      },
    );
  });

  test('with result=failed it parses as failed', () => {
    const failed = fillTemplate(qaPlanReportTemplate()).replace(
      'result=passed',
      'result=failed',
    );
    assert.deepEqual(parseQaReport(failed), {
      result: 'failed',
      commit: SHA,
      leftForPerson: 0,
      deferred: 0,
      checks: [],
    });
  });
});

describe('the Skills carry the Not proven rule', () => {
  test('finish-standalone-runs counts Not proven and unfiled pre-existing items', () => {
    const { prose } = qaReportSection();
    assert.match(prose, /\*\*Not proven\*\*/);
    assert.match(prose, /\*\*FAIL: pre-existing\*\*[^.]*not yet filed/);
    assert.match(prose, /with its Place and counted/);
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
    [
      'the deferred field before the left-for-person field',
      `QA Report: result=passed; commit=${SHA}; deferred=0; left-for-person=0`,
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

  test('a deferred count with a leading zero is unparseable, even when a line matches it', () => {
    assert.equal(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          `QA Report: result=passed; commit=${SHA}; left-for-person=0; deferred=01`,
          '',
          '### Left for a person',
          '- [staging] Check the invoice email',
        ),
      ),
      null,
    );
  });

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
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 0,
        deferred: 0,
        checks: [],
      },
    );
  });
});

// ------------------------------------ the Person Check section (ADR 0151)

describe('parseQaReport: a new header and its Person Check section', () => {
  const SECTION = '### Left for a person';
  const newHeader = (left: number, deferred: number): string =>
    `QA Report: result=passed; commit=${SHA}; left-for-person=${left}; deferred=${deferred}`;

  test('local and deferred counts parse, with each check in order, its place and its trimmed text', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(1, 2),
          '',
          '## QA Report',
          '',
          SECTION,
          '',
          '- [local] Confirm the banner   ',
          '- [staging] Check the invoice email',
          '- [production] Check the invoice PDF',
        ),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 1,
        deferred: 2,
        checks: [
          { place: 'local', text: 'Confirm the banner' },
          { place: 'staging', text: 'Check the invoice email' },
          { place: 'production', text: 'Check the invoice PDF' },
        ],
      },
    );
  });

  test('a local count that differs from the local lines is unparseable', () => {
    assert.equal(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(2, 0),
          '',
          SECTION,
          '- [local] Confirm the banner',
        ),
      ),
      null,
    );
  });

  test('a deferred count that differs from the staging and production lines is unparseable', () => {
    assert.equal(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(0, 1),
          '',
          SECTION,
          '- [staging] Check the invoice email',
          '- [staging] Check the invoice PDF',
        ),
      ),
      null,
    );
  });

  test('a count above zero with no Person Check section is unparseable', () => {
    assert.equal(
      parseQaReport(
        reportBody(QA_REPORT_MARKER, '', newHeader(1, 0), '', '## QA Report'),
      ),
      null,
    );
  });

  test('a Person Check line beyond the counts is unparseable', () => {
    assert.equal(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(1, 0),
          '',
          SECTION,
          '- [local] Confirm the banner',
          '- [local] Confirm the reset link',
        ),
      ),
      null,
    );
  });

  test('zero counts parse with no section at all', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(QA_REPORT_MARKER, '', newHeader(0, 0), '', '## QA Report'),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 0,
        deferred: 0,
        checks: [],
      },
    );
  });

  test('zero counts with None. under the section parse with no checks', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(QA_REPORT_MARKER, '', newHeader(0, 0), '', SECTION, 'None.'),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 0,
        deferred: 0,
        checks: [],
      },
    );
  });

  test('zero counts with an empty section parse with no checks', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(0, 0),
          '',
          SECTION,
          '',
          '## QA Report',
        ),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 0,
        deferred: 0,
        checks: [],
      },
    );
  });

  test('zero counts with plain prose under the section parse with no checks', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(0, 0),
          '',
          SECTION,
          'Nothing left to check by hand.',
        ),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 0,
        deferred: 0,
        checks: [],
      },
    );
  });

  test('prose under the section is ignored when the counts match the lines', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(1, 0),
          '',
          SECTION,
          'Check the banner on a phone.',
          '- [local] Confirm the banner',
          'Thanks.',
        ),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 1,
        deferred: 0,
        checks: [{ place: 'local', text: 'Confirm the banner' }],
      },
    );
  });

  const notAPersonCheck: [string, string][] = [
    ['a capitalised Place', '- [Staging] Check the invoice email'],
    ['an abbreviated Place', '- [prod] Check the invoice PDF'],
    ['no Place', '- Check the invoice PDF'],
    ['no space after the bracket', '- [staging]Check the invoice email'],
    ['blank text', '- [staging]  '],
    ['a star bullet', '* [local] Confirm the banner'],
    ['a numbered bullet', '1. [local] Confirm the banner'],
    ['two spaces after the dash', '-  [local] Confirm the banner'],
    ['two spaces after the bracket', '- [local]  Confirm the banner'],
  ];
  for (const [name, line] of notAPersonCheck) {
    test(`a top-level item with ${name} makes the whole report unparseable`, () => {
      assert.equal(
        parseQaReport(
          reportBody(QA_REPORT_MARKER, '', newHeader(0, 0), '', SECTION, line),
        ),
        null,
      );
    });
  }

  test('an indented line under the section is a continuation, not a check, and is ignored', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(0, 0),
          '',
          SECTION,
          '    - [staging] Check the invoice email',
          '    - [Staging] Check the invoice PDF',
        ),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 0,
        deferred: 0,
        checks: [],
      },
    );
  });

  // Only a column-0 line is a list item; the same text indented is continuation.
  const itemText = ['- [bogus] x', '- x', '1. x'];
  for (const indent of [1, 2, 3, 4]) {
    for (const item of itemText) {
      test(`a ${indent}-space indented "${item}" under the section is continuation and is ignored`, () => {
        assert.deepEqual(
          parseQaReport(
            reportBody(
              QA_REPORT_MARKER,
              '',
              newHeader(0, 0),
              '',
              SECTION,
              `${' '.repeat(indent)}${item}`,
            ),
          ),
          {
            result: 'passed',
            commit: SHA,
            leftForPerson: 0,
            deferred: 0,
            checks: [],
          },
        );
      });
    }
  }

  for (const item of itemText) {
    test(`"${item}" in column 0 under the section makes the whole report unparseable`, () => {
      assert.equal(
        parseQaReport(
          reportBody(QA_REPORT_MARKER, '', newHeader(0, 0), '', SECTION, item),
        ),
        null,
      );
    });
  }

  test('lines and headings inside a code fence are not read', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(1, 0),
          '',
          '```md',
          SECTION,
          '- [Staging] Example',
          '```',
          '',
          SECTION,
          '- [local] Confirm the banner',
        ),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 1,
        deferred: 0,
        checks: [{ place: 'local', text: 'Confirm the banner' }],
      },
    );
  });

  test('lines and headings inside a tilde fence are not read', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(1, 0),
          '',
          '~~~md',
          SECTION,
          '- [Staging] Example',
          '~~~',
          '',
          SECTION,
          '- [local] Confirm the banner',
        ),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 1,
        deferred: 0,
        checks: [{ place: 'local', text: 'Confirm the banner' }],
      },
    );
  });

  test('a second Left for a person heading is unparseable, even after another heading', () => {
    // The counts match both sections' items, so only the second heading can fail it.
    assert.equal(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(2, 0),
          '',
          SECTION,
          '- [local] Confirm the banner',
          '## Notes',
          SECTION,
          '- [local] Confirm the reset link',
        ),
      ),
      null,
    );
  });

  test('the section ends at the next heading: items after it are neither counted nor read', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          newHeader(1, 0),
          '',
          SECTION,
          '- [local] Confirm the banner',
          '## Notes',
          '- [local] Confirm the reset link',
          '- nonsense',
        ),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 1,
        deferred: 0,
        checks: [{ place: 'local', text: 'Confirm the banner' }],
      },
    );
  });
});

describe('parseQaReport: a legacy header and the no-manual-QA header', () => {
  const SECTION = '### Left for a person';
  const legacyHeader = `QA Report: result=passed; commit=${SHA}; left-for-person=2`;

  test('a legacy header reads its count as local with no checks, even when its lines carry no Place', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          legacyHeader,
          '',
          SECTION,
          '- first thing',
          '- second thing',
        ),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 2,
        deferred: 0,
        checks: [],
      },
    );
  });

  test('a legacy header does not read its lines: staging lines and a malformed line change nothing', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          legacyHeader,
          '',
          SECTION,
          '- [staging] Check the invoice email',
          '- [staging] Check the invoice PDF',
          '- [Prod] bogus',
        ),
      ),
      {
        result: 'passed',
        commit: SHA,
        leftForPerson: 2,
        deferred: 0,
        checks: [],
      },
    );
  });

  test('a no-manual-QA header reads with no deferred count and no checks, even with a section under it', () => {
    assert.deepEqual(
      parseQaReport(
        reportBody(
          QA_REPORT_MARKER,
          '',
          `QA Report: no manual QA needed; commit=${SHA}`,
          '',
          SECTION,
          '- [local] Confirm the banner',
        ),
      ),
      {
        result: 'none-needed',
        commit: SHA,
        leftForPerson: 0,
        deferred: 0,
        checks: [],
      },
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
