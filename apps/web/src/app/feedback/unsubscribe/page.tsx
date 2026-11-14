import { FixNoticeUnsubscribePage } from '@myorganiser/web-pages/account';
import { Suspense } from 'react';

// A token link from an email: nothing here belongs in search results.
export const metadata = {
  robots: { index: false, follow: false },
};

// The client component reads the unsubscribe token with useSearchParams, which
// the App Router requires to sit under a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <FixNoticeUnsubscribePage />
    </Suspense>
  );
}
