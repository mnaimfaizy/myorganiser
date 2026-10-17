import { describeReportContext } from './reportContext';

describe('describeReportContext', () => {
  describe('path stripping', () => {
    it('should strip query string and fragment from pathname', () => {
      const result = describeReportContext({
        userAgent: 'Mozilla/5.0',
        pathname: '/dashboard/tasks?token=secret&filter=active#top',
        appVersion: '1.0.0',
        sentAt: new Date('2026-01-15T10:30:00Z'),
      });

      expect(result.path).toBe('/dashboard/tasks');
    });

    it('should leave a plain pathname unchanged', () => {
      const result = describeReportContext({
        userAgent: 'Mozilla/5.0',
        pathname: '/dashboard/tasks',
        appVersion: '1.0.0',
        sentAt: new Date('2026-01-15T10:30:00Z'),
      });

      expect(result.path).toBe('/dashboard/tasks');
    });
  });

  describe('browser detection', () => {
    it('should detect Chrome browser with major version', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.browser).toBe('Chrome 120');
    });

    it('should detect Edge browser with major version (before Chrome)', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.browser).toBe('Edge 120');
    });

    it('should detect Safari browser with major version', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.browser).toBe('Safari 17');
    });

    it('should detect Firefox browser with major version', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.browser).toBe('Firefox 121');
    });

    it('should detect Opera browser with major version (before Chrome)', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.browser).toBe('Opera 106');
    });

    it('should return fallback for unrecognised user-agent', () => {
      const result = describeReportContext({
        userAgent: 'UnknownBrowser/1.0 Custom/1.0',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.browser).toBe('Unknown browser');
    });
  });

  describe('operating system detection', () => {
    it('should detect Windows operating system', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.operatingSystem).toBe('Windows');
    });

    it('should detect macOS operating system', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.operatingSystem).toBe('macOS');
    });

    it('should detect Android operating system', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.operatingSystem).toBe('Android');
    });

    it('should detect ChromeOS operating system (before Linux)', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (X11; CrOS x86_64 13982.111.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.operatingSystem).toBe('ChromeOS');
    });

    it('should detect Linux operating system', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.operatingSystem).toBe('Linux');
    });

    it('should detect iPhone operating system', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.operatingSystem).toBe('iOS');
    });

    it('should detect iPad operating system', () => {
      const result = describeReportContext({
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.operatingSystem).toBe('iOS');
    });

    it('should return fallback for unrecognised operating system', () => {
      const result = describeReportContext({
        userAgent: 'UnknownOS/1.0',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date(),
      });

      expect(result.operatingSystem).toBe('Unknown operating system');
    });
  });

  describe('platform and sentAt', () => {
    it('should always return platform as "web"', () => {
      const result = describeReportContext({
        userAgent: 'Mozilla/5.0',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: new Date('2026-01-15T10:30:00Z'),
      });

      expect(result.platform).toBe('web');
    });

    it('should return sentAt as ISO 8601 string', () => {
      const date = new Date('2026-01-15T10:30:00.500Z');
      const result = describeReportContext({
        userAgent: 'Mozilla/5.0',
        pathname: '/test',
        appVersion: '1.0.0',
        sentAt: date,
      });

      expect(result.sentAt).toBe('2026-01-15T10:30:00.500Z');
    });
  });

  describe('appVersion passthrough', () => {
    it('should preserve appVersion as given', () => {
      const result = describeReportContext({
        userAgent: 'Mozilla/5.0',
        pathname: '/test',
        appVersion: '2.5.3-beta',
        sentAt: new Date(),
      });

      expect(result.appVersion).toBe('2.5.3-beta');
    });
  });
});
