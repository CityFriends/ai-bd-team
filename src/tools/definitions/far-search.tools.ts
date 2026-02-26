/**
 * FAR Search Tool Definitions
 *
 * Tools for looking up Federal Acquisition Regulation (FAR) sections.
 * Used by David (Strategic Lead) and James (Legal Lead) agents.
 */

import type { AgentTool } from '../types.js';
import { lookupFARSection, searchFAR, getFARPart } from '../../integrations/far-search.js';

/**
 * Look up a specific FAR section
 */
export const lookupFARSectionTool: AgentTool = {
  definition: {
    name: 'lookup_far_section',
    description:
      'Look up a specific FAR (Federal Acquisition Regulation) section by number. Returns the full text, title, and related sections. Use for compliance questions or citation needs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sectionNumber: {
          type: 'string',
          description:
            'FAR section number (e.g., "15.304" for evaluation factors, "52.212-4" for contract terms)',
        },
      },
      required: ['sectionNumber'],
    },
  },
  allowedAgents: ['david', 'james'],
  sourceName: 'FAR',
  execute: async (params) => {
    try {
      const sectionNumber = params.sectionNumber as string;

      if (!sectionNumber) {
        return {
          success: false,
          data: null,
          error: 'FAR section number is required',
          sourceCitation: 'FAR',
        };
      }

      const section = await lookupFARSection(sectionNumber);

      if (!section) {
        return {
          success: true,
          data: {
            found: false,
            message: `FAR section ${sectionNumber} not found. Try a different format (e.g., "15.304" or "FAR 15.304")`,
          },
          sourceCitation: 'FAR',
        };
      }

      return {
        success: true,
        data: {
          found: true,
          section: {
            number: section.section_number,
            title: section.title,
            part: section.part,
            subpart: section.subpart,
            text: section.full_text,
          },
        },
        sourceCitation: `FAR ${section.section_number}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'FAR lookup failed',
        sourceCitation: 'FAR',
      };
    }
  },
};

/**
 * Search FAR by keyword
 */
export const searchFARTool: AgentTool = {
  definition: {
    name: 'search_far',
    description:
      'Search the FAR for sections related to a topic or keyword. Returns matching sections ranked by relevance. Use when you need to find applicable regulations for a topic.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Search query (e.g., "small business subcontracting", "past performance evaluation")',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default 5, max 10)',
        },
      },
      required: ['query'],
    },
  },
  allowedAgents: ['david', 'james'],
  sourceName: 'FAR',
  execute: async (params) => {
    try {
      const query = params.query as string;

      if (!query) {
        return {
          success: false,
          data: null,
          error: 'Search query is required',
          sourceCitation: 'FAR',
        };
      }

      const limit = Math.min((params.limit as number) || 5, 10);

      const results = await searchFAR(query, limit);

      if (results.length === 0) {
        return {
          success: true,
          data: {
            query,
            found: 0,
            results: [],
            suggestion: 'Try broader search terms or check spelling',
          },
          sourceCitation: 'FAR Search',
        };
      }

      return {
        success: true,
        data: {
          query,
          found: results.length,
          results: results.map((r) => ({
            section: r.section.section_number,
            title: r.section.title,
            relevance: r.relevance,
            matchType: r.matchType,
            snippet: r.section.full_text?.slice(0, 300) + '...',
          })),
        },
        sourceCitation: 'FAR Search',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'FAR search failed',
        sourceCitation: 'FAR',
      };
    }
  },
};

/**
 * Get all sections in a FAR part
 */
export const getFARPartTool: AgentTool = {
  definition: {
    name: 'get_far_part',
    description:
      'Get all sections within a FAR part. Use when you need a comprehensive view of regulations in an area (e.g., Part 15 for contracting by negotiation).',
    input_schema: {
      type: 'object' as const,
      properties: {
        partNumber: {
          type: 'number',
          description: 'FAR part number (e.g., 15 for negotiation, 19 for small business)',
        },
      },
      required: ['partNumber'],
    },
  },
  allowedAgents: ['david', 'james'],
  sourceName: 'FAR',
  execute: async (params) => {
    try {
      const partNumber = params.partNumber as number;

      if (!partNumber) {
        return {
          success: false,
          data: null,
          error: 'FAR part number is required',
          sourceCitation: 'FAR',
        };
      }

      const sections = await getFARPart(partNumber);

      if (sections.length === 0) {
        return {
          success: true,
          data: {
            found: false,
            message: `No sections found in FAR Part ${partNumber}`,
          },
          sourceCitation: 'FAR',
        };
      }

      return {
        success: true,
        data: {
          part: partNumber,
          sectionCount: sections.length,
          sections: sections.slice(0, 20).map((s) => ({
            number: s.section_number,
            title: s.title,
            subpart: s.subpart,
          })),
          hasMore: sections.length > 20,
        },
        sourceCitation: `FAR Part ${partNumber}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'FAR part lookup failed',
        sourceCitation: 'FAR',
      };
    }
  },
};

/**
 * All FAR search tools
 */
export const farSearchTools: AgentTool[] = [lookupFARSectionTool, searchFARTool, getFARPartTool];
