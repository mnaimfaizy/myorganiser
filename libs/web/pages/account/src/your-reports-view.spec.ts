import { REPORT_STATUS_CONFIG } from './your-reports-view';

describe('REPORT_STATUS_CONFIG tones', () => {
  it('shows Under review as info and Can’t reproduce as the outline', () => {
    expect(REPORT_STATUS_CONFIG.under_review.tone).toBe('info');
    expect(REPORT_STATUS_CONFIG.cannot_reproduce.tone).toBe('outline');
  });

  it('keeps the other statuses on their tones', () => {
    expect(REPORT_STATUS_CONFIG.received.tone).toBe('neutral');
    expect(REPORT_STATUS_CONFIG.planned.tone).toBe('brand');
    expect(REPORT_STATUS_CONFIG.fixed.tone).toBe('trust');
    expect(REPORT_STATUS_CONFIG.shipped.tone).toBe('trust');
    expect(REPORT_STATUS_CONFIG.wont_do.tone).toBe('danger');
  });
});
