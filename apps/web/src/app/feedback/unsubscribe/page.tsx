import { FixNoticeUnsubscribePage } from '@myorganiser/web-pages/account';
import { Suspense } from 'react';

// The client component reads the unsubscribe token with useSearchParams, which
// the App Router requires to sit under a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <FixNoticeUnsubscribePage />
    </Suspense>
  );
}
