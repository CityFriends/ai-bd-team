/**
 * Contract Data Tool Definitions
 *
 * Tools for searching contracts and finding incumbents via USASpending.
 * Used by David (Strategic Lead) agent.
 */

import type { AgentTool } from '../types.js';
import {
  searchContracts,
  findIncumbent,
  getVendorHistory,
} from '../../integrations/contract-data.js';

/**
 * Search USASpending for contracts
 */
export const searchContractsTool: AgentTool = {
  definition: {
    name: 'search_contracts',
    description:
      'Search USASpending.gov for federal contracts by keyword, agency, vendor name, or NAICS code. Use this to research contract history, find awards, or analyze spending patterns.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword: {
          type: 'string',
          description: 'Search keyword to filter contracts (matched against description/title)',
        },
        agencyCode: {
          type: 'string',
          description: 'Agency code (e.g., "036" for VA, "097" for DoD)',
        },
        vendorName: {
          type: 'string',
          description: 'Vendor/contractor name to search for',
        },
        naicsCode: {
          type: 'string',
          description: 'NAICS code to filter by (e.g., "541511" for custom software)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default 10, max 25)',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['david'],
  sourceName: 'USASpending.gov',
  execute: async (params) => {
    try {
      const limit = Math.min((params.limit as number) || 10, 25);

      const result = await searchContracts({
        keyword: params.keyword as string | undefined,
        agencyCode: params.agencyCode as string | undefined,
        vendorName: params.vendorName as string | undefined,
        naicsCode: params.naicsCode as string | undefined,
        limit,
      });

      const formatted = result.contracts.slice(0, limit).map((contract) => ({
        contractId: contract.contractId,
        vendor: contract.vendorName,
        amount: contract.obligatedAmount,
        agency: contract.agencyName,
        description: contract.contractDescription?.slice(0, 200),
        startDate: contract.signedDate,
        endDate: contract.completionDate,
        naics: contract.naicsCode,
      }));

      return {
        success: true,
        data: {
          totalFound: result.totalCount,
          returned: formatted.length,
          contracts: formatted,
        },
        sourceCitation: `USASpending.gov (${result.totalCount} total contracts)`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Contract search failed',
        sourceCitation: 'USASpending.gov',
      };
    }
  },
};

/**
 * Find the incumbent contractor for an agency/requirement
 */
export const findIncumbentTool: AgentTool = {
  definition: {
    name: 'find_incumbent',
    description:
      'Identify the current incumbent contractor for a federal requirement. Analyzes recent contracts to determine who holds the work and their contract value. Essential for competitive analysis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agencyCode: {
          type: 'string',
          description: 'Agency code (e.g., "036" for VA)',
        },
        agencyName: {
          type: 'string',
          description: 'Agency name (e.g., "Department of Veterans Affairs")',
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords describing the requirement (e.g., ["IT modernization", "cloud"])',
        },
        naicsCode: {
          type: 'string',
          description: 'NAICS code for the service type',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['david'],
  sourceName: 'USASpending.gov',
  execute: async (params) => {
    try {
      const result = await findIncumbent({
        agencyCode: params.agencyCode as string | undefined,
        agencyName: params.agencyName as string | undefined,
        keywords: params.keywords as string[] | undefined,
        naicsCode: params.naicsCode as string | undefined,
      });

      return {
        success: true,
        data: {
          incumbent: result.incumbent,
          contractValue: result.contractValue,
          contractYears: result.contractYears,
          confidence: result.confidence,
          recentContracts: result.contracts.slice(0, 5).map((c) => ({
            vendor: c.vendorName,
            amount: c.obligatedAmount,
            description: c.contractDescription?.slice(0, 150),
            endDate: c.completionDate,
          })),
        },
        sourceCitation: result.source,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Incumbent search failed',
        sourceCitation: 'USASpending.gov',
      };
    }
  },
};

/**
 * Get a vendor's contract history
 */
export const getVendorHistoryTool: AgentTool = {
  definition: {
    name: 'get_vendor_history',
    description:
      "Get a contractor's federal contract history including total contracts, total value, agencies they work with, and recent awards. Use for competitive intelligence or partner evaluation.",
    input_schema: {
      type: 'object' as const,
      properties: {
        vendorName: {
          type: 'string',
          description: 'Name of the contractor/vendor to research',
        },
      },
      required: ['vendorName'],
    },
  },
  allowedAgents: ['david'],
  sourceName: 'USASpending.gov',
  execute: async (params) => {
    try {
      const vendorName = params.vendorName as string;

      if (!vendorName) {
        return {
          success: false,
          data: null,
          error: 'Vendor name is required',
          sourceCitation: 'USASpending.gov',
        };
      }

      const result = await getVendorHistory(vendorName);

      return {
        success: true,
        data: {
          vendorName,
          totalContracts: result.totalContracts,
          totalValue: result.totalValue,
          agencies: result.agencies,
          recentContracts: result.recentContracts.slice(0, 5).map((c) => ({
            agency: c.agencyName,
            amount: c.obligatedAmount,
            description: c.contractDescription?.slice(0, 150),
            date: c.signedDate,
          })),
        },
        sourceCitation: `USASpending.gov - ${vendorName}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Vendor history lookup failed',
        sourceCitation: 'USASpending.gov',
      };
    }
  },
};

/**
 * All contract data tools
 */
export const contractDataTools: AgentTool[] = [
  searchContractsTool,
  findIncumbentTool,
  getVendorHistoryTool,
];
