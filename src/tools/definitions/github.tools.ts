/**
 * GitHub Tool Definitions
 *
 * Tools for analyzing GitHub repositories for technical assessment.
 * Used by Marcus (Engineer) agent.
 */

import type { AgentTool } from '../types.js';
import {
  analyzeRepository,
  parseGitHubUrl,
  formatRepoAnalysisForAgent,
} from '../../integrations/github.js';

/**
 * Analyze a GitHub repository for technical assessment
 */
export const analyzeGitHubRepoTool: AgentTool = {
  definition: {
    name: 'analyze_github_repo',
    description:
      'Analyze a GitHub repository for technical assessment. Retrieves tech stack, dependencies, architecture patterns, compliance concerns (Section 508, USWDS, tests), open issues, and code quality indicators. Use when someone shares a GitHub URL or asks about a specific repo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repoUrl: {
          type: 'string',
          description:
            'GitHub repository URL (e.g., "https://github.com/owner/repo" or "owner/repo")',
        },
      },
      required: ['repoUrl'],
    },
  },
  allowedAgents: ['marcus'],
  sourceName: 'GitHub',
  execute: async (params) => {
    try {
      const repoUrl = params.repoUrl as string;

      if (!repoUrl) {
        return {
          success: false,
          data: null,
          error: 'Repository URL is required',
          sourceCitation: 'GitHub',
        };
      }

      // Validate URL format
      const parsed = parseGitHubUrl(repoUrl);
      if (!parsed) {
        return {
          success: false,
          data: null,
          error: `Could not parse GitHub URL: ${repoUrl}. Use format: owner/repo or https://github.com/owner/repo`,
          sourceCitation: 'GitHub',
        };
      }

      // Analyze the repository
      const analysis = await analyzeRepository(repoUrl);

      if (!analysis) {
        return {
          success: false,
          data: null,
          error: `Could not analyze repository: ${parsed.owner}/${parsed.repo}. It may be private or not exist.`,
          sourceCitation: 'GitHub',
        };
      }

      // Format for agent context
      const formatted = formatRepoAnalysisForAgent(analysis);

      return {
        success: true,
        data: {
          analysis: {
            owner: analysis.owner,
            repo: analysis.repo,
            description: analysis.description,
            language: analysis.language,
            techStack: analysis.techStack,
            stars: analysis.stars,
            forks: analysis.forks,
            openIssues: analysis.openIssues,
            lastCommit: analysis.lastCommit,
            license: analysis.license,
            hasTests: analysis.hasTests,
            hasDocs: analysis.hasDocs,
            hasCI: analysis.hasCI,
            architectureNotes: analysis.architectureNotes,
            complianceConcerns: analysis.complianceConcerns,
            forkInfo: analysis.forkInfo,
            recentIssues: analysis.recentIssues.slice(0, 5),
          },
          formattedContext: formatted,
        },
        sourceCitation: `GitHub - ${analysis.owner}/${analysis.repo}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'GitHub analysis failed',
        sourceCitation: 'GitHub',
      };
    }
  },
};

/**
 * All GitHub tools
 */
export const githubTools: AgentTool[] = [analyzeGitHubRepoTool];
