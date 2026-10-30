import { isSafeLink } from './safeLink';

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
