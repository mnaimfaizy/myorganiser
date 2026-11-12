import { decryptToken, encryptToken } from './YouTubeTokenEncryption';

const TEST_KEY = '0f1e2d3c'.repeat(8);

describe('YouTubeTokenEncryption', () => {
  beforeEach(() => {
    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    delete process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY;
  });

  it('should encrypt and decrypt a token round-trip', () => {
    const plaintext = 'ya29.test-access-token-12345';
    const encrypted = encryptToken(plaintext);

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.ciphertext).not.toBe(plaintext);

    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertexts for the same plaintext (different IVs)', () => {
    const plaintext = 'ya29.same-token';
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);

    // Both should decrypt to the same value
    expect(decryptToken(a)).toBe(plaintext);
    expect(decryptToken(b)).toBe(plaintext);
  });

  it('should fail to decrypt with tampered ciphertext', () => {
    const encrypted = encryptToken('secret-token');
    encrypted.ciphertext = 'dGFtcGVyZWQ='; // "tampered" in base64

    expect(() => decryptToken(encrypted)).toThrow();
  });

  it('should fail to decrypt with tampered auth tag', () => {
    const encrypted = encryptToken('secret-token');
    encrypted.authTag = 'AAAAAAAAAAAAAAAAAAAAAA==';

    expect(() => decryptToken(encrypted)).toThrow();
  });

  it('should handle empty string plaintext', () => {
    const encrypted = encryptToken('');
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe('');
  });

  it('should handle long tokens', () => {
    const longToken = 'x'.repeat(2048);
    const encrypted = encryptToken(longToken);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(longToken);
  });

  it('should throw if YOUTUBE_TOKEN_ENCRYPTION_KEY is missing', () => {
    const original = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY;
    delete process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY;

    expect(() => encryptToken('test')).toThrow(
      'YOUTUBE_TOKEN_ENCRYPTION_KEY must be a 64-character hex string',
    );

    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = original;
  });

  it('should throw if YOUTUBE_TOKEN_ENCRYPTION_KEY is wrong length', () => {
    const original = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY;
    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = 'tooshort';

    expect(() => encryptToken('test')).toThrow(
      'YOUTUBE_TOKEN_ENCRYPTION_KEY must be a 64-character hex string',
    );

    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = original;
  });
});
