import type { Task } from '@myorganiser/vault-core';
import { TaskDoneGroup } from './task-done-group';
import { TaskGroupSection } from './task-group-section';
import type { TaskGroupTone } from './task-group-section';
import { TaskRow } from './task-row';
import type { TaskRowGroup } from './task-row';

/** One titled group of rows on the board: a due group, Done, or Archived. */
export interface TaskBoardSection {
  key: string;
  /** The accessible name of the section. */
  name: string;
  /** The visible heading, for example "Overdue · 1". */
  label: string;
  tone: TaskGroupTone;
  group: TaskRowGroup;
  tasks: Task[];
}

export interface TasksBoardListProps {
  sections: TaskBoardSection[];
  /** Open view only: the tasks done this week, under a collapsed group. `null` hides the group. */
  doneTasks: Task[] | null;
  today: string;
  variant: 'desktop' | 'phone';
  selectedTaskId?: string;
  onToggleDone: (task: Task, done: boolean) => void;
  onSelect: (task: Task) => void;
}

interface TasksBoardRowsProps {
  tasks: Task[];
  group: TaskRowGroup;
  today: string;
  variant: 'desktop' | 'phone';
  selectedTaskId?: string;
  onToggleDone: (task: Task, done: boolean) => void;
  onSelect: (task: Task) => void;
}

/** The rows of one group. Phone rows link to the detail route; desktop rows select. */
const TasksBoardRows = ({
  tasks,
  group,
  today,
  variant,
  selectedTaskId,
  onToggleDone,
  onSelect,
}: TasksBoardRowsProps) => (
  <>
    {tasks.map((task) => (
      <TaskRow
        key={task.id}
        task={task}
        today={today}
        group={group}
        variant={variant}
        selected={task.id === selectedTaskId}
        onToggleDone={onToggleDone}
        onSelect={onSelect}
        detailHref={
          variant === 'phone' ? `/dashboard/tasks/${task.id}` : undefined
        }
      />
    ))}
  </>
);

/**
 * The list body of the Tasks board: one section per group in order, then the
 * collapsed Done this week group when the open view supplies one.
 */
export const TasksBoardList = ({
  sections,
  doneTasks,
  today,
  variant,
  selectedTaskId,
  onToggleDone,
  onSelect,
}: TasksBoardListProps) => (
  <>
    {sections.map((section) => (
      <TaskGroupSection
        key={section.key}
        name={section.name}
        label={section.label}
        tone={section.tone}
        variant={variant}
      >
        <TasksBoardRows
          tasks={section.tasks}
          group={section.group}
          today={today}
          variant={variant}
          selectedTaskId={selectedTaskId}
          onToggleDone={onToggleDone}
          onSelect={onSelect}
        />
      </TaskGroupSection>
    ))}
    {doneTasks ? (
      <TaskDoneGroup count={doneTasks.length}>
        <TasksBoardRows
          tasks={doneTasks}
          group="closed"
          today={today}
          variant={variant}
          selectedTaskId={selectedTaskId}
          onToggleDone={onToggleDone}
          onSelect={onSelect}
        />
      </TaskDoneGroup>
    ) : null}
  </>
);
