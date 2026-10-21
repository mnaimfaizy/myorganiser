import { SubscriptionDetailPage } from '@myorganiser/web-pages/subscriptions';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  return <SubscriptionDetailPage subscriptionId={id} />;
}
