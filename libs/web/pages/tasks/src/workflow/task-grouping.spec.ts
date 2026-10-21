import type { Task } from '@myorganiser/vault-core';

import {
  countTasks,
  dueGroupOf,
  doneThisWeek,
  formatDueLabel,
  formatEstimate,
  formatTaskSummary,
  groupOpenTasks,
  isOpenTask,
  localDateKey,
  parseEstimate,
  taskMetaLine,
  type TaskCounts,
} from './task-grouping';

// 2026-10-22 is a Thursday. Its week starts Monday 2026-10-19 (local time).
const TODAY = '2026-10-22';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Task',
    status: 'pending',
    priority: 'medium',
    archived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCounts(overrides: Partial<TaskCounts> = {}): TaskCounts {
  return {
    open: 0,
    dueToday: 0,
    overdue: 0,
    inProgress: 0,
    blocked: 0,
    doneThisWeek: 0,
    ...overrides,
  };
}

describe('task-grouping', () => {
  describe('localDateKey', () => {
    it('zero-pads month and day', () => {
      expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('uses the local calendar date, so a late-evening time stays on its day', () => {
      expect(localDateKey(new Date(2026, 9, 22, 23, 30))).toBe('2026-10-22');
    });
  });

  describe('isOpenTask', () => {
    it.each(['pending', 'in_progress', 'blocked'] as const)(
      'treats a %s task as open',
      (status) => {
        expect(isOpenTask(makeTask({ status }))).toBe(true);
      },
    );

    it.each(['done', 'cancelled'] as const)(
      'treats a %s task as not open',
      (status) => {
        expect(isOpenTask(makeTask({ status }))).toBe(false);
      },
    );
  });

  describe('dueGroupOf', () => {
    it('places a task due before today in overdue', () => {
      expect(dueGroupOf(makeTask({ dueDate: '2026-10-21' }), TODAY)).toBe(
        'overdue',
      );
    });

    it('places a task due today in today', () => {
      expect(dueGroupOf(makeTask({ dueDate: '2026-10-22' }), TODAY)).toBe(
        'today',
      );
    });

    it('places a task due after today in upcoming', () => {
      expect(dueGroupOf(makeTask({ dueDate: '2026-10-23' }), TODAY)).toBe(
        'upcoming',
      );
    });

    it('places a task without a due date in no_date', () => {
      expect(dueGroupOf(makeTask(), TODAY)).toBe('no_date');
    });
  });

  describe('groupOpenTasks', () => {
    it('excludes done and cancelled tasks and keeps input order inside each group', () => {
      const tasks = [
        makeTask({ id: 'overdue-a', dueDate: '2026-10-21' }),
        makeTask({ id: 'done-x', status: 'done', dueDate: '2026-10-21' }),
        makeTask({
          id: 'today-b',
          status: 'in_progress',
          dueDate: '2026-10-22',
        }),
        makeTask({
          id: 'cancelled-y',
          status: 'cancelled',
          dueDate: '2026-10-22',
        }),
        makeTask({
          id: 'upcoming-c',
          status: 'blocked',
          dueDate: '2026-10-24',
        }),
        makeTask({ id: 'nodate-d' }),
        makeTask({ id: 'overdue-e', dueDate: '2026-10-20' }),
      ];

      const groups = groupOpenTasks(tasks, TODAY);

      expect(groups.overdue.map((t) => t.id)).toEqual([
        'overdue-a',
        'overdue-e',
      ]);
      expect(groups.today.map((t) => t.id)).toEqual(['today-b']);
      expect(groups.upcoming.map((t) => t.id)).toEqual(['upcoming-c']);
      expect(groups.no_date.map((t) => t.id)).toEqual(['nodate-d']);
    });

    it('returns every group key with an empty array when nothing is open', () => {
      expect(groupOpenTasks([], TODAY)).toEqual({
        overdue: [],
        today: [],
        upcoming: [],
        no_date: [],
      });
    });
  });

  describe('doneThisWeek', () => {
    // Thursday 22 Oct 2026, 10:00 local. The week began Monday 19 Oct 00:00.
    const now = new Date(2026, 9, 22, 10, 0);

    it('includes a done task closed at Monday 00:00 local', () => {
      const task = makeTask({
        id: 'monday-start',
        status: 'done',
        closedAt: new Date(2026, 9, 19, 0, 0).toISOString(),
      });

      expect(doneThisWeek([task], now).map((t) => t.id)).toEqual([
        'monday-start',
      ]);
    });

    it('excludes a done task closed at Sunday 23:59 local, the week before', () => {
      const task = makeTask({
        id: 'sunday-before',
        status: 'done',
        closedAt: new Date(2026, 9, 18, 23, 59).toISOString(),
      });

      expect(doneThisWeek([task], now)).toEqual([]);
    });

    it('excludes a cancelled task even when it was closed this week', () => {
      const task = makeTask({
        id: 'cancelled',
        status: 'cancelled',
        closedAt: new Date(2026, 9, 20, 9, 0).toISOString(),
      });

      expect(doneThisWeek([task], now)).toEqual([]);
    });

    it('excludes a done task that has no closedAt', () => {
      const task = makeTask({ id: 'no-closed-at', status: 'done' });

      expect(doneThisWeek([task], now)).toEqual([]);
    });

    it('still counts Monday when now is a Sunday', () => {
      // Sunday 25 Oct 2026 is the last day of the week that began Monday 19 Oct.
      const sundayNow = new Date(2026, 9, 25, 12, 0);
      const task = makeTask({
        id: 'monday-start',
        status: 'done',
        closedAt: new Date(2026, 9, 19, 0, 0).toISOString(),
      });

      expect(doneThisWeek([task], sundayNow).map((t) => t.id)).toEqual([
        'monday-start',
      ]);
    });
  });

  describe('countTasks', () => {
    it('counts open, due-today, overdue, in-progress, blocked and done-this-week from one fixture', () => {
      // now: Thursday 22 Oct 2026, 10:00 local
      const now = new Date(2026, 9, 22, 10, 0);
      const tasks = [
        makeTask({ id: 'due-today', dueDate: '2026-10-22' }),
        makeTask({
          id: 'overdue-in-progress',
          status: 'in_progress',
          dueDate: '2026-10-21',
        }),
        makeTask({ id: 'blocked', status: 'blocked' }),
        makeTask({ id: 'upcoming', dueDate: '2026-10-24' }),
        makeTask({
          id: 'done-this-week',
          status: 'done',
          dueDate: '2026-10-21',
          closedAt: new Date(2026, 9, 19, 9, 0).toISOString(),
        }),
        makeTask({
          id: 'cancelled-due-today',
          status: 'cancelled',
          dueDate: '2026-10-22',
        }),
        makeTask({
          id: 'done-last-week',
          status: 'done',
          closedAt: new Date(2026, 9, 16, 10, 0).toISOString(),
        }),
      ];

      expect(countTasks(tasks, now)).toEqual({
        open: 4,
        dueToday: 1,
        overdue: 1,
        inProgress: 1,
        blocked: 1,
        doneThisWeek: 1,
      });
    });
  });

  describe('formatTaskSummary', () => {
    it('formats the desktop summary with due-today and overdue parts', () => {
      expect(
        formatTaskSummary(
          makeCounts({ open: 12, dueToday: 3, overdue: 1 }),
          'desktop',
        ),
      ).toBe('12 open · 3 due today · 1 overdue');
    });

    it('formats the phone summary with the shorter today label', () => {
      expect(
        formatTaskSummary(
          makeCounts({ open: 12, dueToday: 3, overdue: 1 }),
          'phone',
        ),
      ).toBe('12 open · 3 today · 1 overdue');
    });

    it('leaves out zero due-today and overdue parts', () => {
      expect(formatTaskSummary(makeCounts({ open: 5 }), 'desktop')).toBe(
        '5 open',
      );
    });

    it('shows the done-this-week part on desktop when nothing is open', () => {
      expect(
        formatTaskSummary(makeCounts({ doneThisWeek: 4 }), 'desktop'),
      ).toBe('Nothing open · 4 done this week');
    });

    it('shows only "Nothing open" on desktop when nothing is open and nothing is done', () => {
      expect(formatTaskSummary(makeCounts(), 'desktop')).toBe('Nothing open');
    });

    it('shows only "Nothing open" on phone even when tasks were done this week', () => {
      expect(formatTaskSummary(makeCounts({ doneThisWeek: 4 }), 'phone')).toBe(
        'Nothing open',
      );
    });
  });

  describe('formatDueLabel', () => {
    it('returns an em dash when there is no due date', () => {
      expect(formatDueLabel(undefined, TODAY)).toBe('—');
    });

    it('returns "Yesterday" for the day before today', () => {
      expect(formatDueLabel('2026-10-21', TODAY)).toBe('Yesterday');
    });

    it('returns "Today" for today', () => {
      expect(formatDueLabel('2026-10-22', TODAY)).toBe('Today');
    });

    it('returns "Tomorrow" for the day after today', () => {
      expect(formatDueLabel('2026-10-23', TODAY)).toBe('Tomorrow');
    });

    it('returns a weekday, day and month for other dates', () => {
      expect(formatDueLabel('2026-10-24', TODAY)).toBe('Sat 24 Oct');
    });
  });

  describe('formatEstimate', () => {
    it('formats minutes as "N min"', () => {
      expect(formatEstimate(15)).toBe('15 min');
    });
  });

  describe('parseEstimate', () => {
    it.each([
      ['30', 30],
      ['30 min', 30],
      ['30m', 30],
      [' 45 mins ', 45],
    ])('reads %j as %d minutes', (input, expected) => {
      expect(parseEstimate(input)).toBe(expected);
    });

    it.each(['', '   '])('reads blank input %j as no estimate', (input) => {
      expect(parseEstimate(input)).toBeUndefined();
    });

    it.each(['abc', '0', '-5', '1.5'])('reads %j as invalid', (input) => {
      expect(parseEstimate(input)).toBeNull();
    });
  });

  describe('taskMetaLine', () => {
    it('joins an overdue due label with the context', () => {
      expect(
        taskMetaLine(
          makeTask({ context: 'personal', dueDate: '2026-10-21' }),
          TODAY,
        ),
      ).toBe('Yesterday · Personal');
    });

    it('leaves out the due label for a task due today and keeps the estimate', () => {
      expect(
        taskMetaLine(
          makeTask({
            context: 'personal',
            dueDate: '2026-10-22',
            estimatedMinutes: 15,
          }),
          TODAY,
        ),
      ).toBe('Personal · 15 min');
    });

    it('shows only the context when there is no due date', () => {
      expect(taskMetaLine(makeTask({ context: 'work' }), TODAY)).toBe('Work');
    });

    it('shows the weekday label for an upcoming task', () => {
      expect(
        taskMetaLine(
          makeTask({ context: 'personal', dueDate: '2026-10-24' }),
          TODAY,
        ),
      ).toBe('Sat 24 Oct · Personal');
    });

    it('returns an empty string when there is no context, date or estimate', () => {
      expect(taskMetaLine(makeTask(), TODAY)).toBe('');
    });
  });
});
