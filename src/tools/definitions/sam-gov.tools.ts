/**
 * SAM.gov Tool Definitions
 *
 * Tools for searching federal contract opportunities on SAM.gov.
 * Used by Maya (Scout) agent.
 */

import type { AgentTool } from '../types.js';
import {
  searchOpportunities,
  getOpportunityByNoticeId,
  getSAMOpportunityURL,
} from '../../integrations/sam-gov.js';

/**
 * Search SAM.gov for opportunities
 */
export const searchSAMOpportunitiesTool: AgentTool = {
  definition: {
    name: 'search_sam_opportunities',
    description:
      'Search SAM.gov for federal contract opportunities. Use this when asked to find RFPs, RFIs, solicitations, or opportunities for a specific agency, NAICS code, or topic. Returns real opportunities with notice IDs, deadlines, and links.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'string',
          description:
            'Optional: Keywords to filter results (matched against title/description). Leave empty for broad search.',
        },
        daysBack: {
          type: 'number',
          description: 'How many days back to search (default 14, max 90)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 10, max 25)',
        },
        naicsCodes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'NAICS codes to filter by. Default uses our target codes: 541511, 541512, 541519 (IT services)',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['maya'],
  sourceName: 'SAM.gov',
  execute: async (params) => {
    try {
      const daysBack = Math.min((params.daysBack as number) || 14, 90);
      const limit = Math.min((params.limit as number) || 10, 25);

      const result = await searchOpportunities({
        postedFrom: new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000),
        postedTo: new Date(),
        limit,
        naicsCodes: params.naicsCodes as string[] | undefined,
      });

      // Filter by keywords if provided
      let opportunities = result.opportunitiesData;
      const keywords = params.keywords as string | undefined;

      if (keywords) {
        const keywordLower = keywords.toLowerCase();
        opportunities = opportunities.filter(
          (opp) =>
            opp.title?.toLowerCase().includes(keywordLower) ||
            opp.description?.toLowerCase().includes(keywordLower)
        );
      }

      // Format for agent consumption
      const formatted = opportunities.slice(0, limit).map((opp) => ({
        noticeId: opp.noticeId,
        title: opp.title,
        agency: opp.department || opp.subTier || opp.office || 'Unknown Agency',
        type: opp.type || 'Unknown',
        postedDate: opp.postedDate,
        responseDeadline: opp.responseDeadLine,
        setAside: opp.setAside || opp.setAsideDescription || 'None',
        naicsCode: opp.naicsCode,
        url: opp.uiLink || getSAMOpportunityURL(opp.noticeId),
        description:
          opp.description?.slice(0, 300) + ((opp.description?.length ?? 0) > 300 ? '...' : ''),
      }));

      return {
        success: true,
        data: {
          totalFound: result.totalRecords,
          returned: formatted.length,
          opportunities: formatted,
          searchParams: {
            daysBack,
            keywords: keywords || null,
          },
        },
        sourceCitation: `SAM.gov (${result.totalRecords} total, ${formatted.length} returned)`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'SAM.gov search failed',
        sourceCitation: 'SAM.gov',
      };
    }
  },
};

/**
 * Get details for a specific opportunity by Notice ID
 */
export const getOpportunityDetailsTool: AgentTool = {
  definition: {
    name: 'get_opportunity_details',
    description:
      'Get full details for a specific SAM.gov opportunity by its Notice ID. Use when someone asks about a specific opportunity or shares a notice ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        noticeId: {
          type: 'string',
          description: 'The SAM.gov Notice ID (e.g., "140D0423Q0001")',
        },
      },
      required: ['noticeId'],
    },
  },
  allowedAgents: ['maya'],
  sourceName: 'SAM.gov',
  execute: async (params) => {
    try {
      const noticeId = params.noticeId as string;

      if (!noticeId) {
        return {
          success: false,
          data: null,
          error: 'Notice ID is required',
          sourceCitation: 'SAM.gov',
        };
      }

      const opportunity = await getOpportunityByNoticeId(noticeId);

      if (!opportunity) {
        return {
          success: true,
          data: {
            found: false,
            message: `No opportunity found with Notice ID: ${noticeId}`,
          },
          sourceCitation: 'SAM.gov',
        };
      }

      return {
        success: true,
        data: {
          found: true,
          opportunity: {
            noticeId: opportunity.noticeId,
            title: opportunity.title,
            agency: opportunity.department || opportunity.subTier || opportunity.office,
            type: opportunity.type,
            postedDate: opportunity.postedDate,
            responseDeadline: opportunity.responseDeadLine,
            setAside: opportunity.setAside || opportunity.setAsideDescription,
            naicsCode: opportunity.naicsCode,
            description: opportunity.description,
            url: opportunity.uiLink || getSAMOpportunityURL(opportunity.noticeId),
            pointOfContact: opportunity.pointOfContact,
          },
        },
        sourceCitation: `SAM.gov - Notice ${noticeId}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch opportunity details',
        sourceCitation: 'SAM.gov',
      };
    }
  },
};

/**
 * All SAM.gov tools
 */
export const samGovTools: AgentTool[] = [searchSAMOpportunitiesTool, getOpportunityDetailsTool];
