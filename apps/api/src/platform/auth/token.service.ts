/**
 * KuBi — access + refresh tokens.
 *
 * Access token: short-lived JWT (HS256), carries only userId + organizationId
 * — never roles or permissions, which are resolved fresh on every request
 * (Phase 0 §09: authorization is evaluated per-request, not cached in a token
 * that could go stale after a revoke).
 *
 * Refresh token: opaque random bytes, only the SHA-256 hash stored, rotated
 * on every use with a `replacedByTokenId` chain so reuse of a superseded
 * token is detectable (the standard signal of a stolen refresh token).
 *
 * TD-9: HS256 with a single shared secret is a Phase 2 simplification.
 * Production should move to RS256 with rotation before handling real
 * clinics — noted as technical debt in the completion report, not hidden.
 */
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes, createHash } from 'node:crypto';
import type { Clock } from '../../shared/clock.js';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to a random string of at least 32 characters (TD-9: HS256 for Phase 2).',
    );
  }
  return new TextEncoder().encode(secret);
}

export interface AccessTokenPayload {
  userId: string;
  organizationId: string;
}

export async function signAccessToken(
  payload: AccessTokenPayload,
  clock: Clock,
): Promise<string> {
  const now = Math.floor(clock.now().getTime() / 1000);
  return new SignJWT({ organizationId: payload.organizationId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(getSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  if (typeof payload.sub !== 'string' || typeof payload.organizationId !== 'string') {
    throw new Error('Malformed access token payload.');
  }
  return { userId: payload.sub, organizationId: payload.organizationId as string };
}

export interface IssuedRefreshToken {
  /** The raw token — returned to the client ONCE, never stored. */
  raw: string;
  /** SHA-256 hex digest — what gets persisted. */
  hash: string;
  expiresAt: Date;
}

export function issueRefreshToken(clock: Clock): IssuedRefreshToken {
  const raw = randomBytes(48).toString('base64url');
  return {
    raw,
    hash: createHash('sha256').update(raw).digest('hex'),
    expiresAt: new Date(clock.now().getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
