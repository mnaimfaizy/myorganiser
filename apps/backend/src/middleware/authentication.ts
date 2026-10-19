import { createHash, timingSafeEqual } from 'crypto';
import * as express from 'express';
import { JwtPayload } from 'jsonwebtoken';
import { decodeToken } from '../helpers/jwtHelper';
import { isTokenIssuedBeforeInvalidation } from '../helpers/sessionInvalidation';
import userService from '../services/UserService';

function unauthorized(message = 'Unauthorized') {
  const err = new Error(message) as Error & { status?: number };
  err.status = 401;
  return err;
}

function forbidden(message = 'Forbidden') {
  const err = new Error(message) as Error & { status?: number };
  err.status = 403;
  return err;
}

/** Same body as the global YOUTUBE_AVAILABLE gate (ADR 0129). */
function notFound(message = 'Not Found') {
  const err = new Error(message) as Error & { status?: number };
  err.status = 404;
  return err;
}

function getBearerToken(request: express.Request): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function authenticateCronSecret(request: express.Request): Promise<void> {
  const secret = request.headers['x-cron-secret'];
  const expectedSecret = process.env.YOUTUBE_CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return Promise.reject(unauthorized());
  }

  return Promise.resolve();
}

/**
 * The Production deploy's credential for Release marking (ADR 0133). Separate
 * from cron-secret so neither secret opens the other's endpoints. Both sides
 * are hashed first so timingSafeEqual always compares equal-length buffers:
 * the compare is constant time and leaks nothing about the secret's length.
 */
function authenticateDeploySecret(request: express.Request): Promise<void> {
  const secret = request.headers['x-deploy-secret'];
  const expectedSecret = process.env.FEEDBACK_RELEASE_SECRET;

  if (!expectedSecret || typeof secret !== 'string') {
    return Promise.reject(unauthorized());
  }

  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(secret), digest(expectedSecret))) {
    return Promise.reject(unauthorized());
  }

  return Promise.resolve();
}

export function expressAuthentication(
  request: express.Request,
  securityName: string,
  scopes?: string[],
): Promise<any> {
  if (securityName === 'cron-secret') {
    return authenticateCronSecret(request);
  }

  if (securityName === 'deploy-secret') {
    return authenticateDeploySecret(request);
  }

  if (securityName !== 'jwt') {
    return Promise.reject(unauthorized('Unsupported security scheme'));
  }

  return (async () => {
    const tokenFromHeader = getBearerToken(request);

    // Fallback: allow passing `token` in body for legacy clients.
    // Header remains the primary/expected mechanism.
    const tokenFromBody =
      !tokenFromHeader &&
      request.body &&
      typeof (request.body as any).token === 'string'
        ? ((request.body as any).token as string)
        : undefined;

    const token = tokenFromHeader ?? tokenFromBody;
    if (!token) {
      throw unauthorized();
    }

    const decoded = decodeToken(token, process.env.ACCESS_JWT_SECRET as string);

    if (!decoded || decoded instanceof Error) {
      throw unauthorized();
    }

    const payload = decoded as JwtPayload;
    if (!payload.userId) {
      throw unauthorized();
    }

    const user = await userService.getById(payload.userId);
    if (!user) {
      throw unauthorized();
    }

    if ((user as { disabled?: boolean }).disabled) {
      throw unauthorized('Account disabled');
    }

    if (
      isTokenIssuedBeforeInvalidation(
        payload.iat,
        (user as { sessions_invalidated_at?: Date | null })
          .sessions_invalidated_at,
      )
    ) {
      throw unauthorized('Session invalidated');
    }

    if (scopes?.includes('platform_admin')) {
      if ((user as { role?: string }).role !== 'platform_admin') {
        throw forbidden('Platform Admin role required');
      }
    }

    // ADR 0129: a User without YouTube Access sees YouTube routes as absent.
    if (scopes?.includes('youtube_access')) {
      if ((user as { youtube_access?: boolean }).youtube_access !== true) {
        throw notFound();
      }
    }

    // Ensure downstream authZ can consistently rely on request.user.
    (request as any).user = user;

    // If the token came from body fallback, normalize auth header for any other middleware.
    if (!request.headers.authorization) {
      request.headers.authorization = `Bearer ${token}`;
    }

    return user;
  })().catch((err: unknown) => {
    if (
      err &&
      typeof err === 'object' &&
      'status' in err &&
      ((err as { status?: unknown }).status === 401 ||
        (err as { status?: unknown }).status === 403 ||
        (err as { status?: unknown }).status === 404)
    ) {
      throw err;
    }

    throw unauthorized();
  });
}
