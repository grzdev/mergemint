import crypto from 'node:crypto';
import type { GitHubUser } from '../types';
import { getGitHubConfig } from './config';

export interface UserSession {
  user: GitHubUser;
  token?: string;
  createdAt: number;
}

export const SESSION_COOKIE_NAME = 'mergemint_session';
export const OAUTH_STATE_COOKIE_NAME = 'mergemint_oauth_state';

function getKeyBuffer(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSession(session: UserSession, secret: string): string {
  const key = getKeyBuffer(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const json = JSON.stringify(session);
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Combine iv (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

export function decryptSession(cookieValue: string, secret: string): UserSession | null {
  if (!cookieValue) return null;
  try {
    const key = getKeyBuffer(secret);
    const buf = Buffer.from(cookieValue, 'base64url');
    if (buf.length < 28) return null; // 12 iv + 16 tag minimum

    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted) as UserSession;
    if (parsed && typeof parsed === 'object' && parsed.user) {
      return parsed;
    }
  } catch {
    // Decryption or authentication failed
  }
  return null;
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const pair of cookieHeader.split(';')) {
    const [rawKey, ...rawVal] = pair.split('=');
    if (rawKey) {
      result[rawKey.trim()] = decodeURIComponent(rawVal.join('=').trim());
    }
  }
  return result;
}

export function getSessionFromRequest(request: Request): UserSession | null {
  const cookieHeader = request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const sessionCookie = cookies[SESSION_COOKIE_NAME];
  if (!sessionCookie) return null;

  const cfg = getGitHubConfig();
  return decryptSession(sessionCookie, cfg.sessionSecret);
}

export function createRandomState(): string {
  return crypto.randomBytes(24).toString('hex');
}
