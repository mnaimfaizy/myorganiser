import {
  FeedbackReportStatus,
  type AdminFeedbackReportDetailDto,
} from '@myorganiser/app-api-client';
import { act, renderHook } from '@testing-library/react';

import { useReportScoped } from './use-report-scoped';

function makeReport(
  overrides: Partial<AdminFeedbackReportDetailDto> = {},
): AdminFeedbackReportDetailDto {
  return {
    id: 'report-1',
    kind: 'bug',
    status: FeedbackReportStatus.Received,
    title: 'Broken export',
    platform: 'web',
    trackingIssueNumber: null,
    reporterUserId: null,
    reporter: null,
    statusChangedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    description: 'Export button does nothing',
    expectedOutcome: null,
    context: {},
    followUp: null,
    statusNote: null,
    releaseTag: null,
    fixNoticeOptIn: false,
    ...overrides,
  } as AdminFeedbackReportDetailDto;
}

describe('useReportScoped', () => {
  it('starts with a null value', () => {
    const report = makeReport();
    const { result } = renderHook(() => useReportScoped<string>(report));

    expect(result.current.value).toBeNull();
  });

  it('returns a value set without forReport while the report object is unchanged', () => {
    const report = makeReport();
    const { result } = renderHook(() => useReportScoped<string>(report));

    act(() => {
      result.current.set('msg');
    });

    expect(result.current.value).toBe('msg');
  });

  it('drops the value when rerendered with a new report object, even with identical fields', () => {
    const report = makeReport();
    const { result, rerender } = renderHook(
      ({ current }: { current: AdminFeedbackReportDetailDto }) =>
        useReportScoped<string>(current),
      { initialProps: { current: report } },
    );

    act(() => {
      result.current.set('msg');
    });
    expect(result.current.value).toBe('msg');

    const sameFieldsDifferentObject = makeReport();
    expect(sameFieldsDifferentObject).toEqual(report);
    expect(sameFieldsDifferentObject).not.toBe(report);

    rerender({ current: sameFieldsDifferentObject });

    expect(result.current.value).toBeNull();
  });

  it('keys the value to forReport when given, so it shows once the caller holds that report', () => {
    const report = makeReport();
    const otherReport = makeReport({
      status: FeedbackReportStatus.UnderReview,
    });
    const { result, rerender } = renderHook(
      ({ current }: { current: AdminFeedbackReportDetailDto }) =>
        useReportScoped<string>(current),
      { initialProps: { current: report } },
    );

    act(() => {
      result.current.set('msg', otherReport);
    });

    expect(result.current.value).toBeNull();

    rerender({ current: otherReport });

    expect(result.current.value).toBe('msg');
  });

  it('clear resets the value to null', () => {
    const report = makeReport();
    const { result } = renderHook(() => useReportScoped<string>(report));

    act(() => {
      result.current.set('msg');
    });
    expect(result.current.value).toBe('msg');

    act(() => {
      result.current.clear();
    });

    expect(result.current.value).toBeNull();
  });

  it('keeps set stable across rerenders with the same report and changes it when the report changes; clear is always stable', () => {
    const report = makeReport();
    const { result, rerender } = renderHook(
      ({ current }: { current: AdminFeedbackReportDetailDto }) =>
        useReportScoped<string>(current),
      { initialProps: { current: report } },
    );

    const initialSet = result.current.set;
    const initialClear = result.current.clear;

    rerender({ current: report });
    expect(result.current.set).toBe(initialSet);
    expect(result.current.clear).toBe(initialClear);

    rerender({ current: makeReport() });
    expect(result.current.set).not.toBe(initialSet);
    expect(result.current.clear).toBe(initialClear);
  });

  it('supports a literal generic value type', () => {
    const report = makeReport();
    const { result } = renderHook(() => useReportScoped<true>(report));

    act(() => {
      result.current.set(true);
    });

    expect(result.current.value).toBe(true);
  });
});
