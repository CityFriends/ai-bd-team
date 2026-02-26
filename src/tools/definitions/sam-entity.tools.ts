/**
 * SAM Entity Tool Definitions
 *
 * Tools for verifying company registrations and finding teaming partners.
 * Used by Rosa (Connector) agent.
 */

import type { AgentTool } from '../types.js';
import {
  verifyRegistration,
  checkCertification,
  findPartnersByNAICS,
  searchSAMEntities,
} from '../../integrations/sam-entity.js';

/**
 * Verify SAM.gov registration
 */
export const verifySAMRegistrationTool: AgentTool = {
  definition: {
    name: 'verify_sam_registration',
    description:
      "Verify a company's SAM.gov registration status, check if it's active, and get their certifications. Essential for partner vetting and compliance verification.",
    input_schema: {
      type: 'object' as const,
      properties: {
        companyName: {
          type: 'string',
          description: 'Name of the company to verify',
        },
      },
      required: ['companyName'],
    },
  },
  allowedAgents: ['rosa'],
  sourceName: 'SAM.gov Entity',
  execute: async (params) => {
    try {
      const companyName = params.companyName as string;

      if (!companyName) {
        return {
          success: false,
          data: null,
          error: 'Company name is required',
          sourceCitation: 'SAM.gov Entity',
        };
      }

      const result = await verifyRegistration(companyName);

      if (!result.entity) {
        return {
          success: true,
          data: {
            found: false,
            companyName,
            message:
              'Company not found in SAM.gov. They may need to register or use a different business name.',
          },
          sourceCitation: result.source,
        };
      }

      return {
        success: true,
        data: {
          found: true,
          companyName,
          isRegistered: result.isRegistered,
          isActive: result.isActive,
          certifications: result.certifications,
          expirationWarning: result.expirationWarning,
          entity: {
            legalName: result.entity.legalBusinessName,
            ueiSAM: result.entity.ueiSAM,
            cageCode: result.entity.cageCode,
            registrationStatus: result.entity.registrationStatus,
            expirationDate: result.entity.registrationExpirationDate,
            businessTypes: result.entity.businessTypes,
            naicsCodes: result.entity.naicsCodes?.slice(0, 10),
          },
        },
        sourceCitation: result.source,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'SAM registration verification failed',
        sourceCitation: 'SAM.gov Entity',
      };
    }
  },
};

/**
 * Check specific certification
 */
export const checkCertificationTool: AgentTool = {
  definition: {
    name: 'check_certification',
    description:
      'Check if a company has a specific small business certification (8(a), WOSB, SDVOSB, HUBZone, EDWOSB). Use when evaluating teaming partners for set-aside opportunities.',
    input_schema: {
      type: 'object' as const,
      properties: {
        companyName: {
          type: 'string',
          description: 'Name of the company to check',
        },
        certification: {
          type: 'string',
          enum: ['8a', 'WOSB', 'SDVOSB', 'HUBZone', 'EDWOSB'],
          description: 'Type of certification to check for',
        },
      },
      required: ['companyName', 'certification'],
    },
  },
  allowedAgents: ['rosa'],
  sourceName: 'SAM.gov Entity',
  execute: async (params) => {
    try {
      const companyName = params.companyName as string;
      const certification = params.certification as '8a' | 'WOSB' | 'SDVOSB' | 'HUBZone' | 'EDWOSB';

      if (!companyName || !certification) {
        return {
          success: false,
          data: null,
          error: 'Company name and certification type are required',
          sourceCitation: 'SAM.gov Entity',
        };
      }

      const result = await checkCertification(companyName, certification);

      return {
        success: true,
        data: {
          companyName,
          certification,
          hasCertification: result.hasCertification,
          entity: result.entity
            ? {
                legalName: result.entity.legalBusinessName,
                businessTypes: result.entity.businessTypes,
              }
            : null,
        },
        sourceCitation: result.source,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Certification check failed',
        sourceCitation: 'SAM.gov Entity',
      };
    }
  },
};

/**
 * Find teaming partners by NAICS
 */
export const findPartnersByNAICSTool: AgentTool = {
  definition: {
    name: 'find_partners_by_naics',
    description:
      'Find potential teaming partners filtered by NAICS code, location, and certifications. Returns companies registered in SAM.gov that match the criteria.',
    input_schema: {
      type: 'object' as const,
      properties: {
        naicsCode: {
          type: 'string',
          description: 'NAICS code to search for (e.g., "541511" for custom software)',
        },
        state: {
          type: 'string',
          description: 'Two-letter state code to filter by (e.g., "VA", "TX")',
        },
        certifications: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['8a', 'WOSB', 'SDVOSB', 'HUBZone'],
          },
          description: 'Required certifications (e.g., ["8a", "SDVOSB"])',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default 10, max 25)',
        },
      },
      required: ['naicsCode'],
    },
  },
  allowedAgents: ['rosa'],
  sourceName: 'SAM.gov Entity',
  execute: async (params) => {
    try {
      const naicsCode = params.naicsCode as string;

      if (!naicsCode) {
        return {
          success: false,
          data: null,
          error: 'NAICS code is required',
          sourceCitation: 'SAM.gov Entity',
        };
      }

      const limit = Math.min((params.limit as number) || 10, 25);

      const result = await findPartnersByNAICS({
        naicsCode,
        state: params.state as string | undefined,
        certifications: params.certifications as
          | ('8a' | 'WOSB' | 'SDVOSB' | 'HUBZone')[]
          | undefined,
        limit,
      });

      const formatted = result.entities.slice(0, limit).map((entity) => ({
        name: entity.legalBusinessName,
        ueiSAM: entity.ueiSAM,
        cageCode: entity.cageCode,
        state: entity.physicalAddress?.stateOrProvinceCode,
        city: entity.physicalAddress?.city,
        certifications: entity.businessTypes?.filter((bt) =>
          ['8(a)', 'WOSB', 'SDVOSB', 'HUBZone', 'EDWOSB'].some((cert) =>
            bt.toLowerCase().includes(cert.toLowerCase())
          )
        ),
        isActive: entity.registrationStatus === 'Active',
      }));

      return {
        success: true,
        data: {
          naicsCode,
          filters: {
            state: params.state || 'any',
            certifications: params.certifications || 'any',
          },
          found: formatted.length,
          partners: formatted,
        },
        sourceCitation: result.source,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Partner search failed',
        sourceCitation: 'SAM.gov Entity',
      };
    }
  },
};

/**
 * Search SAM entities with flexible filters
 */
export const searchSAMEntitiesTool: AgentTool = {
  definition: {
    name: 'search_sam_entities',
    description:
      'Flexible search for companies in SAM.gov with multiple filter options. Use for broad partner searches or market research.',
    input_schema: {
      type: 'object' as const,
      properties: {
        naicsCode: {
          type: 'string',
          description: 'NAICS code to filter by',
        },
        businessType: {
          type: 'string',
          enum: ['small', 'large', 'all'],
          description: 'Filter by business size (default: all)',
        },
        certifications: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['8a', 'WOSB', 'SDVOSB', 'HUBZone'],
          },
          description: 'Required certifications',
        },
        state: {
          type: 'string',
          description: 'Two-letter state code',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default 10, max 25)',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['rosa'],
  sourceName: 'SAM.gov Entity',
  execute: async (params) => {
    try {
      const limit = Math.min((params.limit as number) || 10, 25);

      const result = await searchSAMEntities({
        naicsCode: params.naicsCode as string | undefined,
        businessType: params.businessType as 'small' | 'large' | 'all' | undefined,
        certifications: params.certifications as
          | ('8a' | 'WOSB' | 'SDVOSB' | 'HUBZone')[]
          | undefined,
        state: params.state as string | undefined,
        limit,
      });

      const formatted = result.entities.slice(0, limit).map((entity) => ({
        name: entity.legalBusinessName,
        ueiSAM: entity.ueiSAM,
        state: entity.physicalAddress?.stateOrProvinceCode,
        businessTypes: entity.businessTypes?.slice(0, 5),
        isActive: entity.registrationStatus === 'Active',
      }));

      return {
        success: true,
        data: {
          totalRecords: result.totalRecords,
          returned: formatted.length,
          entities: formatted,
        },
        sourceCitation: 'SAM.gov Entity Search',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'SAM entity search failed',
        sourceCitation: 'SAM.gov Entity',
      };
    }
  },
};

/**
 * All SAM entity tools
 */
export const samEntityTools: AgentTool[] = [
  verifySAMRegistrationTool,
  checkCertificationTool,
  findPartnersByNAICSTool,
  searchSAMEntitiesTool,
];
