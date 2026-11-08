import { FEEDBACK_REPORT_STATUS_TONES } from './feedback-report-status-tone';

describe('FEEDBACK_REPORT_STATUS_TONES', () => {
  it('maps every status to its pill tone', () => {
    expect(FEEDBACK_REPORT_STATUS_TONES).toEqual({
      received: 'neutral',
      under_review: 'info',
      planned: 'brand',
      fixed: 'trust',
      shipped: 'trust',
      wont_do: 'danger',
      cannot_reproduce: 'outline',
    });
  });
});
