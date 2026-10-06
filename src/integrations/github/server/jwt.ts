import crypto from 'node:crypto';

/**
 * Creates a signed JWT for authenticating as a GitHub App.
 * Uses Node.js native crypto RS256 signing (no external npm dependencies required).
 */
export function createGitHubAppJwt(appId: string, privateKeyPem: string): string {
  if (!appId) {
    throw new Error('GITHUB_APP_ID is required to generate a GitHub App JWT.');
  }
  if (!privateKeyPem) {
    throw new Error('GITHUB_PRIVATE_KEY is required to generate a GitHub App JWT.');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Allow 1 minute clock drift
    exp: now + 540, // 9 minutes (GitHub allows maximum 10 minutes)
    iss: appId,
  };

  const base64url = (input: string | Buffer) =>
    (typeof input === 'string' ? Buffer.from(input) : input).toString('base64url');

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  try {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsigned);
    sign.end();
    const signature = sign.sign(privateKeyPem, 'base64url');
    return `${unsigned}.${signature}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to sign GitHub App JWT: ${msg}. Check GITHUB_PRIVATE_KEY format.`);
  }
}
