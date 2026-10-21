import {
  TaskDetailPageClient,
  type TaskDetailPageClientProps,
} from './components/TaskDetailPageClient';
import { TasksPageClient } from './components/TasksPageClient';

export default function TasksPage() {
  return <TasksPageClient />;
}

export function TaskDetailPage({ taskId }: TaskDetailPageClientProps) {
  return <TaskDetailPageClient taskId={taskId} />;
}
