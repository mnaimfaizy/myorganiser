'use client';

import type { AdminFeedbackReportDetailDto } from '@myorganiser/app-api-client';
import { useCallback, useState } from 'react';

interface ReportScoped<T> {
  report: AdminFeedbackReportDetailDto;
  value: T;
}

/**
 * Holds a message (an error, a success note) that belongs to one report.
 *
 * The value is returned only while the report it was stored against is the
 * report the caller currently holds, compared by reference. When a sibling
 * form updates the report, the parent passes a new object, the stored value no
 * longer matches, and the message stops rendering with no effect needed.
 *
 * `set` keys the value to the current report unless `forReport` is given, for
 * messages that describe the report the API returned rather than the one the
 * request was made against.
 */
export function useReportScoped<T>(report: AdminFeedbackReportDetailDto): {
  value: T | null;
  set: (value: T, forReport?: AdminFeedbackReportDetailDto) => void;
  clear: () => void;
} {
  const [scoped, setScoped] = useState<ReportScoped<T> | null>(null);

  const set = useCallback(
    (value: T, forReport: AdminFeedbackReportDetailDto = report) => {
      setScoped({ report: forReport, value });
    },
    [report],
  );

  const clear = useCallback(() => {
    setScoped(null);
  }, []);

  return {
    value: scoped?.report === report ? scoped.value : null,
    set,
    clear,
  };
}
