import {
  SubscriptionDetailPageClient,
  type SubscriptionDetailPageClientProps,
} from './components/SubscriptionDetailPageClient';
import { SubscriptionsPageClient } from './components/SubscriptionsPageClient';

export default function SubscriptionsPage() {
  return <SubscriptionsPageClient />;
}

export function SubscriptionDetailPage({
  subscriptionId,
}: SubscriptionDetailPageClientProps) {
  return <SubscriptionDetailPageClient subscriptionId={subscriptionId} />;
}
