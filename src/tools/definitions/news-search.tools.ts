/**
 * News Search Tool Definitions
 *
 * Tools for searching government contracting news.
 * Used by David (Strategic Lead) agent.
 */

import type { AgentTool } from '../types.js';
import { searchNews, getAgencyNews, searchCompetitorNews } from '../../integrations/news-search.js';

/**
 * Search news articles
 */
export const searchNewsTool: AgentTool = {
  definition: {
    name: 'search_news',
    description:
      'Search recent news articles about federal contracting, agencies, or specific topics. Can filter to government contracting news sources only.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "VA IT modernization", "DoD cloud contract")',
        },
        agencyName: {
          type: 'string',
          description: 'Agency name to focus news search on',
        },
        limit: {
          type: 'number',
          description: 'Maximum articles to return (default 10, max 20)',
        },
        daysBack: {
          type: 'number',
          description: 'How many days back to search (default 30, max 90)',
        },
        govconOnly: {
          type: 'boolean',
          description: 'If true, only search government contracting news sources',
        },
      },
      required: ['query'],
    },
  },
  allowedAgents: ['david'],
  sourceName: 'News Search',
  execute: async (params) => {
    try {
      const query = params.query as string;

      if (!query) {
        return {
          success: false,
          data: null,
          error: 'Search query is required',
          sourceCitation: 'News Search',
        };
      }

      const limit = Math.min((params.limit as number) || 10, 20);
      const daysBack = Math.min((params.daysBack as number) || 30, 90);

      const result = await searchNews({
        query,
        agencyName: params.agencyName as string | undefined,
        limit,
        daysBack,
        govconOnly: params.govconOnly as boolean | undefined,
      });

      const formatted = result.articles.slice(0, limit).map((article) => ({
        title: article.title,
        source: article.source,
        date: article.publishedDate,
        url: article.url,
        snippet: article.snippet?.slice(0, 200),
      }));

      return {
        success: true,
        data: {
          query,
          totalFound: result.articles.length,
          returned: formatted.length,
          articles: formatted,
        },
        sourceCitation: result.source,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'News search failed',
        sourceCitation: 'News Search',
      };
    }
  },
};

/**
 * Get agency-specific news
 */
export const getAgencyNewsTool: AgentTool = {
  definition: {
    name: 'get_agency_news',
    description:
      'Get structured news about a federal agency including recent headlines, leadership changes, and program updates. Useful for understanding agency priorities and upcoming opportunities.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agencyName: {
          type: 'string',
          description: 'Name of the agency (e.g., "Department of Veterans Affairs", "VA")',
        },
      },
      required: ['agencyName'],
    },
  },
  allowedAgents: ['david'],
  sourceName: 'News Search',
  execute: async (params) => {
    try {
      const agencyName = params.agencyName as string;

      if (!agencyName) {
        return {
          success: false,
          data: null,
          error: 'Agency name is required',
          sourceCitation: 'News Search',
        };
      }

      const result = await getAgencyNews(agencyName);

      return {
        success: true,
        data: {
          agency: agencyName,
          recentNews: result.recentNews.slice(0, 5).map((a) => ({
            title: a.title,
            source: a.source,
            date: a.publishedDate,
            url: a.url,
          })),
          leadershipChanges: result.leadershipChanges.slice(0, 3).map((a) => ({
            title: a.title,
            source: a.source,
            date: a.publishedDate,
          })),
          programNews: result.programNews.slice(0, 3).map((a) => ({
            title: a.title,
            source: a.source,
            date: a.publishedDate,
          })),
        },
        sourceCitation: result.source,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Agency news lookup failed',
        sourceCitation: 'News Search',
      };
    }
  },
};

/**
 * Search competitor news
 */
export const searchCompetitorNewsTool: AgentTool = {
  definition: {
    name: 'search_competitor_news',
    description:
      'Get competitive intelligence on a company including GAO protests, performance issues, contract awards, and general news. Essential for understanding competitive landscape.',
    input_schema: {
      type: 'object' as const,
      properties: {
        companyName: {
          type: 'string',
          description: 'Name of the competitor company to research',
        },
        agencyName: {
          type: 'string',
          description: 'Optional agency to focus the search on',
        },
        daysBack: {
          type: 'number',
          description: 'How many days back to search (default 60, max 180)',
        },
      },
      required: ['companyName'],
    },
  },
  allowedAgents: ['david'],
  sourceName: 'News Search',
  execute: async (params) => {
    try {
      const companyName = params.companyName as string;

      if (!companyName) {
        return {
          success: false,
          data: null,
          error: 'Company name is required',
          sourceCitation: 'News Search',
        };
      }

      const daysBack = Math.min((params.daysBack as number) || 60, 180);

      const result = await searchCompetitorNews({
        companyName,
        agencyName: params.agencyName as string | undefined,
        daysBack,
      });

      return {
        success: true,
        data: {
          company: companyName,
          summary: result.summary,
          protests: result.protests.slice(0, 3).map((a) => ({
            title: a.title,
            date: a.publishedDate,
            url: a.url,
          })),
          performanceIssues: result.performance.slice(0, 3).map((a) => ({
            title: a.title,
            date: a.publishedDate,
            url: a.url,
          })),
          recentAwards: result.awards.slice(0, 3).map((a) => ({
            title: a.title,
            date: a.publishedDate,
            url: a.url,
          })),
        },
        sourceCitation: `News Search - ${companyName}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Competitor news search failed',
        sourceCitation: 'News Search',
      };
    }
  },
};

/**
 * All news search tools
 */
export const newsSearchTools: AgentTool[] = [
  searchNewsTool,
  getAgencyNewsTool,
  searchCompetitorNewsTool,
];
