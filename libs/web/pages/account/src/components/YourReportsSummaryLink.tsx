'use client';

import { Badge, Card, CardContent, CardTitle } from '@myorganiser/web-ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { createFeedbackApi } from '../lib/apiClient';

export function YourReportsSummaryLink() {
  const [hasChanged, setHasChanged] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const api = createFeedbackApi();
        const response = await api.listReports();
        setHasChanged(response.data.hasChangedSinceLastSeen);
      } catch {
        // Silently fail; the real content lives on /dashboard/account/reports
        console.error('Failed to fetch reports summary');
        setHasChanged(false);
      }
    })();
  }, []);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <CardTitle className="text-lg">Your reports</CardTitle>
        {hasChanged === true && <Badge variant="default">Updated</Badge>}
      </div>
      <CardContent className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          See the status of every Bug Report and Suggestion you've sent.
        </p>
        <Link
          href="/dashboard/account/reports"
          className="text-sm text-primary underline"
        >
          View your reports →
        </Link>
      </CardContent>
    </Card>
  );
}
