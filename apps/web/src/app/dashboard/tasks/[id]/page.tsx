import { TaskDetailPage } from '@myorganiser/web-pages/tasks';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  return <TaskDetailPage taskId={id} />;
}
