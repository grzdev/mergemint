import fs from 'node:fs';
import path from 'node:path';
import { getGitHubConfig } from '../github/server/config';
import { getTokenForRepo } from '../github/server/client';

export interface TargetedFileExcerpt {
  path: string;
  category: 'source' | 'test' | 'config' | 'validation' | 'interface';
  contentSnippet: string; // strictly bounded to 200-500 chars
}

export interface BoundedRepoContext {
  repo: string;
  description?: string;
  language?: string;
  topics?: string[];
  readmeExcerpt?: string;
  manifestSummary?: string;
  recentCommits?: string[];
  existingIssueTitles?: string[];
  targetedFiles?: TargetedFileExcerpt[];
  contextSources: string[];
}

/**
 * Gathers targeted, bounded repository context to feed into Scout's LLM prompt.
 * Keeps payload compact (approx. 2-6 KB) to optimize latency, cost, and token limits.
 */
export async function gatherRepoContext(
  repoFullName: string,
  userToken?: string
): Promise<BoundedRepoContext> {
  const contextSources: string[] = [];
  const parts = repoFullName.trim().split('/');
  const isOwnerRepo = parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]);

  let description: string | undefined;
  let language: string | undefined;
  let topics: string[] | undefined;
  let readmeExcerpt: string | undefined;
  let manifestSummary: string | undefined;
  let recentCommits: string[] | undefined;
  let existingIssueTitles: string[] | undefined;

  let targetedFiles: TargetedFileExcerpt[] | undefined;

  // 1. Use local filesystem context ONLY for the mock demo repo mergemint/core
  if (getGitHubConfig().mode === 'mock' && repoFullName.trim().toLowerCase() === 'mergemint/core') {
    try {
      const rootDir = process.cwd();
      
      // Read local package.json
      const pkgPath = path.join(rootDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        manifestSummary = JSON.stringify({
          name: pkg.name,
          dependencies: Object.keys(pkg.dependencies || {}).slice(0, 15),
          devDependencies: Object.keys(pkg.devDependencies || {}).slice(0, 10),
        });
        contextSources.push('local:package.json');
      }

      // Read local daml.yaml if present
      const damlPath = path.join(rootDir, 'daml', 'daml.yaml');
      if (fs.existsSync(damlPath)) {
        const damlContent = fs.readFileSync(damlPath, 'utf8');
        manifestSummary = (manifestSummary ? manifestSummary + '\n' : '') + `Daml Config:\n${damlContent.slice(0, 500)}`;
        contextSources.push('local:daml.yaml');
      }

      // Read local README.md
      const readmePath = path.join(rootDir, 'README.md');
      if (fs.existsSync(readmePath)) {
        readmeExcerpt = fs.readFileSync(readmePath, 'utf8').slice(0, 1500);
        contextSources.push('local:README.md');
      }

      description = 'Canton Network on-chain bounty escrow and verification protocol with CIP-56 token settlement.';
      language = 'TypeScript / Daml';
      topics = ['canton-network', 'daml', 'bounties', 'cip-56', 'nextjs'];

      // Extract bounded excerpts from targeted local files
      const candidateLocalFiles: Array<{ relPath: string; category: TargetedFileExcerpt['category'] }> = [
        { relPath: 'src/integrations/canton/server/ledger.ts', category: 'source' },
        { relPath: 'src/integrations/canton/server/authorization.ts', category: 'interface' },
        { relPath: 'src/domain/bounty.ts', category: 'validation' },
        { relPath: 'src/integrations/github/github.test.ts', category: 'test' },
        { relPath: 'daml/MergeMint/Token.daml', category: 'source' },
      ];

      const localTargetedFiles: TargetedFileExcerpt[] = [];
      for (const item of candidateLocalFiles) {
        const fullP = path.join(rootDir, item.relPath);
        if (fs.existsSync(fullP)) {
          const raw = fs.readFileSync(fullP, 'utf8');
          // Bound excerpt to max 400 chars
          localTargetedFiles.push({
            path: item.relPath,
            category: item.category,
            contentSnippet: raw.slice(0, 400).trim(),
          });
          contextSources.push(`local:${item.relPath}`);
        }
      }
      if (localTargetedFiles.length > 0) {
        targetedFiles = localTargetedFiles;
      }
    } catch {
      // Local read failed, fall back
    }
  }

  // 2. Try GitHub API context if formatted as owner/repo and credentials or network allow
  if (isOwnerRepo && (!manifestSummary || !readmeExcerpt)) {
    const [owner, name] = parts;
    try {
      const token = await getTokenForRepo(owner, name, userToken).catch(() => undefined);
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'MergeMint-Scout-Agent',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Fetch repo metadata
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
      if (repoRes.ok) {
        const data = await repoRes.json();
        description = data.description || description;
        language = data.language || language;
        topics = data.topics || topics;
        contextSources.push('github:repo_metadata');
      }

      // Fetch README
      if (!readmeExcerpt) {
        const readmeRes = await fetch(`https://api.github.com/repos/${owner}/${name}/readme`, {
          headers: { ...headers, Accept: 'application/vnd.github.raw' },
        });
        if (readmeRes.ok) {
          const text = await readmeRes.text();
          readmeExcerpt = text.slice(0, 1500);
          contextSources.push('github:readme');
        }
      }

      // Fetch recent commit messages (first 5)
      const commitsRes = await fetch(`https://api.github.com/repos/${owner}/${name}/commits?per_page=5`, { headers });
      if (commitsRes.ok) {
        const commits = (await commitsRes.json()) as Array<{ commit?: { message?: string } }>;
        if (Array.isArray(commits)) {
          recentCommits = commits.map(c => (c.commit?.message || '').split('\n')[0]).filter(Boolean).slice(0, 5);
          contextSources.push('github:recent_commits');
        }
      }

      // Fetch existing open issue titles (first 10) to avoid duplicates
      const issuesRes = await fetch(`https://api.github.com/repos/${owner}/${name}/issues?state=open&per_page=10`, { headers });
      if (issuesRes.ok) {
        const issues = (await issuesRes.json()) as Array<{ title?: string; pull_request?: unknown }>;
        if (Array.isArray(issues)) {
          existingIssueTitles = issues.filter(i => !i.pull_request).map(i => i.title || '').filter(Boolean).slice(0, 8);
          contextSources.push('github:existing_issues');
        }
      }

      // Inspect repo tree to select 3-5 targeted source/test/config files (strictly bounded)
      const treeRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/trees/HEAD?recursive=1`, { headers });
      if (treeRes.ok) {
        const treeData = (await treeRes.json()) as { tree?: Array<{ path?: string; type?: string; size?: number }> };
        if (Array.isArray(treeData.tree)) {
          // Find candidates: source, test, validation, config
          const fileCandidates = treeData.tree
            .filter(f => f.type === 'blob' && f.path && (f.size || 0) > 0 && (f.size || 0) < 50000)
            .filter(f => {
              const p = f.path!.toLowerCase();
              return (
                p.endsWith('.ts') ||
                p.endsWith('.js') ||
                p.endsWith('.daml') ||
                p.endsWith('.go') ||
                p.endsWith('.rs') ||
                p.endsWith('.json') ||
                p.endsWith('.yml')
              );
            })
            .slice(0, 1000);

          // Select up to 4 high-value representative files
          const selectedForFetch = fileCandidates
            .filter(f => {
              const p = f.path!.toLowerCase();
              return (
                p.includes('test') ||
                p.includes('api') ||
                p.includes('client') ||
                p.includes('service') ||
                p.includes('config') ||
                p.includes('token')
              );
            })
            .slice(0, 4);

          const remoteExcerpts: TargetedFileExcerpt[] = [];
          for (const item of selectedForFetch) {
            if (!item.path) continue;
            try {
              const contentRes = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${item.path}`, {
                headers: { ...headers, Accept: 'application/vnd.github.raw' },
              });
              if (contentRes.ok) {
                const text = await contentRes.text();
                const pLower = item.path.toLowerCase();
                const category: TargetedFileExcerpt['category'] = pLower.includes('test')
                  ? 'test'
                  : pLower.includes('config') || pLower.includes('.yml')
                  ? 'config'
                  : pLower.includes('token') || pLower.includes('interface')
                  ? 'interface'
                  : pLower.includes('valid') || pLower.includes('schema')
                  ? 'validation'
                  : 'source';

                remoteExcerpts.push({
                  path: item.path,
                  category,
                  contentSnippet: text.slice(0, 400).trim(),
                });
                contextSources.push(`github:${item.path}`);
              }
            } catch {
              // Ignore single file fetch error
            }
          }

          if (remoteExcerpts.length > 0) {
            targetedFiles = remoteExcerpts;
          }
        }
      }
    } catch {
      // Network or API failure, proceed with whatever context was assembled
    }
  }

  // 3. Fallback default context if none could be fetched
  if (!description) {
    description = `Repository ${repoFullName}`;
  }
  if (!language) {
    language = 'Unknown';
  }
  if (contextSources.length === 0) {
    contextSources.push('fallback:repo_identifier');
  }

  return {
    repo: repoFullName,
    description,
    language,
    topics,
    readmeExcerpt,
    manifestSummary,
    recentCommits,
    existingIssueTitles,
    targetedFiles,
    contextSources,
  };
}
