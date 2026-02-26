/**
 * USASpending Tool Definitions
 *
 * Tools for analyzing federal agency spending data.
 * Used by David (Strategic Lead) agent.
 */

import type { AgentTool } from '../types.js';
import {
  getAgencySpending,
  getAgencyTrend,
  searchContractorSpending,
} from '../../integrations/usaspending.js';

/**
 * Get agency spending overview
 */
export const getAgencySpendingTool: AgentTool = {
  definition: {
    name: 'get_agency_spending',
    description:
      "Get federal agency budget overview including total spending, spending by category, and top contractors. Use to understand an agency's contracting priorities and major vendors.",
    input_schema: {
      type: 'object' as const,
      properties: {
        agencyCode: {
          type: 'string',
          description: 'Agency code (e.g., "036" for VA, "097" for DoD)',
        },
        agencyName: {
          type: 'string',
          description: 'Agency name (e.g., "Department of Veterans Affairs")',
        },
        fiscalYear: {
          type: 'number',
          description: 'Fiscal year to analyze (defaults to current FY)',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['david'],
  sourceName: 'USASpending.gov',
  execute: async (params) => {
    try {
      const result = await getAgencySpending({
        agencyCode: params.agencyCode as string | undefined,
        agencyName: params.agencyName as string | undefined,
        fiscalYear: params.fiscalYear as number | undefined,
      });

      if (!result.spending) {
        return {
          success: true,
          data: {
            found: false,
            message: 'No spending data found for this agency',
          },
          sourceCitation: result.source,
        };
      }

      return {
        success: true,
        data: {
          agency: result.spending.agencyName,
          fiscalYear: result.spending.fiscalYear,
          totalObligations: result.spending.totalObligations,
          totalOutlays: result.spending.totalOutlays,
          topCategories: result.topCategories.slice(0, 5),
          topContractors: result.topContractors.slice(0, 10).map((c) => ({
            name: c.recipientName,
            amount: c.totalAmount,
            contractCount: c.contractCount,
          })),
        },
        sourceCitation: result.source,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Agency spending lookup failed',
        sourceCitation: 'USASpending.gov',
      };
    }
  },
};

/**
 * Get agency spending trends over time
 */
export const getAgencyTrendTool: AgentTool = {
  definition: {
    name: 'get_agency_trend',
    description:
      'Analyze agency spending trends over multiple fiscal years. Shows budget growth or decline, helping predict future contracting opportunities.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agencyCode: {
          type: 'string',
          description: 'Agency code',
        },
        agencyName: {
          type: 'string',
          description: 'Agency name',
        },
        years: {
          type: 'number',
          description: 'Number of years to analyze (default 5, max 10)',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['david'],
  sourceName: 'USASpending.gov',
  execute: async (params) => {
    try {
      const years = Math.min((params.years as number) || 5, 10);

      const result = await getAgencyTrend({
        agencyCode: params.agencyCode as string | undefined,
        agencyName: params.agencyName as string | undefined,
        years,
      });

      return {
        success: true,
        data: {
          trends: result.trends,
          percentChange: result.percentChange,
          yearsAnalyzed: result.trends.length,
        },
        sourceCitation: result.source,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Agency trend analysis failed',
        sourceCitation: 'USASpending.gov',
      };
    }
  },
};

/**
 * Search contractor spending
 */
export const searchContractorSpendingTool: AgentTool = {
  definition: {
    name: 'search_contractor_spending',
    description:
      "Get a contractor's total federal awards and their top agency clients. Useful for competitive analysis and understanding a company's federal market position.",
    input_schema: {
      type: 'object' as const,
      properties: {
        recipientName: {
          type: 'string',
          description: 'Name of the contractor to research',
        },
        fiscalYear: {
          type: 'number',
          description: 'Fiscal year (defaults to current FY)',
        },
      },
      required: ['recipientName'],
    },
  },
  allowedAgents: ['david'],
  sourceName: 'USASpending.gov',
  execute: async (params) => {
    try {
      const recipientName = params.recipientName as string;

      if (!recipientName) {
        return {
          success: false,
          data: null,
          error: 'Contractor name is required',
          sourceCitation: 'USASpending.gov',
        };
      }

      const result = await searchContractorSpending({
        recipientName,
        fiscalYear: params.fiscalYear as number | undefined,
      });

      return {
        success: true,
        data: {
          contractor: recipientName,
          totalAwarded: result.totalAwarded,
          contractCount: result.contractCount,
          topAgencies: result.topAgencies,
        },
        sourceCitation: result.source,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Contractor spending lookup failed',
        sourceCitation: 'USASpending.gov',
      };
    }
  },
};

/**
 * All USASpending tools
 */
export const usaspendingTools: AgentTool[] = [
  getAgencySpendingTool,
  getAgencyTrendTool,
  searchContractorSpendingTool,
];
