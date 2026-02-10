// GitHub Repository Analysis Integration
// Fetches and analyzes public repositories for technical assessment

import { Octokit } from '@octokit/rest';

// Initialize Octokit client
function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }
  return new Octokit({ auth: token });
}

export interface RepoFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

export interface RepoAnalysis {
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  languages: Record<string, number>;
  stars: number;
  forks: number;
  openIssues: number;
  lastCommit: string | null;
  defaultBranch: string;
  license: string | null;
  topics: string[];
  structure: RepoFile[];
  readme: string | null;
  packageJson: PackageInfo | null;
  requirementsTxt: string | null;
  hasTests: boolean;
  hasDocs: boolean;
  hasCI: boolean;
  techStack: string[];
  architectureNotes: string[];
  complianceConcerns: string[];
  source: string;
}

export interface PackageInfo {
  name: string;
  version: string;
  description?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
}

// Parse GitHub URL to extract owner and repo
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Match patterns like:
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // github.com/owner/repo
  // owner/repo (simple format)
  const patterns = [
    /github\.com\/([^\/]+)\/([^\/\s.]+)/i,
    /^([^\/]+)\/([^\/\s]+)$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''),
      };
    }
  }
  return null;
}

// Get repository structure (top-level files and directories)
export async function getRepoStructure(owner: string, repo: string): Promise<RepoFile[]> {
  const octokit = getOctokit();

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: '',
    });

    if (!Array.isArray(data)) {
      return [];
    }

    return data.map(item => ({
      name: item.name,
      path: item.path,
      type: item.type as 'file' | 'dir',
      size: item.size,
    }));
  } catch (error) {
    console.warn(`GitHub: Could not get repo structure for ${owner}/${repo}:`, error);
    return [];
  }
}

// Get file content from a repository
export async function getFileContent(owner: string, repo: string, path: string): Promise<string | null> {
  const octokit = getOctokit();

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    if ('content' in data && data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    return null;
  } catch (error) {
    // File not found or other error - this is expected for optional files
    return null;
  }
}

// Identify tech stack from dependencies and file structure
function identifyTechStack(
  structure: RepoFile[],
  packageJson: PackageInfo | null,
  requirementsTxt: string | null,
  languages: Record<string, number>
): string[] {
  const stack: string[] = [];

  // From languages
  const topLanguages = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([lang]) => lang);
  stack.push(...topLanguages);

  // From package.json dependencies
  if (packageJson) {
    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Frontend frameworks
    if (allDeps['react'] || allDeps['@types/react']) stack.push('React');
    if (allDeps['vue']) stack.push('Vue.js');
    if (allDeps['@angular/core']) stack.push('Angular');
    if (allDeps['next']) stack.push('Next.js');
    if (allDeps['gatsby']) stack.push('Gatsby');
    if (allDeps['svelte']) stack.push('Svelte');

    // Backend frameworks
    if (allDeps['express']) stack.push('Express.js');
    if (allDeps['fastify']) stack.push('Fastify');
    if (allDeps['nestjs'] || allDeps['@nestjs/core']) stack.push('NestJS');
    if (allDeps['koa']) stack.push('Koa');

    // Databases
    if (allDeps['pg'] || allDeps['postgres'] || allDeps['@prisma/client']) stack.push('PostgreSQL');
    if (allDeps['mongodb'] || allDeps['mongoose']) stack.push('MongoDB');
    if (allDeps['redis'] || allDeps['ioredis']) stack.push('Redis');
    if (allDeps['mysql'] || allDeps['mysql2']) stack.push('MySQL');

    // Cloud/Infrastructure
    if (allDeps['aws-sdk'] || allDeps['@aws-sdk/client-s3']) stack.push('AWS SDK');
    if (allDeps['@azure/core-rest-pipeline']) stack.push('Azure');
    if (allDeps['@google-cloud/storage']) stack.push('Google Cloud');

    // Testing
    if (allDeps['jest']) stack.push('Jest');
    if (allDeps['mocha']) stack.push('Mocha');
    if (allDeps['cypress']) stack.push('Cypress');
    if (allDeps['playwright']) stack.push('Playwright');

    // Build tools
    if (allDeps['typescript']) stack.push('TypeScript');
    if (allDeps['webpack']) stack.push('Webpack');
    if (allDeps['vite']) stack.push('Vite');
    if (allDeps['esbuild']) stack.push('esbuild');
  }

  // From Python requirements
  if (requirementsTxt) {
    const reqs = requirementsTxt.toLowerCase();
    if (reqs.includes('django')) stack.push('Django');
    if (reqs.includes('flask')) stack.push('Flask');
    if (reqs.includes('fastapi')) stack.push('FastAPI');
    if (reqs.includes('sqlalchemy')) stack.push('SQLAlchemy');
    if (reqs.includes('celery')) stack.push('Celery');
    if (reqs.includes('pandas')) stack.push('Pandas');
    if (reqs.includes('numpy')) stack.push('NumPy');
    if (reqs.includes('tensorflow') || reqs.includes('torch')) stack.push('ML/AI');
  }

  // From file structure
  const fileNames = structure.map(f => f.name.toLowerCase());
  if (fileNames.includes('dockerfile') || fileNames.includes('docker-compose.yml')) stack.push('Docker');
  if (fileNames.includes('.github')) stack.push('GitHub Actions');
  if (fileNames.includes('terraform') || fileNames.some(f => f.endsWith('.tf'))) stack.push('Terraform');
  if (fileNames.includes('kubernetes') || fileNames.includes('k8s')) stack.push('Kubernetes');
  if (fileNames.includes('serverless.yml')) stack.push('Serverless');

  // Deduplicate
  return [...new Set(stack)];
}

// Analyze for gov-specific compliance concerns
function identifyComplianceConcerns(
  structure: RepoFile[],
  readme: string | null,
  packageJson: PackageInfo | null
): string[] {
  const concerns: string[] = [];
  const fileNames = structure.map(f => f.name.toLowerCase());
  const readmeLower = (readme || '').toLowerCase();

  // Check for accessibility (Section 508)
  const hasA11yDeps = packageJson?.dependencies && (
    packageJson.dependencies['axe-core'] ||
    packageJson.dependencies['jest-axe'] ||
    packageJson.dependencies['@axe-core/react'] ||
    packageJson.dependencies['pa11y']
  );
  if (!hasA11yDeps && !readmeLower.includes('accessibility') && !readmeLower.includes('508')) {
    concerns.push('No accessibility (Section 508) tooling detected');
  }

  // Check for security scanning
  const hasSecurityDeps = packageJson?.devDependencies && (
    packageJson.devDependencies['eslint-plugin-security'] ||
    packageJson.devDependencies['snyk'] ||
    packageJson.devDependencies['npm-audit']
  );
  if (!hasSecurityDeps && !fileNames.includes('.snyk') && !fileNames.includes('security.md')) {
    concerns.push('No security scanning tooling detected');
  }

  // Check for USWDS (gov design system)
  const hasUSWDS = packageJson?.dependencies && (
    packageJson.dependencies['@uswds/uswds'] ||
    packageJson.dependencies['uswds']
  );
  if (!hasUSWDS && !readmeLower.includes('uswds') && !readmeLower.includes('design system')) {
    concerns.push('Not using USWDS (US Web Design System)');
  }

  // Check for Login.gov / Auth patterns
  if (readmeLower.includes('login') || readmeLower.includes('auth')) {
    if (!readmeLower.includes('login.gov') && !readmeLower.includes('saml') && !readmeLower.includes('oauth')) {
      concerns.push('Auth mentioned but no Login.gov or standard auth protocol detected');
    }
  }

  // Check for testing
  const hasTests = fileNames.some(f =>
    f.includes('test') || f.includes('spec') || f === '__tests__' || f === 'tests'
  );
  if (!hasTests) {
    concerns.push('No test directory detected');
  }

  // Check for documentation
  const hasDocs = fileNames.includes('docs') || fileNames.includes('documentation') ||
    fileNames.includes('readme.md') || fileNames.includes('contributing.md');
  if (!hasDocs) {
    concerns.push('Limited documentation');
  }

  // Check for license (important for gov work)
  const hasLicense = fileNames.includes('license') || fileNames.includes('license.md') ||
    fileNames.includes('license.txt');
  if (!hasLicense) {
    concerns.push('No license file detected');
  }

  return concerns;
}

// Generate architecture notes from analysis
function generateArchitectureNotes(
  structure: RepoFile[],
  techStack: string[],
  readme: string | null,
  packageJson: PackageInfo | null
): string[] {
  const notes: string[] = [];
  const fileNames = structure.map(f => f.name.toLowerCase());
  const dirNames = structure.filter(f => f.type === 'dir').map(f => f.name.toLowerCase());

  // Monorepo detection
  if (fileNames.includes('lerna.json') || fileNames.includes('pnpm-workspace.yaml') ||
      dirNames.includes('packages') || dirNames.includes('apps')) {
    notes.push('Monorepo architecture detected');
  }

  // Microservices detection
  if (dirNames.includes('services') || dirNames.includes('microservices') ||
      (dirNames.includes('api') && dirNames.includes('frontend'))) {
    notes.push('Microservices or multi-service architecture');
  }

  // Static site detection
  if (techStack.includes('Gatsby') || techStack.includes('Next.js') ||
      fileNames.includes('_site') || fileNames.includes('public')) {
    if (!techStack.includes('Express.js') && !techStack.includes('NestJS')) {
      notes.push('Static or JAMstack site architecture');
    }
  }

  // API-first detection
  if (dirNames.includes('api') || fileNames.includes('openapi.yaml') ||
      fileNames.includes('swagger.json')) {
    notes.push('API-first design with documented endpoints');
  }

  // Infrastructure as Code
  if (techStack.includes('Terraform') || techStack.includes('Kubernetes') ||
      fileNames.includes('cloudformation')) {
    notes.push('Infrastructure as Code patterns detected');
  }

  // CI/CD
  if (fileNames.includes('.github') || fileNames.includes('.circleci') ||
      fileNames.includes('.gitlab-ci.yml') || fileNames.includes('jenkinsfile')) {
    notes.push('CI/CD pipeline configured');
  }

  // Scripts analysis from package.json
  if (packageJson?.scripts) {
    const scripts = Object.keys(packageJson.scripts);
    if (scripts.includes('lint') || scripts.includes('format')) {
      notes.push('Code quality tooling (linting/formatting) configured');
    }
    if (scripts.includes('build') && scripts.includes('deploy')) {
      notes.push('Build and deploy scripts defined');
    }
  }

  return notes;
}

// Main function to analyze a repository
export async function analyzeRepository(repoUrl: string): Promise<RepoAnalysis | null> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    console.warn(`GitHub: Could not parse URL: ${repoUrl}`);
    return null;
  }

  const { owner, repo } = parsed;
  const octokit = getOctokit();

  try {
    // Fetch repo info in parallel
    const [repoInfo, languagesResult, structure] = await Promise.all([
      octokit.repos.get({ owner, repo }),
      octokit.repos.listLanguages({ owner, repo }),
      getRepoStructure(owner, repo),
    ]);

    // Get latest commit date
    let lastCommit: string | null = null;
    try {
      const commits = await octokit.repos.listCommits({
        owner,
        repo,
        per_page: 1,
      });
      if (commits.data.length > 0) {
        lastCommit = commits.data[0].commit.author?.date || null;
      }
    } catch {
      // Commits might not be accessible
    }

    // Fetch key files in parallel
    const [readme, packageJsonContent, requirementsTxt] = await Promise.all([
      getFileContent(owner, repo, 'README.md'),
      getFileContent(owner, repo, 'package.json'),
      getFileContent(owner, repo, 'requirements.txt'),
    ]);

    // Parse package.json if present
    let packageJson: PackageInfo | null = null;
    if (packageJsonContent) {
      try {
        const parsed = JSON.parse(packageJsonContent);
        packageJson = {
          name: parsed.name || '',
          version: parsed.version || '',
          description: parsed.description,
          dependencies: parsed.dependencies || {},
          devDependencies: parsed.devDependencies || {},
          scripts: parsed.scripts || {},
        };
      } catch {
        // Invalid JSON
      }
    }

    const languages = languagesResult.data as Record<string, number>;
    const fileNames = structure.map(f => f.name.toLowerCase());

    // Check for key directories
    const hasTests = fileNames.some(f =>
      f.includes('test') || f.includes('spec') || f === '__tests__' || f === 'tests'
    );
    const hasDocs = fileNames.includes('docs') || fileNames.includes('documentation');
    const hasCI = fileNames.includes('.github') || fileNames.includes('.circleci') ||
      fileNames.includes('.gitlab-ci.yml');

    // Identify tech stack
    const techStack = identifyTechStack(structure, packageJson, requirementsTxt, languages);

    // Generate architecture notes
    const architectureNotes = generateArchitectureNotes(structure, techStack, readme, packageJson);

    // Identify compliance concerns
    const complianceConcerns = identifyComplianceConcerns(structure, readme, packageJson);

    return {
      owner,
      repo,
      description: repoInfo.data.description,
      language: repoInfo.data.language,
      languages,
      stars: repoInfo.data.stargazers_count,
      forks: repoInfo.data.forks_count,
      openIssues: repoInfo.data.open_issues_count,
      lastCommit,
      defaultBranch: repoInfo.data.default_branch,
      license: repoInfo.data.license?.name || null,
      topics: repoInfo.data.topics || [],
      structure,
      readme: readme ? readme.slice(0, 3000) : null, // Truncate for context
      packageJson,
      requirementsTxt: requirementsTxt ? requirementsTxt.slice(0, 1000) : null,
      hasTests,
      hasDocs,
      hasCI,
      techStack,
      architectureNotes,
      complianceConcerns,
      source: `GitHub (${owner}/${repo})`,
    };
  } catch (error: any) {
    if (error.status === 404) {
      console.warn(`GitHub: Repository not found: ${owner}/${repo}`);
    } else if (error.status === 403) {
      console.warn(`GitHub: Rate limited or private repo: ${owner}/${repo}`);
    } else {
      console.warn(`GitHub: Error analyzing ${owner}/${repo}:`, error);
    }
    return null;
  }
}

// Format repo analysis for agent context
export function formatRepoAnalysisForAgent(analysis: RepoAnalysis): string {
  const parts: string[] = [];

  parts.push(`\n📦 REPOSITORY ANALYSIS: ${analysis.owner}/${analysis.repo}`);

  if (analysis.description) {
    parts.push(`Description: ${analysis.description}`);
  }

  parts.push(`\n*Overview:*`);
  parts.push(`• Primary Language: ${analysis.language || 'Unknown'}`);
  parts.push(`• Stars: ${analysis.stars} | Forks: ${analysis.forks} | Open Issues: ${analysis.openIssues}`);
  if (analysis.lastCommit) {
    const lastCommitDate = new Date(analysis.lastCommit).toLocaleDateString();
    parts.push(`• Last Commit: ${lastCommitDate}`);
  }
  parts.push(`• License: ${analysis.license || 'None detected'}`);
  if (analysis.topics.length > 0) {
    parts.push(`• Topics: ${analysis.topics.join(', ')}`);
  }

  parts.push(`\n*Tech Stack:*`);
  parts.push(`• ${analysis.techStack.join(', ') || 'Could not determine'}`);

  parts.push(`\n*Code Quality Indicators:*`);
  parts.push(`• Tests: ${analysis.hasTests ? '✓ Present' : '✗ Not detected'}`);
  parts.push(`• Documentation: ${analysis.hasDocs ? '✓ Present' : '✗ Limited'}`);
  parts.push(`• CI/CD: ${analysis.hasCI ? '✓ Configured' : '✗ Not detected'}`);

  if (analysis.architectureNotes.length > 0) {
    parts.push(`\n*Architecture Notes:*`);
    analysis.architectureNotes.forEach(note => {
      parts.push(`• ${note}`);
    });
  }

  if (analysis.complianceConcerns.length > 0) {
    parts.push(`\n*Gov Compliance Concerns:*`);
    analysis.complianceConcerns.forEach(concern => {
      parts.push(`• ⚠️ ${concern}`);
    });
  }

  parts.push(`\n*Repository Structure (top-level):*`);
  const dirs = analysis.structure.filter((f: RepoFile) => f.type === 'dir').map((f: RepoFile) => `📁 ${f.name}`);
  const files = analysis.structure.filter((f: RepoFile) => f.type === 'file').map((f: RepoFile) => `📄 ${f.name}`);
  parts.push(dirs.slice(0, 10).join('  '));
  parts.push(files.slice(0, 10).join('  '));

  if (analysis.readme) {
    parts.push(`\n*README Summary (first 500 chars):*`);
    parts.push(analysis.readme.slice(0, 500) + '...');
  }

  parts.push(`\nSource: ${analysis.source}`);

  return parts.join('\n');
}
