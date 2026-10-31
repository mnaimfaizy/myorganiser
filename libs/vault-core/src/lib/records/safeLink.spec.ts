import { isSafeLink, openableLink } from './safeLink';

/**
 * Values that `URL` may parse into an http(s) URL, or that look like one, but
 * whose text does not literally start `http://` or `https://` with no
 * control characters inside. What gets opened is the text, so all are unsafe.
 */
const MALFORMED_LINKS = [
  'https:example.com',
  'http:foo',
  'http:\\\\evil.com',
  'ht\ntp://example.com',
  'https://exa\tmple.com',
  'https://exa\nmple.com',
  '//example.com',
  'http://',
];

describe('isSafeLink', () => {
  it('accepts an http link', () => {
    expect(isSafeLink('http://example.com')).toBe(true);
  });

  it('accepts an https link', () => {
    expect(isSafeLink('https://example.com')).toBe(true);
  });

  it('accepts a mixed-case scheme because URL normalizes it', () => {
    expect(isSafeLink('HTTPS://example.com')).toBe(true);
  });

  it('accepts an uppercase http scheme', () => {
    expect(isSafeLink('HTTP://example.com')).toBe(true);
  });

  it.each(MALFORMED_LINKS)('rejects a malformed link %j', (value) => {
    expect(isSafeLink(value)).toBe(false);
  });

  it('accepts a value with surrounding whitespace once trimmed', () => {
    expect(isSafeLink('  https://example.com  ')).toBe(true);
  });

  it('rejects a javascript: link', () => {
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
  });

  it('rejects a javascript: link with a mixed-case scheme', () => {
    expect(isSafeLink('JaVaScRiPt:alert(1)')).toBe(false);
  });

  it('rejects a data: link', () => {
    expect(isSafeLink('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects a vbscript: link', () => {
    expect(isSafeLink('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects an intent: link', () => {
    expect(isSafeLink('intent:#Intent;scheme=https;end')).toBe(false);
  });

  it('rejects a tel: link', () => {
    expect(isSafeLink('tel:+1234567890')).toBe(false);
  });

  it('rejects a scheme-less value', () => {
    expect(isSafeLink('example.com/path')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isSafeLink('')).toBe(false);
  });
});

describe('openableLink', () => {
  it('returns the trimmed link when it is safe', () => {
    expect(openableLink('  https://example.com  ')).toBe('https://example.com');
  });

  it('returns null for an unsafe scheme', () => {
    expect(openableLink('javascript:alert(1)')).toBeNull();
  });

  it.each(MALFORMED_LINKS)('returns null for a malformed link %j', (value) => {
    expect(openableLink(value)).toBeNull();
  });

  it('returns the trimmed text of an uppercase http link', () => {
    expect(openableLink(' HTTP://example.com ')).toBe('HTTP://example.com');
  });

  it('returns null for an empty string', () => {
    expect(openableLink('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(openableLink(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(openableLink(null)).toBeNull();
  });
});
