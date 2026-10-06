import fs from 'node:fs';

export interface GitHubServerConfig {
  mode: 'mock' | 'real';
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  appSlug: string;
  sessionSecret: string;
}

function parsePrivateKey(): string {
  const envKey = process.env.GITHUB_PRIVATE_KEY;
  if (envKey && envKey.trim()) {
    let key = envKey.trim();
    // If wrapped in quotes, unwrap
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
      key = key.slice(1, -1).trim();
    }

    // Check if the provided value is a file path to the private key
    if (!key.includes('BEGIN')) {
      const candidates = [key, `${key}.pem`, `${key}.key`];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          try {
            const stat = fs.statSync(candidate);
            if (stat.isFile()) {
              return fs.readFileSync(candidate, 'utf8');
            }
          } catch {
            // Continue
          }
        }
      }
    }

    // Check if it's base64 encoded
    if (!key.includes('BEGIN') && key.length > 100) {
      try {
        const decoded = Buffer.from(key, 'base64').toString('utf8');
        if (decoded.includes('BEGIN')) {
          key = decoded;
        }
      } catch {
        // Not base64
      }
    }
    // Replace literal escaped \n with real newlines
    key = key.replace(/\\n/g, '\n');
    return key;
  }

  const keyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
  if (keyPath && keyPath.trim()) {
    const rawPath = keyPath.trim().replace(/^["']|["']$/g, '');
    const candidates = [rawPath, `${rawPath}.pem`, `${rawPath}.key`];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const stat = fs.statSync(candidate);
          if (stat.isFile()) {
            return fs.readFileSync(candidate, 'utf8');
          }
        } catch {
          // Continue
        }
      }
    }
  }

  return '';
}

export function getGitHubConfig(): GitHubServerConfig {
  const configuredMode = (process.env.GITHUB_INTEGRATION_MODE || '').toLowerCase();
  const appId = (process.env.GITHUB_APP_ID || '').trim();
  const clientId = (process.env.GITHUB_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GITHUB_CLIENT_SECRET || '').trim();
  const privateKey = parsePrivateKey();
  const appSlug = (process.env.GITHUB_APP_SLUG || 'mergemint').trim();
  const sessionSecret = (
    process.env.SESSION_SECRET ||
    'mergemint-dev-session-secret-change-in-production-32b'
  ).padEnd(32, '0').slice(0, 32);

  const hasAllCredentials = Boolean(appId && clientId && clientSecret && privateKey);

  // If GITHUB_INTEGRATION_MODE is explicitly 'real', use real. If 'mock', use mock.
  // If not explicitly specified, use 'real' if all credentials are present, else 'mock'.
  let mode: 'mock' | 'real' = 'mock';
  if (configuredMode === 'real') {
    mode = 'real';
  } else if (configuredMode === 'mock') {
    mode = 'mock';
  } else if (hasAllCredentials) {
    mode = 'real';
  }

  return {
    mode,
    appId,
    clientId,
    clientSecret,
    privateKey,
    appSlug,
    sessionSecret,
  };
}

export function isGitHubConfigured(): boolean {
  const cfg = getGitHubConfig();
  return Boolean(cfg.appId && cfg.clientId && cfg.clientSecret && cfg.privateKey);
}
