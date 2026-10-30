/**
 * Contract Suite for the PR CI duration watch issue (PRD #1387, issue #1393).
 * It pins the fixed title the automation owns, the decision between a breach,
 * a recovery and a quiet week, and the state marker that makes a recovery
 * happen once. Summaries come from `summarizeCiDuration` over the shared
 * fixtures, so this suite cannot drift from the real summary shape.
 *
 * Run with: node --test tools/scripts/lib/ci-duration-watch-issue.test.ts
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MIN_SINGLE_LIBRARY_RUNS,
  SIGNAL_IDS,
  notEnoughDataSentence,
  renderCiDurationMeasurement,
  signalLine,
} from './ci-duration.ts';
import {
  WATCH_ISSUE_CREATE_LABELS,
  WATCH_ISSUE_TITLE,
  breachReport,
  findOpenWatchIssue,
  lastReportedState,
  notEnoughDataNote,
  recoveryAction,
  recoveryComment,
  watchAction,
} from './ci-duration-watch-issue.ts';
import {
  TRIAGE_STATE_LABELS,
  recoveryOutcomeSentence,
} from './nightly-e2e-rot-issue.ts';
import {
  fastRun,
  hotRun,
  job,
  measure,
  prRun,
  repeat,
} from './ci-duration-fixtures.ts';

const RUN_URL = 'https://github.com/mnaimfaizy/myorganiser/actions/runs/1';
// Outside the fixture window (2026-10-12 to 2026-10-26), so a report that
// ignored its `date` argument could not pass the date assertion.
const DATE = '2026-10-27';

// ---------------------------------------------------------------- fixtures

/** Ten breaching runs: every signal trips. The breach report's input. */
const breachingSummary = () => measure(repeat(MIN_SINGLE_LIBRARY_RUNS, hotRun));

/** Ten fast, fresh runs: within target. The recovery's input. */
const quietSummary = () => measure(repeat(MIN_SINGLE_LIBRARY_RUNS, fastRun));

/** Nine breaching runs: not enough data, so nothing is evaluated. */
const sparseSummary = () =>
  measure(repeat(MIN_SINGLE_LIBRARY_RUNS - 1, hotRun));

const breachBody = () =>
  breachReport({ summary: breachingSummary(), runUrl: RUN_URL, date: DATE });

const recoveredBody = (action: 'close' | 'comment' = 'comment') =>
  recoveryComment({
    action,
    summary: quietSummary(),
    runUrl: RUN_URL,
    date: DATE,
  });

// ------------------------------------------------------------ the constants

describe('the watch issue constants', () => {
  test('the title is the fixed title the automation owns', () => {
    assert.equal(
      WATCH_ISSUE_TITLE,
      '[automation] PR CI is over its five-minute target',
    );
  });

  test('a created watch issue carries needs-triage, which is a triage state label', () => {
    assert.deepEqual(WATCH_ISSUE_CREATE_LABELS, [
      'needs-triage',
      'github-actions',
    ]);
    assert.ok(
      (TRIAGE_STATE_LABELS as readonly string[]).includes(
        WATCH_ISSUE_CREATE_LABELS[0],
      ),
    );
  });
});

describe('finding the open watch issue', () => {
  test('finds the open issue with the exact title and ignores everything else', () => {
    const issues = [
      { number: 1, title: WATCH_ISSUE_TITLE, state: 'closed' },
      { number: 2, title: WATCH_ISSUE_TITLE, state: 'open', pull_request: {} },
      {
        number: 3,
        title: '[automation] PR CI is over its 5-minute target',
        state: 'open',
      },
      { number: 4, title: WATCH_ISSUE_TITLE, state: 'open' },
    ];
    assert.equal(findOpenWatchIssue(issues)?.number, 4);
  });

  test('a pull request with the same title is not the watch issue', () => {
    assert.equal(
      findOpenWatchIssue([
        { title: WATCH_ISSUE_TITLE, state: 'open', pull_request: {} },
      ]),
      undefined,
    );
  });

  test('an empty list has no watch issue', () => {
    assert.equal(findOpenWatchIssue([]), undefined);
  });
});

describe('what one weekly run does about the issue', () => {
  test('a breach reports, a clean window recovers, and a sparse window does nothing', () => {
    assert.equal(watchAction(breachingSummary()), 'report');
    assert.equal(watchAction(quietSummary()), 'recover');
    assert.equal(watchAction(sparseSummary()), 'none');
    // The sparse window is the breaching fixture with one run fewer, so the
    // same ten runs must be a report: the 'none' above is the cutoff, not a
    // different fixture.
    assert.equal(
      watchAction(measure(repeat(MIN_SINGLE_LIBRARY_RUNS, hotRun))),
      'report',
    );
  });

  test('ten Single-Library runs that never completed are not a clean window: the week does nothing and does not recover', () => {
    const unmeasurable = measure(
      repeat(MIN_SINGLE_LIBRARY_RUNS, () =>
        prRun({ jobs: [job('Lint', 0, null)] }),
      ),
    );
    assert.equal(unmeasurable.sample.singleLibrary, MIN_SINGLE_LIBRARY_RUNS);
    assert.equal(watchAction(unmeasurable), 'none');
    assert.notEqual(watchAction(unmeasurable), 'recover');
  });
});

describe('the breach report', () => {
  test('opens with the breached marker so it can be recognised later', () => {
    assert.ok(
      breachBody().startsWith('<!-- pr-ci-duration-watch:breached -->'),
    );
  });

  test('names every tripped signal with the decision to reopen', () => {
    const summary = breachingSummary();
    const body = breachBody();
    assert.equal(summary.signals.length, SIGNAL_IDS.length);
    for (const signal of summary.signals) {
      assert.ok(body.includes(`#${signal.decision}`), `#${signal.decision}`);
      assert.ok(body.includes(signal.title), signal.id);
    }
  });

  test('quotes the Single-Library p50 and names the run and its date', () => {
    const body = breachBody();
    // Twenty minutes at the median, from the shared hot run.
    assert.ok(body.includes('20m 00s'));
    assert.ok(body.includes(RUN_URL));
    assert.ok(body.includes(`on ${DATE},`));
  });

  test('prints each tripped signal as the line signalLine renders, so the issue and the measurement cannot drift', () => {
    const summary = breachingSummary();
    const body = breachBody();
    for (const signal of summary.signals) {
      assert.ok(body.includes(signalLine(signal)), signal.id);
    }
  });

  test('embeds the rendered measurement verbatim', () => {
    const summary = breachingSummary();
    assert.ok(
      breachReport({ summary, runUrl: RUN_URL, date: DATE }).includes(
        renderCiDurationMeasurement(summary).trimEnd(),
      ),
    );
  });
});

describe('the recovery comment', () => {
  test('opens with the recovered marker and names the run', () => {
    const body = recoveredBody();
    assert.ok(body.startsWith('<!-- pr-ci-duration-watch:recovered -->'));
    assert.ok(body.includes(RUN_URL));
  });

  test('a close outcome says the recovery closes the issue; a comment outcome says it stays open', () => {
    const closed = recoveredBody('close');
    const commented = recoveredBody('comment');
    assert.match(closed, /closes it\./);
    assert.doesNotMatch(closed, /stays open/);
    assert.match(commented, /stays open/);
    assert.doesNotMatch(commented, /closes it\./);
  });

  test('a recovery explains its outcome with the shared nightly sentence for that outcome only', () => {
    assert.ok(
      recoveredBody('close').includes(recoveryOutcomeSentence('close')),
    );
    assert.ok(
      recoveredBody('comment').includes(recoveryOutcomeSentence('comment')),
    );
    assert.ok(
      !recoveredBody('close').includes(recoveryOutcomeSentence('comment')),
    );
    assert.ok(
      !recoveredBody('comment').includes(recoveryOutcomeSentence('close')),
    );
  });

  test('recoveryAction closes an untriaged issue and comments on a triaged one', () => {
    assert.equal(recoveryAction([]), 'close');
    assert.equal(recoveryAction([{ name: 'github-actions' }]), 'close');
    assert.equal(recoveryAction([{ name: 'needs-triage' }]), 'comment');
  });
});

describe('the reported state of an issue', () => {
  test('a breach with no comments is breached', () => {
    assert.equal(
      lastReportedState({ body: breachBody(), comments: [] }),
      'breached',
    );
  });

  test('a recovery comment after a breach is recovered', () => {
    assert.equal(
      lastReportedState({
        body: breachBody(),
        comments: [{ body: recoveredBody() }],
      }),
      'recovered',
    );
  });

  test('a later breach after a recovery is breached, because comments read oldest first', () => {
    assert.equal(
      lastReportedState({
        body: recoveredBody(),
        comments: [{ body: breachBody() }],
      }),
      'breached',
    );
  });

  test('an issue with no marker anywhere is breached, waiting to hear the target is met', () => {
    assert.equal(
      lastReportedState({ body: 'opened by hand', comments: [] }),
      'breached',
    );
    assert.equal(lastReportedState({ body: null, comments: null }), 'breached');
  });

  test('a marker in the middle of a long comment is not read as a report', () => {
    // The breached body is the newest real report. A recovered marker sitting
    // inside a comment's prose must not win, and the body's marker must.
    const prose = 'A long paragraph of discussion about the target. '.repeat(
      40,
    );
    assert.equal(
      lastReportedState({
        body: breachBody(),
        comments: [
          { body: `${prose}\n<!-- pr-ci-duration-watch:recovered -->\n` },
        ],
      }),
      'breached',
    );
    // And the reverse: a breached marker mid-comment does not reopen a
    // recovered issue.
    assert.equal(
      lastReportedState({
        body: recoveredBody(),
        comments: [
          { body: `${prose}\n<!-- pr-ci-duration-watch:breached -->\n` },
        ],
      }),
      'recovered',
    );
  });
});

describe('the sparse-window note', () => {
  test('embeds the shared not-enough-data sentence, names the run count and window, and says the issue was not touched', () => {
    const summary = sparseSummary();
    const note = notEnoughDataNote(summary);
    assert.ok(note.includes(notEnoughDataSentence(summary)));
    assert.ok(note.includes(`${MIN_SINGLE_LIBRARY_RUNS - 1} Single-Library`));
    assert.ok(note.includes('2026-10-12 → 2026-10-26'));
    assert.ok(
      note.includes(`${MIN_SINGLE_LIBRARY_RUNS} this measurement needs`),
    );
    assert.match(note, /The issue was not touched\./);
  });
});
