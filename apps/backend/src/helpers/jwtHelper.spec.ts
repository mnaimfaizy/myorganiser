import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { decodeToken, generateToken } from './jwtHelper';

const signingKey = 'test-signing-key';

describe('decodeToken', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns the payload of a valid token without logging', () => {
    const token = generateToken({ userId: 'user-42' }, signingKey, '1h');

    const decoded = decodeToken(token as string, signingKey);

    expect(decoded).toMatchObject({ userId: 'user-42' });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('returns a TokenExpiredError for an expired token without logging', () => {
    const token = generateToken({ userId: 'user-42' }, signingKey, '-10s');

    const result = decodeToken(token as string, signingKey);

    expect(result).toBeInstanceOf(TokenExpiredError);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('returns a JsonWebTokenError and logs it when the signature does not match', () => {
    const token = generateToken({ userId: 'user-42' }, signingKey, '1h');

    const result = decodeToken(token as string, 'other-signing-key');

    expect(result).toBeInstanceOf(JsonWebTokenError);
    expect(result).not.toBeInstanceOf(TokenExpiredError);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(result);
  });

  it('returns a JsonWebTokenError and logs it for a malformed token string', () => {
    const result = decodeToken('not-a-jwt', signingKey);

    expect(result).toBeInstanceOf(JsonWebTokenError);
    expect(result).not.toBeInstanceOf(TokenExpiredError);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(result);
  });
});
