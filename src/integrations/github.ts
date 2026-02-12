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

export interface RepoIssue {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  labels: string[];
}

export interface ForkInfo {
  isFork: boolean;
  parentOwner?: string;
  parentRepo?: string;
  parentDescription?: string;
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
  recentIssues: RepoIssue[];
  lastCommit: string | null;
  defaultBranch: string;
  license: string | null;
  topics: string[];
  structure: RepoFile[];
  readme: string | null;
  packageJson: PackageInfo | null;
  subPackages: { path: string; packageJson: PackageInfo }[];
  requirementsTxt: string | null;
  hasTests: boolean;
  hasDocs: boolean;
  hasCI: boolean;
  techStack: string[];
  architectureNotes: string[];
  complianceConcerns: string[];
  forkInfo: ForkInfo;
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
  const patterns = [/github\.com\/([^/]+)\/([^/\s.]+)/i, /^([^/]+)\/([^/\s]+)$/];

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

    return data.map((item) => ({
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
export async function getFileContent(
  owner: string,
  repo: string,
  path: string
): Promise<string | null> {
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
  } catch {
    // File not found or other error - this is expected for optional files
    return null;
  }
}

// Identify tech stack from dependencies and file structure
function identifyTechStack(
  structure: RepoFile[],
  packageJson: PackageInfo | null,
  subPackages: { path: string; packageJson: PackageInfo }[],
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

  // Collect all dependencies from root and sub-packages
  const allDeps: Record<string, string> = {};
  if (packageJson) {
    Object.assign(allDeps, packageJson.dependencies, packageJson.devDependencies);
  }
  for (const sub of subPackages) {
    Object.assign(allDeps, sub.packageJson.dependencies, sub.packageJson.devDependencies);
  }

  // From package.json dependencies (root + sub-packages)
  if (Object.keys(allDeps).length > 0) {
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
  const fileNames = structure.map((f) => f.name.toLowerCase());
  if (fileNames.includes('dockerfile') || fileNames.includes('docker-compose.yml'))
    stack.push('Docker');
  if (fileNames.includes('.github')) stack.push('GitHub Actions');
  if (fileNames.includes('terraform') || fileNames.some((f) => f.endsWith('.tf')))
    stack.push('Terraform');
  if (fileNames.includes('kubernetes') || fileNames.includes('k8s')) stack.push('Kubernetes');
  if (fileNames.includes('serverless.yml')) stack.push('Serverless');

  // Deduplicate
  return [...new Set(stack)];
}

// Analyze for gov-specific compliance concerns
function identifyComplianceConcerns(
  structure: RepoFile[],
  readme: string | null,
  packageJson: PackageInfo | null,
  subPackages: { path: string; packageJson: PackageInfo }[]
): string[] {
  const concerns: string[] = [];
  const fileNames = structure.map((f) => f.name.toLowerCase());
  const readmeLower = (readme || '').toLowerCase();

  // Collect all dependencies from root and sub-packages
  const allDeps: Record<string, string> = {};
  const allDevDeps: Record<string, string> = {};
  if (packageJson) {
    Object.assign(allDeps, packageJson.dependencies);
    Object.assign(allDevDeps, packageJson.devDependencies);
  }
  for (const sub of subPackages) {
    Object.assign(allDeps, sub.packageJson.dependencies);
    Object.assign(allDevDeps, sub.packageJson.devDependencies);
  }

  // Check for accessibility (Section 508)
  const hasA11yDeps =
    allDeps['axe-core'] ||
    allDeps['jest-axe'] ||
    allDeps['@axe-core/react'] ||
    allDeps['pa11y'] ||
    allDevDeps['axe-core'] ||
    allDevDeps['jest-axe'] ||
    allDevDeps['@axe-core/react'] ||
    allDevDeps['pa11y'];
  if (!hasA11yDeps && !readmeLower.includes('accessibility') && !readmeLower.includes('508')) {
    concerns.push('No accessibility (Section 508) tooling detected');
  }

  // Check for security scanning
  const hasSecurityDeps =
    allDevDeps['eslint-plugin-security'] || allDevDeps['snyk'] || allDevDeps['npm-audit'];
  if (!hasSecurityDeps && !fileNames.includes('.snyk') && !fileNames.includes('security.md')) {
    concerns.push('No security scanning tooling detected');
  }

  // Check for USWDS (gov design system)
  const hasUSWDS = allDeps['@uswds/uswds'] || allDeps['uswds'];
  if (!hasUSWDS && !readmeLower.includes('uswds') && !readmeLower.includes('design system')) {
    concerns.push('Not using USWDS (US Web Design System)');
  }

  // Check for Login.gov / Auth patterns
  if (readmeLower.includes('login') || readmeLower.includes('auth')) {
    if (
      !readmeLower.includes('login.gov') &&
      !readmeLower.includes('saml') &&
      !readmeLower.includes('oauth')
    ) {
      concerns.push('Auth mentioned but no Login.gov or standard auth protocol detected');
    }
  }

  // Check for testing
  const hasTests = fileNames.some(
    (f) => f.includes('test') || f.includes('spec') || f === '__tests__' || f === 'tests'
  );
  if (!hasTests) {
    concerns.push('No test directory detected');
  }

  // Check for documentation
  const hasDocs =
    fileNames.includes('docs') ||
    fileNames.includes('documentation') ||
    fileNames.includes('readme.md') ||
    fileNames.includes('contributing.md');
  if (!hasDocs) {
    concerns.push('Limited documentation');
  }

  // Check for license (important for gov work)
  const hasLicense =
    fileNames.includes('license') ||
    fileNames.includes('license.md') ||
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
  const fileNames = structure.map((f) => f.name.toLowerCase());
  const dirNames = structure.filter((f) => f.type === 'dir').map((f) => f.name.toLowerCase());

  // Monorepo detection
  if (
    fileNames.includes('lerna.json') ||
    fileNames.includes('pnpm-workspace.yaml') ||
    dirNames.includes('packages') ||
    dirNames.includes('apps')
  ) {
    notes.push('Monorepo architecture detected');
  }

  // Microservices detection
  if (
    dirNames.includes('services') ||
    dirNames.includes('microservices') ||
    (dirNames.includes('api') && dirNames.includes('frontend'))
  ) {
    notes.push('Microservices or multi-service architecture');
  }

  // Static site detection
  if (
    techStack.includes('Gatsby') ||
    techStack.includes('Next.js') ||
    fileNames.includes('_site') ||
    fileNames.includes('public')
  ) {
    if (!techStack.includes('Express.js') && !techStack.includes('NestJS')) {
      notes.push('Static or JAMstack site architecture');
    }
  }

  // API-first detection
  if (
    dirNames.includes('api') ||
    fileNames.includes('openapi.yaml') ||
    fileNames.includes('swagger.json')
  ) {
    notes.push('API-first design with documented endpoints');
  }

  // Infrastructure as Code
  if (
    techStack.includes('Terraform') ||
    techStack.includes('Kubernetes') ||
    fileNames.includes('cloudformation')
  ) {
    notes.push('Infrastructure as Code patterns detected');
  }

  // CI/CD
  if (
    fileNames.includes('.github') ||
    fileNames.includes('.circleci') ||
    fileNames.includes('.gitlab-ci.yml') ||
    fileNames.includes('jenkinsfile')
  ) {
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

// Helper to parse package.json content
function parsePackageJson(content: string): PackageInfo | null {
  try {
    const parsed = JSON.parse(content);
    return {
      name: parsed.name || '',
      version: parsed.version || '',
      description: parsed.description,
      dependencies: parsed.dependencies || {},
      devDependencies: parsed.devDependencies || {},
      scripts: parsed.scripts || {},
    };
  } catch {
    return null;
  }
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

    // Extract fork info
    const forkInfo: ForkInfo = {
      isFork: repoInfo.data.fork,
      parentOwner: repoInfo.data.parent?.owner?.login,
      parentRepo: repoInfo.data.parent?.name,
      parentDescription: repoInfo.data.parent?.description || undefined,
    };

    // Get latest commit date and recent issues in parallel
    let lastCommit: string | null = null;
    let recentIssues: RepoIssue[] = [];

    try {
      const [commitsResult, issuesResult] = await Promise.all([
        octokit.repos.listCommits({ owner, repo, per_page: 1 }),
        octokit.issues.listForRepo({
          owner,
          repo,
          state: 'open',
          per_page: 10,
          sort: 'updated',
          direction: 'desc',
        }),
      ]);

      if (commitsResult.data.length > 0) {
        lastCommit = commitsResult.data[0].commit.author?.date || null;
      }

      recentIssues = issuesResult.data
        .filter((issue) => !issue.pull_request) // Exclude PRs
        .map((issue) => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          createdAt: issue.created_at,
          labels: issue.labels
            .map((l) => (typeof l === 'string' ? l : l.name || ''))
            .filter(Boolean),
        }));
    } catch {
      // Commits or issues might not be accessible
    }

    // Fetch key files in parallel
    const [readme, packageJsonContent, requirementsTxt] = await Promise.all([
      getFileContent(owner, repo, 'README.md'),
      getFileContent(owner, repo, 'package.json'),
      getFileContent(owner, repo, 'requirements.txt'),
    ]);

    // Parse root package.json if present
    const packageJson = packageJsonContent ? parsePackageJson(packageJsonContent) : null;

    // Detect monorepo and fetch sub-package.json files
    const subPackages: { path: string; packageJson: PackageInfo }[] = [];
    const monorepoIndicators = ['packages', 'apps', 'sites', 'api', 'services', 'shared'];
    const potentialSubDirs = structure
      .filter((f) => f.type === 'dir' && monorepoIndicators.includes(f.name.toLowerCase()))
      .map((f) => f.name);

    // Fetch sub-package.json files in parallel
    if (potentialSubDirs.length > 0) {
      const subPackagePromises = potentialSubDirs.map(async (dir) => {
        const content = await getFileContent(owner, repo, `${dir}/package.json`);
        if (content) {
          const pkg = parsePackageJson(content);
          if (pkg) {
            return { path: dir, packageJson: pkg };
          }
        }
        return null;
      });

      const results = await Promise.all(subPackagePromises);
      subPackages.push(
        ...results.filter((r): r is { path: string; packageJson: PackageInfo } => r !== null)
      );
    }

    const languages = languagesResult.data as Record<string, number>;
    const fileNames = structure.map((f) => f.name.toLowerCase());

    // Check for key directories
    const hasTests = fileNames.some(
      (f) => f.includes('test') || f.includes('spec') || f === '__tests__' || f === 'tests'
    );
    const hasDocs = fileNames.includes('docs') || fileNames.includes('documentation');
    const hasCI =
      fileNames.includes('.github') ||
      fileNames.includes('.circleci') ||
      fileNames.includes('.gitlab-ci.yml');

    // Identify tech stack (now includes sub-packages)
    const techStack = identifyTechStack(
      structure,
      packageJson,
      subPackages,
      requirementsTxt,
      languages
    );

    // Generate architecture notes
    const architectureNotes = generateArchitectureNotes(structure, techStack, readme, packageJson);

    // Identify compliance concerns (now includes sub-packages)
    const complianceConcerns = identifyComplianceConcerns(
      structure,
      readme,
      packageJson,
      subPackages
    );

    return {
      owner,
      repo,
      description: repoInfo.data.description,
      language: repoInfo.data.language,
      languages,
      stars: repoInfo.data.stargazers_count,
      forks: repoInfo.data.forks_count,
      openIssues: repoInfo.data.open_issues_count,
      recentIssues,
      lastCommit,
      defaultBranch: repoInfo.data.default_branch,
      license: repoInfo.data.license?.name || null,
      topics: repoInfo.data.topics || [],
      structure,
      readme: readme ? readme.slice(0, 3000) : null, // Truncate for context
      packageJson,
      subPackages,
      requirementsTxt: requirementsTxt ? requirementsTxt.slice(0, 1000) : null,
      hasTests,
      hasDocs,
      hasCI,
      techStack,
      architectureNotes,
      complianceConcerns,
      forkInfo,
      source: `GitHub (${owner}/${repo})`,
    };
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 404) {
      console.warn(`GitHub: Repository not found: ${owner}/${repo}`);
    } else if (status === 403) {
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

  // Show fork info prominently if this is a fork
  if (analysis.forkInfo.isFork && analysis.forkInfo.parentOwner) {
    parts.push(`⚠️ FORK of ${analysis.forkInfo.parentOwner}/${analysis.forkInfo.parentRepo}`);
    if (analysis.forkInfo.parentDescription) {
      parts.push(`   Parent: ${analysis.forkInfo.parentDescription}`);
    }
  }

  if (analysis.description) {
    parts.push(`Description: ${analysis.description}`);
  }

  parts.push(`\n*Overview:*`);
  parts.push(`• Primary Language: ${analysis.language || 'Unknown'}`);
  parts.push(
    `• Stars: ${analysis.stars} | Forks: ${analysis.forks} | Open Issues: ${analysis.openIssues}`
  );
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

  // Show monorepo sub-packages if detected
  if (analysis.subPackages.length > 0) {
    parts.push(`\n*Monorepo Packages Detected:*`);
    analysis.subPackages.forEach((sub) => {
      const deps = Object.keys(sub.packageJson.dependencies || {}).slice(0, 5);
      parts.push(`• ${sub.path}/: ${sub.packageJson.name || 'unnamed'}`);
      if (deps.length > 0) {
        parts.push(`  Key deps: ${deps.join(', ')}`);
      }
    });
  }

  parts.push(`\n*Code Quality Indicators:*`);
  parts.push(`• Tests: ${analysis.hasTests ? '✓ Present' : '✗ Not detected'}`);
  parts.push(`• Documentation: ${analysis.hasDocs ? '✓ Present' : '✗ Limited'}`);
  parts.push(`• CI/CD: ${analysis.hasCI ? '✓ Configured' : '✗ Not detected'}`);

  if (analysis.architectureNotes.length > 0) {
    parts.push(`\n*Architecture Notes:*`);
    analysis.architectureNotes.forEach((note) => {
      parts.push(`• ${note}`);
    });
  }

  if (analysis.complianceConcerns.length > 0) {
    parts.push(`\n*Gov Compliance Concerns:*`);
    analysis.complianceConcerns.forEach((concern) => {
      parts.push(`• ⚠️ ${concern}`);
    });
  }

  // Show recent issues - this is valuable context for bid assessment
  if (analysis.recentIssues.length > 0) {
    parts.push(`\n*Recent Open Issues (${analysis.openIssues} total):*`);
    analysis.recentIssues.slice(0, 5).forEach((issue) => {
      const labels = issue.labels.length > 0 ? ` [${issue.labels.join(', ')}]` : '';
      const age = getIssueAge(issue.createdAt);
      parts.push(`• #${issue.number}: ${issue.title}${labels} (${age})`);
    });
    if (analysis.openIssues > 5) {
      parts.push(`  ... and ${analysis.openIssues - 5} more open issues`);
    }
  }

  parts.push(`\n*Repository Structure (top-level):*`);
  const dirs = analysis.structure
    .filter((f: RepoFile) => f.type === 'dir')
    .map((f: RepoFile) => `📁 ${f.name}`);
  const files = analysis.structure
    .filter((f: RepoFile) => f.type === 'file')
    .map((f: RepoFile) => `📄 ${f.name}`);
  parts.push(dirs.slice(0, 10).join('  '));
  parts.push(files.slice(0, 10).join('  '));

  if (analysis.readme) {
    parts.push(`\n*README Summary (first 500 chars):*`);
    parts.push(analysis.readme.slice(0, 500) + '...');
  }

  parts.push(`\nSource: ${analysis.source}`);

  return parts.join('\n');
}

// Helper to format issue age
function getIssueAge(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return '1 day old';
  if (days < 30) return `${days} days old`;
  if (days < 365) return `${Math.floor(days / 30)} months old`;
  return `${Math.floor(days / 365)} years old`;
}
